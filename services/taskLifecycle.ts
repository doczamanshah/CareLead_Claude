import { supabase } from '@/lib/supabase';
import type { Task, TaskTier } from '@/lib/types/tasks';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Result of an expiry scan. Contains the set of task ids that were expired
 * and a reason per id (surfaced in audit events — never in UI copy).
 */
export interface ExpiryOutcome {
  expiredIds: string[];
  reasons: Record<string, string>;
}

function getTier(task: Task): TaskTier | null {
  const t = task.context_json?.tier;
  if (t === 'critical' || t === 'important' || t === 'helpful') return t;
  // Priority → tier fallback
  if (task.priority === 'urgent') return 'critical';
  if (task.priority === 'high') return 'important';
  if (task.priority === 'medium') return 'helpful';
  return 'helpful';
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysOverdue(task: Task, now = new Date()): number {
  if (!task.due_date) return 0;
  const due = new Date(task.due_date);
  if (Number.isNaN(due.getTime())) return 0;
  return Math.floor((now.getTime() - due.getTime()) / MS_PER_DAY);
}

/**
 * Evaluate expiry rules against a set of open tasks. Pure function — no DB
 * writes. The caller should pair this with `applyExpiry` to persist.
 *
 * Rules:
 *   - appointment prep: appointment start_time is in the past → expire
 *   - billing: case status is 'resolved' or 'closed' → expire
 *   - preventive: item status is 'completed' or 'deferred' → expire
 *   - overdue helpful tasks >30d → expire
 *   - overdue important tasks >60d → expire
 *   - critical tier: never expire
 */
export async function processTaskExpiry(
  tasks: Task[],
): Promise<ServiceResult<ExpiryOutcome>> {
  const expiredIds: string[] = [];
  const reasons: Record<string, string> = {};

  // Partition by source_type to batch the relevant lookups
  const apptIds = new Set<string>();
  const billingIds = new Set<string>();
  const preventiveIds = new Set<string>();

  for (const t of tasks) {
    if (t.status !== 'pending' && t.status !== 'in_progress') continue;
    if (!t.source_ref) continue;
    if (t.source_type === 'appointment') apptIds.add(t.source_ref);
    else if (t.source_type === 'billing') billingIds.add(t.source_ref);
    else if (t.source_type === 'preventive') preventiveIds.add(t.source_ref);
  }

  // Batch lookups — bail early if any fail
  const apptStart: Record<string, string> = {};
  if (apptIds.size > 0) {
    const { data, error } = await supabase
      .from('apt_appointments')
      .select('id, start_time')
      .in('id', Array.from(apptIds));
    if (error) return { success: false, error: error.message };
    for (const row of data ?? []) {
      const r = row as { id: string; start_time: string };
      apptStart[r.id] = r.start_time;
    }
  }

  const billingResolved = new Set<string>();
  if (billingIds.size > 0) {
    const { data, error } = await supabase
      .from('billing_cases')
      .select('id, status')
      .in('id', Array.from(billingIds));
    if (error) return { success: false, error: error.message };
    for (const row of data ?? []) {
      const r = row as { id: string; status: string };
      if (r.status === 'resolved' || r.status === 'closed') {
        billingResolved.add(r.id);
      }
    }
  }

  const preventiveDone = new Set<string>();
  if (preventiveIds.size > 0) {
    const { data, error } = await supabase
      .from('preventive_items')
      .select('id, status')
      .in('id', Array.from(preventiveIds));
    if (error) return { success: false, error: error.message };
    for (const row of data ?? []) {
      const r = row as { id: string; status: string };
      if (r.status === 'completed' || r.status === 'deferred') {
        preventiveDone.add(r.id);
      }
    }
  }

  const now = new Date();

  for (const t of tasks) {
    if (t.status !== 'pending' && t.status !== 'in_progress') continue;

    const tier = getTier(t);
    if (tier === 'critical') continue; // Critical tasks never auto-expire

    // Source-specific rules first (most authoritative)
    if (t.source_type === 'appointment' && t.source_ref) {
      const start = apptStart[t.source_ref];
      if (start && new Date(start) < now) {
        expiredIds.push(t.id);
        reasons[t.id] = 'Appointment has passed';
        continue;
      }
    }

    if (t.source_type === 'billing' && t.source_ref) {
      if (billingResolved.has(t.source_ref)) {
        expiredIds.push(t.id);
        reasons[t.id] = 'Bill resolved';
        continue;
      }
    }

    if (t.source_type === 'preventive' && t.source_ref) {
      if (preventiveDone.has(t.source_ref)) {
        expiredIds.push(t.id);
        reasons[t.id] = 'Screening already handled';
        continue;
      }
    }

    // Time-based overdue expiry
    if (t.due_date) {
      const overdue = daysOverdue(t, now);
      if (tier === 'helpful' && overdue >= 30) {
        expiredIds.push(t.id);
        reasons[t.id] = 'Expired — not completed within 30 days';
        continue;
      }
      if (tier === 'important' && overdue >= 60) {
        expiredIds.push(t.id);
        reasons[t.id] = 'Expired — not completed within 60 days';
        continue;
      }
    }
  }

  return { success: true, data: { expiredIds, reasons } };
}

/**
 * Persist expiry: sets status='expired' + expired_at/expired_reason +
 * writes audit events. Batched for efficiency but atomic per-task.
 */
export async function applyExpiry(
  outcome: ExpiryOutcome,
  profileId: string,
  userId: string,
): Promise<ServiceResult<number>> {
  if (outcome.expiredIds.length === 0) {
    return { success: true, data: 0 };
  }

  const nowIso = new Date().toISOString();

  // Supabase update supports .in() so we can do it in batches grouped by reason
  const byReason = new Map<string, string[]>();
  for (const id of outcome.expiredIds) {
    const reason = outcome.reasons[id] ?? 'Expired';
    const bucket = byReason.get(reason) ?? [];
    bucket.push(id);
    byReason.set(reason, bucket);
  }

  for (const [reason, ids] of byReason) {
    const { error } = await supabase
      .from('tasks')
      .update({
        status: 'expired',
        expired_at: nowIso,
        expired_reason: reason,
      })
      .in('id', ids);
    if (error) return { success: false, error: error.message };
  }

  // Audit events (fire-and-forget style — errors are non-fatal)
  const auditRows = outcome.expiredIds.map((id) => ({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'task.auto_expired',
    metadata: {
      task_id: id,
      reason: outcome.reasons[id] ?? 'Expired',
    },
  }));

  await supabase.from('audit_events').insert(auditRows);

  return { success: true, data: outcome.expiredIds.length };
}

/**
 * Convenience: run the full expiry pipeline (scan + persist) against a
 * profile's open tasks. Safe to call on task list load — guarded inside the
 * hook by a 24-hour cooldown.
 */
export async function runExpiryScan(
  profileId: string,
  userId: string,
): Promise<ServiceResult<number>> {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('profile_id', profileId)
    .in('status', ['pending', 'in_progress'])
    .is('deleted_at', null);

  if (error) return { success: false, error: error.message };

  const scanResult = await processTaskExpiry((tasks ?? []) as Task[]);
  if (!scanResult.success) return scanResult;

  return applyExpiry(scanResult.data, profileId, userId);
}
