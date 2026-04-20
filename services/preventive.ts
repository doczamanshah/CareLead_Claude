/**
 * Preventive Care service — handles rule library reads, profile-scoped
 * preventive_items CRUD, audit events, and the orchestrator that runs the
 * deterministic eligibility engine and persists its output.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { fetchProfileDetail } from '@/services/profiles';
import { runEligibilityScan } from '@/services/preventiveEngine';
import { createTask, updateTaskStatus } from '@/services/tasks';
import type {
  PreventiveRule,
  PreventiveItem,
  PreventiveItemWithRule,
  PreventiveItemEvent,
  PreventiveEventType,
  PreventiveStatus,
  PreventiveLastDoneSource,
  EligibilityCriteria,
  PreventiveIntentSheet,
  PreventiveIntentSheetContent,
  PreventiveIntentSheetStatus,
  PreventiveTaskTier,
} from '@/lib/types/preventive';
import type { TaskPriority, TaskTier } from '@/lib/types/tasks';
import type {
  EligibilityScanResult,
  PreventiveItemUpsert,
} from '@/services/preventiveEngine';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// ── Rules ──────────────────────────────────────────────────────────────────

/**
 * Fetch all active preventive rules, ordered by category then title.
 */
export async function fetchRules(): Promise<ServiceResult<PreventiveRule[]>> {
  const { data, error } = await supabase
    .from('preventive_rules')
    .select('*')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('title', { ascending: true });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const rules = (data ?? []).map((r) => ({
    ...r,
    eligibility_criteria: r.eligibility_criteria as EligibilityCriteria,
  })) as PreventiveRule[];

  return { success: true, data: rules };
}

// ── Items ──────────────────────────────────────────────────────────────────

/**
 * Fetch all preventive items for a profile, joined with rule metadata.
 */
export async function fetchPreventiveItems(
  profileId: string,
): Promise<ServiceResult<PreventiveItemWithRule[]>> {
  const { data, error } = await supabase
    .from('preventive_items')
    .select(
      `
      *,
      rule:preventive_rules!rule_id (
        code,
        title,
        description,
        category,
        cadence_months,
        guideline_source,
        guideline_version,
        guideline_url,
        screening_methods,
        hedis_measure_code,
        condition_triggers,
        is_condition_dependent,
        seasonal_window,
        measure_type
      )
    `,
    )
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const items = (data ?? []) as PreventiveItemWithRule[];
  return { success: true, data: items };
}

/**
 * Fetch a single preventive item with rule metadata.
 */
export async function fetchPreventiveItem(
  itemId: string,
): Promise<ServiceResult<PreventiveItemWithRule>> {
  const { data, error } = await supabase
    .from('preventive_items')
    .select(
      `
      *,
      rule:preventive_rules!rule_id (
        code,
        title,
        description,
        category,
        cadence_months,
        guideline_source,
        guideline_version,
        guideline_url,
        screening_methods,
        hedis_measure_code,
        condition_triggers,
        is_condition_dependent,
        seasonal_window,
        measure_type
      )
    `,
    )
    .eq('id', itemId)
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Item not found' };
  }

  return { success: true, data: data as PreventiveItemWithRule };
}

/**
 * Upsert a batch of preventive items from an eligibility scan, keyed by
 * the unique (profile_id, rule_id) constraint. Also emits audit events
 * for created items and status changes.
 */
export async function upsertPreventiveItems(
  upserts: PreventiveItemUpsert[],
  profileId: string,
  householdId: string,
): Promise<ServiceResult<PreventiveItem[]>> {
  if (upserts.length === 0) return { success: true, data: [] };

  // Fetch any existing items for these rules so we can detect status changes.
  const ruleIds = upserts.map((u) => u.ruleId);
  const { data: existing } = await supabase
    .from('preventive_items')
    .select('id, rule_id, status')
    .eq('profile_id', profileId)
    .in('rule_id', ruleIds);

  const existingByRule = new Map<string, { id: string; status: PreventiveStatus }>();
  for (const row of (existing ?? []) as { id: string; rule_id: string; status: PreventiveStatus }[]) {
    existingByRule.set(row.rule_id, { id: row.id, status: row.status });
  }

  // Gap-tracking timestamps. identified_at gets set the first time a row
  // is created in a gap state; closed_at gets set when we transition into
  // a closed state. For other rows we preserve whatever the DB has.
  const GAP_STATUSES: PreventiveStatus[] = ['due', 'due_soon', 'needs_review'];
  const existingGapData = new Map<
    string,
    { gap_identified_at: string | null; gap_closed_at: string | null }
  >();
  if (ruleIds.length > 0) {
    const { data: gapRows } = await supabase
      .from('preventive_items')
      .select('rule_id, gap_identified_at, gap_closed_at')
      .eq('profile_id', profileId)
      .in('rule_id', ruleIds);
    for (const row of (gapRows ?? []) as {
      rule_id: string;
      gap_identified_at: string | null;
      gap_closed_at: string | null;
    }[]) {
      existingGapData.set(row.rule_id, {
        gap_identified_at: row.gap_identified_at,
        gap_closed_at: row.gap_closed_at,
      });
    }
  }

  const nowIso = new Date().toISOString();

  const rows = upserts.map((u) => {
    const prior = existingByRule.get(u.ruleId);
    const priorGap = existingGapData.get(u.ruleId);
    const isNewRow = !prior;
    const becomingGap = GAP_STATUSES.includes(u.status);
    const becomingClosed = u.status === 'completed' || u.status === 'up_to_date';

    let gapIdentifiedAt = priorGap?.gap_identified_at ?? null;
    if (!gapIdentifiedAt && isNewRow && becomingGap) {
      gapIdentifiedAt = nowIso;
    }

    let gapClosedAt = priorGap?.gap_closed_at ?? null;
    if (becomingClosed && !gapClosedAt) {
      gapClosedAt = nowIso;
    }
    if (!becomingClosed && becomingGap) {
      // Reopened into a gap state — clear the prior closure.
      gapClosedAt = null;
    }

    return {
      profile_id: profileId,
      household_id: householdId,
      rule_id: u.ruleId,
      status: u.status,
      due_date: u.dueDate,
      next_due_date: u.nextDueDate,
      rationale: u.rationale,
      missing_data: u.missingData,
      hedis_measure_code: u.hedisMeasureCode,
      selected_method: u.selectedMethod,
      gap_identified_at: gapIdentifiedAt,
      gap_closed_at: gapClosedAt,
    };
  });

  const { data, error } = await supabase
    .from('preventive_items')
    .upsert(rows, { onConflict: 'profile_id,rule_id' })
    .select();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const saved = (data ?? []) as PreventiveItem[];

  // Emit audit events: 'created' for new rows, 'status_changed' when status moved.
  const eventRows: Array<{
    preventive_item_id: string;
    profile_id: string;
    household_id: string;
    event_type: PreventiveEventType;
    from_status: PreventiveStatus | null;
    to_status: PreventiveStatus | null;
    detail: Record<string, unknown> | null;
    created_by: 'system';
  }> = [];

  for (const item of saved) {
    const prior = existingByRule.get(item.rule_id);
    if (!prior) {
      eventRows.push({
        preventive_item_id: item.id,
        profile_id: profileId,
        household_id: householdId,
        event_type: 'created',
        from_status: null,
        to_status: item.status,
        detail: { rule_id: item.rule_id },
        created_by: 'system',
      });
    } else if (prior.status !== item.status) {
      eventRows.push({
        preventive_item_id: item.id,
        profile_id: profileId,
        household_id: householdId,
        event_type: 'status_changed',
        from_status: prior.status,
        to_status: item.status,
        detail: { rule_id: item.rule_id, trigger: 'eligibility_scan' },
        created_by: 'system',
      });
    } else {
      eventRows.push({
        preventive_item_id: item.id,
        profile_id: profileId,
        household_id: householdId,
        event_type: 'recomputed',
        from_status: prior.status,
        to_status: item.status,
        detail: { rule_id: item.rule_id },
        created_by: 'system',
      });
    }
  }

  if (eventRows.length > 0) {
    await supabase.from('preventive_item_events').insert(eventRows);
  }

  return { success: true, data: saved };
}

/**
 * Partial update of a preventive item. Emits an audit event when status changes.
 */
export async function updatePreventiveItem(
  itemId: string,
  updates: Partial<
    Pick<
      PreventiveItem,
      | 'status'
      | 'due_date'
      | 'due_window_start'
      | 'due_window_end'
      | 'last_done_date'
      | 'last_done_source'
      | 'last_done_evidence_id'
      | 'next_due_date'
      | 'rationale'
      | 'missing_data'
      | 'deferred_until'
      | 'declined_reason'
      | 'linked_task_id'
      | 'linked_appointment_id'
      | 'notes'
      | 'selected_method'
      | 'gap_identified_at'
      | 'gap_closed_at'
    >
  >,
  createdBy: 'user' | 'system' | 'extraction' = 'user',
): Promise<ServiceResult<PreventiveItem>> {
  let priorStatus: PreventiveStatus | null = null;
  if (updates.status) {
    const { data: prior } = await supabase
      .from('preventive_items')
      .select('status')
      .eq('id', itemId)
      .single();
    priorStatus = (prior?.status as PreventiveStatus | undefined) ?? null;
  }

  const { data, error } = await supabase
    .from('preventive_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update item' };
  }

  const item = data as PreventiveItem;

  if (updates.status && priorStatus && priorStatus !== updates.status) {
    await createPreventiveEvent({
      itemId: item.id,
      profileId: item.profile_id,
      householdId: item.household_id,
      eventType: mapStatusToEventType(updates.status),
      fromStatus: priorStatus,
      toStatus: updates.status,
      detail: { updated_fields: Object.keys(updates) },
      createdBy,
    });
  } else if (!updates.status) {
    await createPreventiveEvent({
      itemId: item.id,
      profileId: item.profile_id,
      householdId: item.household_id,
      eventType: 'data_updated',
      detail: { updated_fields: Object.keys(updates) },
      createdBy,
    });
  }

  return { success: true, data: item };
}

function mapStatusToEventType(status: PreventiveStatus): PreventiveEventType {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'deferred':
      return 'deferred';
    case 'declined':
      return 'declined';
    default:
      return 'status_changed';
  }
}

// ── Events ─────────────────────────────────────────────────────────────────

export async function createPreventiveEvent(params: {
  itemId: string;
  profileId: string;
  householdId: string;
  eventType: PreventiveEventType;
  fromStatus?: PreventiveStatus | null;
  toStatus?: PreventiveStatus | null;
  detail?: Record<string, unknown> | null;
  createdBy?: 'system' | 'user' | 'extraction';
}): Promise<ServiceResult<PreventiveItemEvent>> {
  const { data, error } = await supabase
    .from('preventive_item_events')
    .insert({
      preventive_item_id: params.itemId,
      profile_id: params.profileId,
      household_id: params.householdId,
      event_type: params.eventType,
      from_status: params.fromStatus ?? null,
      to_status: params.toStatus ?? null,
      detail: params.detail ?? null,
      created_by: params.createdBy ?? 'system',
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to create event' };
  }

  return { success: true, data: data as PreventiveItemEvent };
}

export async function fetchPreventiveItemEvents(
  itemId: string,
): Promise<ServiceResult<PreventiveItemEvent[]>> {
  const { data, error } = await supabase
    .from('preventive_item_events')
    .select('*')
    .eq('preventive_item_id', itemId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as PreventiveItemEvent[] };
}

// ── Orchestrator ───────────────────────────────────────────────────────────

export interface RunAndPersistScanResult extends EligibilityScanResult {
  savedItems: PreventiveItem[];
  lastScannedAt: string;
}

/**
 * End-to-end scan: load profile demographics + conditions, fetch rules,
 * run the deterministic engine, and persist the output.
 */
export async function runAndPersistScan(
  profileId: string,
  householdId: string,
): Promise<ServiceResult<RunAndPersistScanResult>> {
  const [profileRes, rulesRes, itemsRes] = await Promise.all([
    fetchProfileDetail(profileId),
    fetchRules(),
    supabase
      .from('preventive_items')
      .select('*')
      .eq('profile_id', profileId),
  ]);

  if (!profileRes.success) return { success: false, error: profileRes.error };
  if (!rulesRes.success) return { success: false, error: rulesRes.error };
  if (itemsRes.error) {
    return { success: false, error: itemsRes.error.message, code: itemsRes.error.code };
  }

  const profile = profileRes.data;

  const conditionFacts = profile.facts.filter((f) => f.category === 'condition');
  const conditions = conditionFacts
    .map((f) => {
      const v = f.value_json as Record<string, unknown>;
      const name = v.condition_name ?? v.name;
      return typeof name === 'string' ? name : null;
    })
    .filter((c): c is string => !!c);

  const scan = runEligibilityScan({
    profileId,
    householdId,
    profileFacts: {
      dateOfBirth: profile.date_of_birth,
      sex: profile.gender,
      conditions,
    },
    rules: rulesRes.data,
    existingItems: (itemsRes.data ?? []) as PreventiveItem[],
  });

  const upsertRes = await upsertPreventiveItems(scan.itemsToUpsert, profileId, householdId);
  if (!upsertRes.success) {
    return { success: false, error: upsertRes.error };
  }

  // Archive items whose rule no longer applies to this profile.
  if (scan.itemsToArchive.length > 0) {
    await archivePreventiveItems(scan.itemsToArchive, profileId, householdId);
  }

  return {
    success: true,
    data: {
      ...scan,
      savedItems: upsertRes.data,
      lastScannedAt: new Date().toISOString(),
    },
  };
}

/**
 * Flip a batch of preventive_items to 'archived' with a per-item rationale.
 * Emits a status_changed event for each transition. Skips items that were
 * already archived or completed (the engine already filters these, but be
 * defensive).
 */
async function archivePreventiveItems(
  archives: { itemId: string; ruleId: string; reason: string }[],
  profileId: string,
  householdId: string,
): Promise<void> {
  const ids = archives.map((a) => a.itemId);
  if (ids.length === 0) return;

  const { data: priorRows } = await supabase
    .from('preventive_items')
    .select('id, status')
    .in('id', ids);
  const priorByItem = new Map<string, PreventiveStatus>();
  for (const row of (priorRows ?? []) as { id: string; status: PreventiveStatus }[]) {
    priorByItem.set(row.id, row.status);
  }

  for (const a of archives) {
    const prior = priorByItem.get(a.itemId);
    if (!prior || prior === 'archived' || prior === 'completed') continue;

    const { error } = await supabase
      .from('preventive_items')
      .update({
        status: 'archived',
        rationale: a.reason,
        due_date: null,
        missing_data: [],
      })
      .eq('id', a.itemId);

    if (error) continue; // Non-fatal — leave item as-is and keep scanning.

    await createPreventiveEvent({
      itemId: a.itemId,
      profileId,
      householdId,
      eventType: 'status_changed',
      fromStatus: prior,
      toStatus: 'archived',
      detail: { reason: a.reason, trigger: 'eligibility_scan' },
      createdBy: 'system',
    });
  }
}

// ── User Actions (date, defer, decline, reopen) ───────────────────────────

/**
 * Update last_done_date on an item. Source indicates how we learned the date.
 * Emits a 'data_updated' event and re-runs the engine so the item's status
 * can be recomputed against the new last_done_date.
 */
export async function updateLastDoneDate(
  itemId: string,
  date: string | null,
  source: PreventiveLastDoneSource,
  profileId: string,
  householdId: string,
): Promise<ServiceResult<PreventiveItem>> {
  const { data, error } = await supabase
    .from('preventive_items')
    .update({
      last_done_date: date,
      last_done_source: date ? source : null,
    })
    .eq('id', itemId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update date' };
  }

  const item = data as PreventiveItem;

  await createPreventiveEvent({
    itemId,
    profileId,
    householdId,
    eventType: 'data_updated',
    detail: { field: 'last_done_date', value: date, source: date ? source : null },
    createdBy: 'user',
  });

  const rescan = await runAndPersistScan(profileId, householdId);
  if (!rescan.success) {
    return { success: true, data: item };
  }

  const fresh = rescan.data.savedItems.find((i) => i.id === itemId);
  return { success: true, data: fresh ?? item };
}

/**
 * Record which screening method the user completed/will complete. Triggers
 * a rescan so the item's next_due_date recomputes against the method's cadence.
 */
export async function setSelectedMethod(
  itemId: string,
  methodId: string | null,
  profileId: string,
  householdId: string,
): Promise<ServiceResult<PreventiveItem>> {
  const { data, error } = await supabase
    .from('preventive_items')
    .update({ selected_method: methodId })
    .eq('id', itemId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update method' };
  }

  await createPreventiveEvent({
    itemId,
    profileId,
    householdId,
    eventType: 'data_updated',
    detail: { field: 'selected_method', value: methodId },
    createdBy: 'user',
  });

  const rescan = await runAndPersistScan(profileId, householdId);
  if (!rescan.success) {
    return { success: true, data: data as PreventiveItem };
  }

  const fresh = rescan.data.savedItems.find((i) => i.id === itemId);
  return { success: true, data: fresh ?? (data as PreventiveItem) };
}

/**
 * Defer an item until a given date (or indefinitely if null).
 */
export async function deferItem(
  itemId: string,
  deferredUntil: string | null,
  profileId: string,
  householdId: string,
): Promise<ServiceResult<PreventiveItem>> {
  const { data: prior } = await supabase
    .from('preventive_items')
    .select('status')
    .eq('id', itemId)
    .single();
  const fromStatus = (prior?.status as PreventiveStatus | undefined) ?? null;

  const { data, error } = await supabase
    .from('preventive_items')
    .update({
      status: 'deferred',
      deferred_until: deferredUntil,
      declined_reason: null,
    })
    .eq('id', itemId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to defer item' };
  }

  await createPreventiveEvent({
    itemId,
    profileId,
    householdId,
    eventType: 'deferred',
    fromStatus,
    toStatus: 'deferred',
    detail: { deferred_until: deferredUntil },
    createdBy: 'user',
  });

  return { success: true, data: data as PreventiveItem };
}

/**
 * Decline an item, optionally capturing a reason.
 */
export async function declineItem(
  itemId: string,
  reason: string | null,
  profileId: string,
  householdId: string,
): Promise<ServiceResult<PreventiveItem>> {
  const { data: prior } = await supabase
    .from('preventive_items')
    .select('status')
    .eq('id', itemId)
    .single();
  const fromStatus = (prior?.status as PreventiveStatus | undefined) ?? null;

  const { data, error } = await supabase
    .from('preventive_items')
    .update({
      status: 'declined',
      declined_reason: reason,
      deferred_until: null,
    })
    .eq('id', itemId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to decline item' };
  }

  await createPreventiveEvent({
    itemId,
    profileId,
    householdId,
    eventType: 'declined',
    fromStatus,
    toStatus: 'declined',
    detail: { reason },
    createdBy: 'user',
  });

  return { success: true, data: data as PreventiveItem };
}

/**
 * Clear a deferred/declined state and let the engine recompute the status.
 */
export async function reopenItem(
  itemId: string,
  profileId: string,
  householdId: string,
): Promise<ServiceResult<PreventiveItem>> {
  const { data: prior } = await supabase
    .from('preventive_items')
    .select('status')
    .eq('id', itemId)
    .single();
  const fromStatus = (prior?.status as PreventiveStatus | undefined) ?? null;

  // Flip status to needs_review so the engine (which preserves deferred/declined)
  // will treat the row as reopened and recompute against current data.
  const { data, error } = await supabase
    .from('preventive_items')
    .update({
      status: 'needs_review',
      deferred_until: null,
      declined_reason: null,
    })
    .eq('id', itemId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to reopen item' };
  }

  await createPreventiveEvent({
    itemId,
    profileId,
    householdId,
    eventType: 'reopened',
    fromStatus,
    toStatus: 'needs_review',
    detail: null,
    createdBy: 'user',
  });

  const rescan = await runAndPersistScan(profileId, householdId);
  if (!rescan.success) {
    return { success: true, data: data as PreventiveItem };
  }

  const fresh = rescan.data.savedItems.find((i) => i.id === itemId);
  return { success: true, data: fresh ?? (data as PreventiveItem) };
}

// ── Intent Sheets ─────────────────────────────────────────────────────────

const TIER_TO_PRIORITY: Record<PreventiveTaskTier, TaskPriority> = {
  critical: 'urgent',
  important: 'high',
  helpful: 'medium',
};

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/**
 * Create a preventive intent sheet in 'review_ready' state with the provided
 * proposed items. The user will review and confirm/commit it next.
 */
export async function createIntentSheet(params: {
  profileId: string;
  householdId: string;
  content: PreventiveIntentSheetContent;
}): Promise<ServiceResult<PreventiveIntentSheet>> {
  const { data, error } = await supabase
    .from('preventive_intent_sheets')
    .insert({
      profile_id: params.profileId,
      household_id: params.householdId,
      status: 'review_ready',
      items_json: params.content.items,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to create intent sheet' };
  }

  // Emit intent_proposed event per included preventive item.
  const eventRows = params.content.items.map((it) => ({
    preventive_item_id: it.preventiveItemId,
    profile_id: params.profileId,
    household_id: params.householdId,
    event_type: 'intent_proposed' as PreventiveEventType,
    from_status: null as PreventiveStatus | null,
    to_status: null as PreventiveStatus | null,
    detail: { intent_sheet_id: data.id, rule_code: it.ruleCode } as Record<string, unknown>,
    created_by: 'user' as const,
  }));
  if (eventRows.length > 0) {
    await supabase.from('preventive_item_events').insert(eventRows);
  }

  return { success: true, data: data as PreventiveIntentSheet };
}

/**
 * Patch an existing intent sheet (user edits or status changes pre-commit).
 */
export async function updateIntentSheet(
  sheetId: string,
  updates: {
    userEditsJson?: Record<string, unknown> | null;
    status?: PreventiveIntentSheetStatus;
  },
): Promise<ServiceResult<PreventiveIntentSheet>> {
  const patch: Record<string, unknown> = {};
  if (updates.userEditsJson !== undefined) patch.user_edits_json = updates.userEditsJson;
  if (updates.status !== undefined) {
    patch.status = updates.status;
    if (updates.status === 'confirmed') patch.confirmed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('preventive_intent_sheets')
    .update(patch)
    .eq('id', sheetId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update intent sheet' };
  }

  return { success: true, data: data as PreventiveIntentSheet };
}

/**
 * Commit an intent sheet: create tasks + reminders for each included item,
 * move each preventive_item to 'scheduled' with a linked_task_id, emit
 * intent_committed events, and mark the sheet as committed.
 */
export async function commitIntentSheet(params: {
  sheetId: string;
  profileId: string;
  householdId: string;
  content: PreventiveIntentSheetContent;
  userId: string;
}): Promise<ServiceResult<{ taskCount: number; reminderCount: number }>> {
  let taskCount = 0;
  let reminderCount = 0;

  for (const item of params.content.items) {
    const createdTaskIds: string[] = [];

    // 1a. Create tasks.
    for (const t of item.proposedTasks) {
      const tier = t.tier as TaskTier;
      const priority = TIER_TO_PRIORITY[t.tier];
      const dueDate = t.dueInDays !== null ? addDaysIso(t.dueInDays) : undefined;

      const taskResult = await createTask(
        {
          profile_id: params.profileId,
          title: t.title,
          description: t.description,
          due_date: dueDate,
          priority,
          source_type: 'preventive',
          source_ref: item.preventiveItemId,
          trigger_type: 'extraction',
          trigger_source: `preventive_intent_sheet:${params.sheetId}`,
          context_json: {
            tier,
            instructions: t.description ? [t.description] : undefined,
          },
        },
        params.userId,
      );

      if (!taskResult.success) {
        return { success: false, error: taskResult.error };
      }

      createdTaskIds.push(taskResult.data.id);
      taskCount += 1;
    }

    // 1b. Create reminder-only tasks (low priority, with reminder_at set).
    for (const r of item.proposedReminders) {
      const remindAt = addDaysIso(r.remindInDays);
      const reminderResult = await createTask(
        {
          profile_id: params.profileId,
          title: r.title,
          priority: 'low',
          due_date: remindAt,
          reminder_at: remindAt,
          source_type: 'preventive',
          source_ref: item.preventiveItemId,
          trigger_type: 'time_based',
          trigger_source: `preventive_intent_sheet:${params.sheetId}`,
          context_json: { tier: 'helpful' },
        },
        params.userId,
      );

      if (!reminderResult.success) {
        return { success: false, error: reminderResult.error };
      }

      reminderCount += 1;
    }

    // 2. Flip preventive_item → scheduled, link first task.
    const { data: priorRow } = await supabase
      .from('preventive_items')
      .select('status')
      .eq('id', item.preventiveItemId)
      .single();
    const fromStatus = (priorRow?.status as PreventiveStatus | undefined) ?? null;

    const { error: updateErr } = await supabase
      .from('preventive_items')
      .update({
        status: 'scheduled',
        linked_task_id: createdTaskIds[0] ?? null,
      })
      .eq('id', item.preventiveItemId);

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    // 3. Audit: intent_committed event per item.
    await createPreventiveEvent({
      itemId: item.preventiveItemId,
      profileId: params.profileId,
      householdId: params.householdId,
      eventType: 'intent_committed',
      fromStatus,
      toStatus: 'scheduled',
      detail: {
        intent_sheet_id: params.sheetId,
        task_ids: createdTaskIds,
        task_count: createdTaskIds.length,
        reminder_count: item.proposedReminders.length,
      },
      createdBy: 'user',
    });
  }

  // 4. Mark the sheet as committed.
  const { error: sheetErr } = await supabase
    .from('preventive_intent_sheets')
    .update({
      status: 'committed',
      committed_at: new Date().toISOString(),
    })
    .eq('id', params.sheetId);

  if (sheetErr) {
    return { success: false, error: sheetErr.message };
  }

  // 5. Top-level audit event for commit.
  await supabase.from('audit_events').insert({
    profile_id: params.profileId,
    actor_id: params.userId,
    event_type: 'preventive_intent_sheet.committed',
    metadata: {
      intent_sheet_id: params.sheetId,
      item_count: params.content.items.length,
      task_count: taskCount,
      reminder_count: reminderCount,
    },
  });

  return { success: true, data: { taskCount, reminderCount } };
}

export async function fetchIntentSheets(
  profileId: string,
): Promise<ServiceResult<PreventiveIntentSheet[]>> {
  const { data, error } = await supabase
    .from('preventive_intent_sheets')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as PreventiveIntentSheet[] };
}

export async function fetchIntentSheet(
  sheetId: string,
): Promise<ServiceResult<PreventiveIntentSheet>> {
  const { data, error } = await supabase
    .from('preventive_intent_sheets')
    .select('*')
    .eq('id', sheetId)
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Intent sheet not found' };
  }

  return { success: true, data: data as PreventiveIntentSheet };
}

// ── Document-Backed Completion ────────────────────────────────────────────

const PREVENTIVE_DOCUMENT_BUCKET = 'result-documents';

/**
 * Upload a document that proves a preventive screening was completed.
 * Storage path: {householdId}/preventive/{itemId}/{uuid}.{ext}.
 * Returns the storage path (to be stored on the item as last_done_evidence_path).
 */
export async function uploadPreventiveDocument(params: {
  itemId: string;
  profileId: string;
  householdId: string;
  fileUri: string;
  fileName: string;
  mimeType: string;
  userId: string;
}): Promise<ServiceResult<{ filePath: string }>> {
  const { itemId, profileId, householdId, fileUri, fileName, mimeType, userId } = params;

  const ext = (fileName.split('.').pop() ?? 'bin').toLowerCase();
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const storagePath = `${householdId}/preventive/${itemId}/${uniqueId}.${ext}`;

  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: 'base64',
    });

    const { error: uploadError } = await supabase.storage
      .from(PREVENTIVE_DOCUMENT_BUCKET)
      .upload(storagePath, decode(base64), {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      return { success: false, error: uploadError.message };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'File read failed';
    return { success: false, error: message };
  }

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'preventive_evidence.uploaded',
    metadata: {
      preventive_item_id: itemId,
      mime_type: mimeType,
    },
  });

  return { success: true, data: { filePath: storagePath } };
}

/**
 * Generate a short-lived signed URL for a previously-uploaded proof document.
 */
export async function getPreventiveDocumentUrl(
  filePath: string,
  expiresInSeconds = 600,
): Promise<ServiceResult<{ url: string }>> {
  const { data, error } = await supabase.storage
    .from(PREVENTIVE_DOCUMENT_BUCKET)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return { success: false, error: error?.message ?? 'Could not generate URL' };
  }

  return { success: true, data: { url: data.signedUrl } };
}

export interface PreventiveDateExtractionResult {
  dateFound: boolean;
  completionDate: string | null;
  confidence: number;
  evidenceText: string | null;
}

/**
 * Call the extract-preventive-date Edge Function to propose a completion
 * date from an uploaded proof document.
 */
export async function extractCompletionDate(params: {
  documentBase64: string;
  mimeType: string;
  screeningType: string;
  screeningTitle: string;
}): Promise<ServiceResult<PreventiveDateExtractionResult>> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase.functions.invoke(
    'extract-preventive-date',
    {
      body: {
        documentBase64: params.documentBase64,
        mimeType: params.mimeType,
        screeningType: params.screeningType,
        screeningTitle: params.screeningTitle,
      },
    },
  );

  if (error) {
    return {
      success: false,
      error: error.message ?? 'Date extraction request failed',
    };
  }

  const payload = (data ?? {}) as {
    date_found?: boolean;
    completion_date?: string | null;
    confidence?: number;
    evidence_text?: string | null;
  };

  return {
    success: true,
    data: {
      dateFound: payload.date_found === true,
      completionDate: payload.completion_date ?? null,
      confidence: typeof payload.confidence === 'number' ? payload.confidence : 0,
      evidenceText: payload.evidence_text ?? null,
    },
  };
}

/**
 * Read a local file as base64 — used before calling extractCompletionDate.
 */
export async function readFileAsBase64(fileUri: string): Promise<ServiceResult<string>> {
  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: 'base64',
    });
    return { success: true, data: base64 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'File read failed';
    return { success: false, error: message };
  }
}

function addMonthsToDate(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setMonth(result.getMonth() + months);
  // If the target month is shorter, JS rolls forward — snap back to last day.
  if (result.getDate() < day) {
    result.setDate(0);
  }
  return result;
}

function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Mark a preventive item as completed. Sets last_done_date + source, computes
 * next_due_date from the rule's cadence, optionally stores an evidence file
 * path, completes any linked task, and emits a 'completed' audit event.
 */
export async function markAsCompleted(params: {
  itemId: string;
  profileId: string;
  householdId: string;
  completionDate: string;
  source: 'user_reported' | 'document_backed';
  evidenceDocumentPath?: string | null;
  userId: string;
}): Promise<ServiceResult<PreventiveItem>> {
  const {
    itemId,
    profileId,
    householdId,
    completionDate,
    source,
    evidenceDocumentPath,
    userId,
  } = params;

  // Load the item + rule cadence and screening_methods so we can compute
  // next_due_date — preferring the user's selected_method cadence when the
  // rule supports multiple screening methods.
  const { data: itemRow, error: itemErr } = await supabase
    .from('preventive_items')
    .select(
      'id, status, linked_task_id, rule_id, selected_method, rule:preventive_rules!rule_id(cadence_months, screening_methods)',
    )
    .eq('id', itemId)
    .single();

  if (itemErr || !itemRow) {
    return { success: false, error: itemErr?.message ?? 'Item not found' };
  }

  const priorStatus = (itemRow.status as PreventiveStatus | undefined) ?? null;
  const linkedTaskId = (itemRow.linked_task_id as string | null) ?? null;
  const selectedMethod = (itemRow.selected_method as string | null) ?? null;
  const ruleRaw = itemRow.rule as unknown;
  const ruleObj = Array.isArray(ruleRaw)
    ? (ruleRaw[0] as
        | { cadence_months?: number | null; screening_methods?: unknown }
        | undefined)
    : (ruleRaw as
        | { cadence_months?: number | null; screening_methods?: unknown }
        | null
        | undefined);

  const methods =
    ruleObj && Array.isArray(ruleObj.screening_methods)
      ? (ruleObj.screening_methods as { method_id: string; cadence_months: number }[])
      : null;

  let cadenceMonths: number | null = null;
  if (methods && methods.length > 0 && selectedMethod) {
    const picked = methods.find((m) => m.method_id === selectedMethod);
    cadenceMonths = picked ? picked.cadence_months : null;
  } else if (!methods || methods.length === 0) {
    cadenceMonths =
      ruleObj && typeof ruleObj.cadence_months === 'number'
        ? ruleObj.cadence_months
        : null;
  }

  let nextDueDate: string | null = null;
  if (cadenceMonths !== null && cadenceMonths > 0) {
    const completion = new Date(completionDate + 'T00:00:00');
    if (!isNaN(completion.getTime())) {
      nextDueDate = toDateOnly(addMonthsToDate(completion, cadenceMonths));
    }
  }

  const updates: Record<string, unknown> = {
    status: 'completed',
    last_done_date: completionDate,
    last_done_source: source,
    next_due_date: nextDueDate,
    due_date: null,
    missing_data: [],
    gap_closed_at: new Date().toISOString(),
  };
  if (evidenceDocumentPath !== undefined) {
    updates.last_done_evidence_path = evidenceDocumentPath;
  }

  const { data, error } = await supabase
    .from('preventive_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to mark completed' };
  }

  const item = data as PreventiveItem;

  // Complete the linked task (if any). Ignore errors — non-critical.
  if (linkedTaskId) {
    await updateTaskStatus(linkedTaskId, 'completed', userId);
  }

  await createPreventiveEvent({
    itemId,
    profileId,
    householdId,
    eventType: 'completed',
    fromStatus: priorStatus,
    toStatus: 'completed',
    detail: {
      completion_date: completionDate,
      source,
      has_evidence: !!evidenceDocumentPath,
      next_due_date: nextDueDate,
    },
    createdBy: 'user',
  });

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'preventive_item.completed',
    metadata: {
      preventive_item_id: itemId,
      source,
      has_evidence: !!evidenceDocumentPath,
    },
  });

  return { success: true, data: item };
}

/**
 * Undo a completion. Clears last_done_date, source, evidence, and next_due_date,
 * then re-runs the scan so the engine recomputes the appropriate status.
 */
export async function reopenCompletedItem(params: {
  itemId: string;
  profileId: string;
  householdId: string;
}): Promise<ServiceResult<PreventiveItem>> {
  const { itemId, profileId, householdId } = params;

  const { data: prior } = await supabase
    .from('preventive_items')
    .select('status')
    .eq('id', itemId)
    .single();
  const fromStatus = (prior?.status as PreventiveStatus | undefined) ?? null;

  const { data, error } = await supabase
    .from('preventive_items')
    .update({
      status: 'needs_review',
      last_done_date: null,
      last_done_source: null,
      last_done_evidence_path: null,
      next_due_date: null,
    })
    .eq('id', itemId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to reopen item' };
  }

  await createPreventiveEvent({
    itemId,
    profileId,
    householdId,
    eventType: 'reopened',
    fromStatus,
    toStatus: 'needs_review',
    detail: { undo: 'completion' },
    createdBy: 'user',
  });

  const rescan = await runAndPersistScan(profileId, householdId);
  if (!rescan.success) {
    return { success: true, data: data as PreventiveItem };
  }

  const fresh = rescan.data.savedItems.find((i) => i.id === itemId);
  return { success: true, data: fresh ?? (data as PreventiveItem) };
}
