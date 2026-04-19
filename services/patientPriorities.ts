import { supabase } from '@/lib/supabase';
import type {
  ExtractedPriorities,
  FrictionCategory,
  FrictionPoint,
  HealthPriority,
  PatientPriorities,
  TrackingDifficulty,
  UpsertPatientPrioritiesParams,
} from '@/lib/types/priorities';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/** Normalize a topic/area/category label for dedup comparison. */
function normalize(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Columns that get written to the DB from a full priorities snapshot. */
interface PrioritiesRowUpdate {
  raw_input: string;
  health_priorities: HealthPriority[];
  friction_points: FrictionPoint[];
  tracking_difficulties: TrackingDifficulty[];
  support_context: PatientPriorities['support_context'];
  reminder_preferences: PatientPriorities['reminder_preferences'];
  conditions_of_focus: string[];
}

/**
 * Fetch the patient priorities row for a profile (if any).
 */
export async function fetchPatientPriorities(
  profileId: string,
): Promise<ServiceResult<PatientPriorities | null>> {
  const { data, error } = await supabase
    .from('patient_priorities')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? null) as PatientPriorities | null };
}

/**
 * Call the extract-priorities Edge Function to convert raw patient text into
 * structured priorities. Does not persist — the UI shows the result for
 * review, then calls upsertPatientPriorities on confirmation.
 */
export async function extractPriorities(
  text: string,
  profileName: string | null,
): Promise<ServiceResult<ExtractedPriorities>> {
  const { data, error } = await supabase.functions.invoke(
    'extract-priorities',
    {
      body: { text, profileName: profileName ?? undefined },
    },
  );

  if (error) {
    return { success: false, error: error.message ?? 'Extraction failed' };
  }

  if (!data || typeof data !== 'object') {
    return { success: false, error: 'Empty response from extractor' };
  }

  return { success: true, data: data as ExtractedPriorities };
}

/**
 * Insert or update the patient_priorities row for a profile.
 */
export async function upsertPatientPriorities(
  params: UpsertPatientPrioritiesParams,
  userId: string,
): Promise<ServiceResult<PatientPriorities>> {
  const { data, error } = await supabase
    .from('patient_priorities')
    .upsert(
      {
        profile_id: params.profile_id,
        household_id: params.household_id,
        raw_input: params.raw_input,
        health_priorities: params.extracted.health_priorities,
        friction_points: params.extracted.friction_points,
        tracking_difficulties: params.extracted.tracking_difficulties,
        support_context: params.extracted.support_context,
        reminder_preferences: params.extracted.reminder_preferences,
        conditions_of_focus: params.extracted.conditions_of_focus,
      },
      { onConflict: 'profile_id' },
    )
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: params.profile_id,
    actor_id: userId,
    event_type: 'patient_priorities.saved',
    metadata: {
      health_priorities_count: params.extracted.health_priorities.length,
      friction_points_count: params.extracted.friction_points.length,
      conditions_of_focus_count: params.extracted.conditions_of_focus.length,
    },
  });

  return { success: true, data: data as PatientPriorities };
}

// ── Pure merge/edit helpers ───────────────────────────────────────────────

/**
 * Merge a fresh extraction into an existing priorities snapshot, deduplicating
 * arrays by normalized key. Scalars in support_context and reminder_preferences
 * are overridden field-by-field (only when the new value is non-null).
 * raw_input is appended with a timestamp separator to preserve history.
 */
export function mergePriorities(
  existing: PatientPriorities,
  extraction: ExtractedPriorities,
  newRawInput: string,
): PrioritiesRowUpdate {
  const mergedHealth: HealthPriority[] = [...existing.health_priorities];
  for (const hp of extraction.health_priorities) {
    const key = normalize(hp.topic);
    if (!key) continue;
    const idx = mergedHealth.findIndex((x) => normalize(x.topic) === key);
    if (idx >= 0) {
      const prev = mergedHealth[idx];
      mergedHealth[idx] = {
        topic: prev.topic,
        importance: hp.importance === 'high' ? 'high' : prev.importance,
        detail: hp.detail ?? prev.detail,
      };
    } else {
      mergedHealth.push(hp);
    }
  }

  const mergedFriction: FrictionPoint[] = [...existing.friction_points];
  for (const fp of extraction.friction_points) {
    const key = normalize(fp.area);
    if (!key) continue;
    const idx = mergedFriction.findIndex((x) => normalize(x.area) === key);
    if (idx >= 0) {
      mergedFriction[idx] = { ...mergedFriction[idx], ...fp };
    } else {
      mergedFriction.push(fp);
    }
  }

  const mergedTracking: TrackingDifficulty[] = [...existing.tracking_difficulties];
  for (const td of extraction.tracking_difficulties) {
    const key = normalize(td.what);
    if (!key) continue;
    const exists = mergedTracking.some((x) => normalize(x.what) === key);
    if (!exists) mergedTracking.push(td);
  }

  const mergedConditions = [...existing.conditions_of_focus];
  for (const cond of extraction.conditions_of_focus) {
    const key = normalize(cond);
    if (!key) continue;
    const exists = mergedConditions.some((x) => normalize(x) === key);
    if (!exists) mergedConditions.push(cond);
  }

  // support_context: field-level override when the new value is non-null
  const mergedSupport = (() => {
    const prev = existing.support_context;
    const next = extraction.support_context;
    if (!prev && !next) return null;
    if (!prev) return next;
    if (!next) return prev;
    const mergedHelpers = Array.from(
      new Set([...prev.helpers, ...next.helpers].map((h) => h.trim()).filter(Boolean)),
    );
    return {
      helpers: mergedHelpers,
      coordination_challenges:
        next.coordination_challenges ?? prev.coordination_challenges,
    };
  })();

  // reminder_preferences: field-level override when the new value is non-null
  const mergedReminders = (() => {
    const prev = existing.reminder_preferences;
    const next = extraction.reminder_preferences;
    if (!prev && !next) return null;
    if (!prev) return next;
    if (!next) return prev;
    const mergedChannels = Array.from(
      new Set([...prev.channels, ...next.channels].map((c) => c.trim()).filter(Boolean)),
    );
    return {
      preferred_time: next.preferred_time ?? prev.preferred_time,
      frequency_preference:
        next.frequency_preference ?? prev.frequency_preference,
      channels: mergedChannels,
    };
  })();

  const stamp = new Date().toISOString().slice(0, 10);
  const appendedRaw = existing.raw_input
    ? `${existing.raw_input}\n\n— ${stamp} —\n${newRawInput}`
    : newRawInput;

  return {
    raw_input: appendedRaw,
    health_priorities: mergedHealth,
    friction_points: mergedFriction,
    tracking_difficulties: mergedTracking,
    support_context: mergedSupport,
    reminder_preferences: mergedReminders,
    conditions_of_focus: mergedConditions,
  };
}

/** Add a single priority chosen from a quick-pick chip (no extraction). */
export function addQuickPriority(
  existing: PatientPriorities | null,
  topic: string,
  category: FrictionCategory,
): PrioritiesRowUpdate {
  const base: PrioritiesRowUpdate = existing
    ? {
        raw_input: existing.raw_input ?? '',
        health_priorities: [...existing.health_priorities],
        friction_points: [...existing.friction_points],
        tracking_difficulties: [...existing.tracking_difficulties],
        support_context: existing.support_context,
        reminder_preferences: existing.reminder_preferences,
        conditions_of_focus: [...existing.conditions_of_focus],
      }
    : {
        raw_input: '',
        health_priorities: [],
        friction_points: [],
        tracking_difficulties: [],
        support_context: null,
        reminder_preferences: null,
        conditions_of_focus: [],
      };

  const key = normalize(topic);
  if (!key) return base;
  const exists = base.health_priorities.some((x) => normalize(x.topic) === key);
  if (!exists) {
    base.health_priorities.push({
      topic: topic.trim(),
      importance: 'high',
      detail: null,
    });
  }
  // Also record a friction_point so the task prioritizer boosts this category.
  const areaKey = `quick:${category}`;
  const fpExists = base.friction_points.some(
    (x) => normalize(x.area) === areaKey,
  );
  if (!fpExists) {
    base.friction_points.push({
      area: areaKey,
      description: topic.trim(),
      category,
    });
  }
  return base;
}

/** Remove a health priority by topic. Also removes matching conditions_of_focus. */
export function removePriorityTopic(
  existing: PatientPriorities,
  topic: string,
): PrioritiesRowUpdate {
  const key = normalize(topic);
  return {
    raw_input: existing.raw_input ?? '',
    health_priorities: existing.health_priorities.filter(
      (x) => normalize(x.topic) !== key,
    ),
    friction_points: [...existing.friction_points],
    tracking_difficulties: [...existing.tracking_difficulties],
    support_context: existing.support_context,
    reminder_preferences: existing.reminder_preferences,
    conditions_of_focus: existing.conditions_of_focus.filter(
      (x) => normalize(x) !== key,
    ),
  };
}

/** Remove a friction point by area (the unique identifier on these rows). */
export function removeFrictionArea(
  existing: PatientPriorities,
  area: string,
): PrioritiesRowUpdate {
  const key = normalize(area);
  return {
    raw_input: existing.raw_input ?? '',
    health_priorities: [...existing.health_priorities],
    friction_points: existing.friction_points.filter(
      (x) => normalize(x.area) !== key,
    ),
    tracking_difficulties: [...existing.tracking_difficulties],
    support_context: existing.support_context,
    reminder_preferences: existing.reminder_preferences,
    conditions_of_focus: [...existing.conditions_of_focus],
  };
}

// ── Mutation wrappers for merge/add/remove/reset ──────────────────────────

async function writeRow(
  profileId: string,
  householdId: string,
  update: PrioritiesRowUpdate,
  userId: string,
  eventType: string,
): Promise<ServiceResult<PatientPriorities>> {
  const { data, error } = await supabase
    .from('patient_priorities')
    .upsert(
      {
        profile_id: profileId,
        household_id: householdId,
        ...update,
      },
      { onConflict: 'profile_id' },
    )
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: eventType,
    metadata: {
      health_priorities_count: update.health_priorities.length,
      friction_points_count: update.friction_points.length,
      conditions_of_focus_count: update.conditions_of_focus.length,
    },
  });

  return { success: true, data: data as PatientPriorities };
}

export async function mergePatientPriorities(
  params: {
    profile_id: string;
    household_id: string;
    raw_input: string;
    extracted: ExtractedPriorities;
  },
  userId: string,
): Promise<ServiceResult<PatientPriorities>> {
  const fetched = await fetchPatientPriorities(params.profile_id);
  if (!fetched.success) return fetched;
  if (!fetched.data) {
    // No existing row — fall back to a fresh upsert.
    return upsertPatientPriorities(
      {
        profile_id: params.profile_id,
        household_id: params.household_id,
        raw_input: params.raw_input,
        extracted: params.extracted,
      },
      userId,
    );
  }
  const merged = mergePriorities(fetched.data, params.extracted, params.raw_input);
  return writeRow(
    params.profile_id,
    params.household_id,
    merged,
    userId,
    'patient_priorities.merged',
  );
}

export async function addQuickPatientPriority(
  params: {
    profile_id: string;
    household_id: string;
    topic: string;
    category: FrictionCategory;
  },
  userId: string,
): Promise<ServiceResult<PatientPriorities>> {
  const fetched = await fetchPatientPriorities(params.profile_id);
  if (!fetched.success) return fetched;
  const update = addQuickPriority(fetched.data, params.topic, params.category);
  return writeRow(
    params.profile_id,
    params.household_id,
    update,
    userId,
    'patient_priorities.quick_add',
  );
}

export async function removePatientPriority(
  params: {
    profile_id: string;
    household_id: string;
    kind: 'topic' | 'friction';
    value: string;
  },
  userId: string,
): Promise<ServiceResult<PatientPriorities>> {
  const fetched = await fetchPatientPriorities(params.profile_id);
  if (!fetched.success) return fetched;
  if (!fetched.data) {
    return { success: false, error: 'No priorities to remove from' };
  }
  const update =
    params.kind === 'topic'
      ? removePriorityTopic(fetched.data, params.value)
      : removeFrictionArea(fetched.data, params.value);
  return writeRow(
    params.profile_id,
    params.household_id,
    update,
    userId,
    'patient_priorities.removed',
  );
}

export async function resetPatientPriorities(
  profileId: string,
  userId: string,
): Promise<ServiceResult<void>> {
  const { error } = await supabase
    .from('patient_priorities')
    .delete()
    .eq('profile_id', profileId);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'patient_priorities.reset',
    metadata: {},
  });

  return { success: true, data: undefined };
}

/**
 * Update implicit signals — called after task list loads (at most once per day).
 * Aggregates completion/dismissal behavior by source category.
 */
export async function updateImplicitSignals(
  profileId: string,
): Promise<ServiceResult<void>> {
  const { data: priorities } = await supabase
    .from('patient_priorities')
    .select('id, implicit_signals')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (!priorities) {
    // No priorities set yet — nothing to update
    return { success: true, data: undefined };
  }

  const existing = (priorities.implicit_signals as Record<string, unknown>) ?? {};
  const lastUpdated = existing.lastUpdatedAt as string | undefined;
  if (lastUpdated) {
    const lastMs = new Date(lastUpdated).getTime();
    if (Number.isFinite(lastMs) && Date.now() - lastMs < 24 * 60 * 60 * 1000) {
      return { success: true, data: undefined };
    }
  }

  // Aggregate task counts by source_type for this profile
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('source_type, status, created_at, completed_at')
    .eq('profile_id', profileId)
    .is('deleted_at', null);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const totals: Record<string, number> = {};
  const completed: Record<string, number> = {};
  const dismissed: Record<string, number> = {};
  const durationMs: Record<string, number[]> = {};

  for (const row of tasks ?? []) {
    const cat = (row.source_type as string) ?? 'manual';
    totals[cat] = (totals[cat] ?? 0) + 1;
    if (row.status === 'completed') {
      completed[cat] = (completed[cat] ?? 0) + 1;
      if (row.completed_at && row.created_at) {
        const delta = new Date(row.completed_at as string).getTime() -
          new Date(row.created_at as string).getTime();
        if (Number.isFinite(delta) && delta >= 0) {
          (durationMs[cat] ??= []).push(delta);
        }
      }
    }
    if (row.status === 'dismissed') {
      dismissed[cat] = (dismissed[cat] ?? 0) + 1;
    }
  }

  const completionRateByCategory: Record<string, number> = {};
  const dismissalRateByCategory: Record<string, number> = {};
  const averageCompletionTimeByCategory: Record<string, string> = {};
  for (const [cat, total] of Object.entries(totals)) {
    if (total === 0) continue;
    completionRateByCategory[cat] = (completed[cat] ?? 0) / total;
    dismissalRateByCategory[cat] = (dismissed[cat] ?? 0) / total;
    const durations = durationMs[cat];
    if (durations && durations.length > 0) {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const days = avg / (24 * 60 * 60 * 1000);
      averageCompletionTimeByCategory[cat] = days < 1
        ? 'same_day'
        : days < 3
          ? '1_3_days'
          : days < 8
            ? '3_7_days'
            : 'over_a_week';
    }
  }

  const mostUsedModules = Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([cat]) => cat);

  const newSignals = {
    completionRateByCategory,
    dismissalRateByCategory,
    averageCompletionTimeByCategory,
    mostUsedModules,
    lastUpdatedAt: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from('patient_priorities')
    .update({ implicit_signals: newSignals })
    .eq('id', priorities.id);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true, data: undefined };
}

/**
 * Mark that we prompted the user to set priorities — prevents re-prompting
 * too often. Use before showing the "What Matters to You" card.
 */
export async function markPrioritiesPrompted(
  profileId: string,
  householdId: string,
): Promise<ServiceResult<void>> {
  const { error } = await supabase
    .from('patient_priorities')
    .upsert(
      {
        profile_id: profileId,
        household_id: householdId,
        last_prompted_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id' },
    );

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, data: undefined };
}
