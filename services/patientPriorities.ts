import { supabase } from '@/lib/supabase';
import type {
  ExtractedPriorities,
  PatientPriorities,
  UpsertPatientPrioritiesParams,
} from '@/lib/types/priorities';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

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
