/**
 * Ask Verify Service — Voice Retrieval trust layer.
 *
 * Marks facts as verified and resolves conflicts between competing facts. Each
 * source table has its own verification/archive semantics; this service knows
 * how to translate a logical "verify" or "archive" into the right column
 * update for each table. Unsupported tables fall back to an audit-only record.
 */

import { supabase } from '@/lib/supabase';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export type VerifiableSourceType =
  | 'profile_facts'
  | 'med_medications'
  | 'result_items'
  | 'result_lab_observations'
  | 'preventive_items';

// ── Verify ─────────────────────────────────────────────────────────────────

export interface VerifyFactParams {
  factSourceType: string;
  factSourceId: string;
  profileId: string;
  householdId: string;
}

export async function verifyFact(
  params: VerifyFactParams,
): Promise<ServiceResult<void>> {
  const { factSourceType, factSourceId, profileId } = params;
  if (!factSourceId) {
    return { success: false, error: 'factSourceId is required' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return { success: false, error: 'Not authenticated' };

  const now = new Date().toISOString();
  let applied: 'updated' | 'audit_only' = 'audit_only';

  switch (factSourceType) {
    case 'profile_facts': {
      const { error } = await supabase
        .from('profile_facts')
        .update({
          verification_status: 'verified',
          verified_at: now,
          verified_by: userId,
          updated_at: now,
        })
        .eq('id', factSourceId)
        .eq('profile_id', profileId);
      if (error) return { success: false, error: error.message };
      applied = 'updated';
      break;
    }

    case 'result_items': {
      // Only flip needs_review → ready; leave other statuses alone.
      const { data: existing, error: readErr } = await supabase
        .from('result_items')
        .select('status')
        .eq('id', factSourceId)
        .eq('profile_id', profileId)
        .single();
      if (readErr || !existing) {
        return { success: false, error: readErr?.message ?? 'Result not found' };
      }
      if (existing.status === 'needs_review') {
        const { error } = await supabase
          .from('result_items')
          .update({ status: 'ready', updated_at: now })
          .eq('id', factSourceId)
          .eq('profile_id', profileId);
        if (error) return { success: false, error: error.message };
        applied = 'updated';
      }
      break;
    }

    case 'result_lab_observations': {
      // Promote extracted → user_confirmed. No-op if already confirmed/entered.
      const { data: existing, error: readErr } = await supabase
        .from('result_lab_observations')
        .select('source')
        .eq('id', factSourceId)
        .eq('profile_id', profileId)
        .single();
      if (readErr || !existing) {
        return { success: false, error: readErr?.message ?? 'Observation not found' };
      }
      if (existing.source === 'extracted') {
        const { error } = await supabase
          .from('result_lab_observations')
          .update({ source: 'user_confirmed' })
          .eq('id', factSourceId)
          .eq('profile_id', profileId);
        if (error) return { success: false, error: error.message };
        applied = 'updated';
      }
      break;
    }

    case 'preventive_items': {
      const { data: existing, error: readErr } = await supabase
        .from('preventive_items')
        .select('last_done_source')
        .eq('id', factSourceId)
        .eq('profile_id', profileId)
        .single();
      if (readErr || !existing) {
        return { success: false, error: readErr?.message ?? 'Preventive item not found' };
      }
      if (existing.last_done_source === 'extracted') {
        const { error } = await supabase
          .from('preventive_items')
          .update({ last_done_source: 'user_reported', updated_at: now })
          .eq('id', factSourceId)
          .eq('profile_id', profileId);
        if (error) return { success: false, error: error.message };
        applied = 'updated';
      }
      break;
    }

    case 'med_medications': {
      // No verification column; record as audit-only so trust state lives in the log.
      break;
    }

    default: {
      // Unknown table — record audit event only.
      break;
    }
  }

  const { error: auditErr } = await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'fact.verified',
    metadata: {
      source_type: factSourceType,
      source_id: factSourceId,
      applied,
    },
  });
  if (auditErr) return { success: false, error: auditErr.message };

  return { success: true, data: undefined };
}

// ── Resolve conflict ───────────────────────────────────────────────────────

export interface ResolveConflictParams {
  keepFactSourceId: string;
  keepFactSourceType: string;
  archiveFactSourceIds: { id: string; sourceType: string }[];
  profileId: string;
  householdId: string;
}

export async function resolveConflict(
  params: ResolveConflictParams,
): Promise<ServiceResult<void>> {
  const {
    keepFactSourceId,
    keepFactSourceType,
    archiveFactSourceIds,
    profileId,
    householdId,
  } = params;

  if (!keepFactSourceId) {
    return { success: false, error: 'keepFactSourceId is required' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return { success: false, error: 'Not authenticated' };

  // 1. Mark the "keep" fact as verified.
  const verifyResult = await verifyFact({
    factSourceType: keepFactSourceType,
    factSourceId: keepFactSourceId,
    profileId,
    householdId,
  });
  if (!verifyResult.success) return verifyResult;

  // 2. Archive the losers, each per their own semantics.
  const now = new Date().toISOString();
  const archivedResults: { id: string; sourceType: string; applied: string }[] = [];

  for (const loser of archiveFactSourceIds) {
    const applied = await archiveFact(loser.sourceType, loser.id, profileId, now);
    if (!applied.success) return applied;
    archivedResults.push({ id: loser.id, sourceType: loser.sourceType, applied: applied.data });
  }

  // 3. Audit the resolution.
  const { error: auditErr } = await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'fact.conflict_resolved',
    metadata: {
      kept: { source_type: keepFactSourceType, source_id: keepFactSourceId },
      archived: archivedResults,
      archived_count: archivedResults.length,
    },
  });
  if (auditErr) return { success: false, error: auditErr.message };

  return { success: true, data: undefined };
}

async function archiveFact(
  sourceType: string,
  sourceId: string,
  profileId: string,
  now: string,
): Promise<ServiceResult<string>> {
  switch (sourceType) {
    case 'profile_facts': {
      const { error } = await supabase
        .from('profile_facts')
        .update({ deleted_at: now, updated_at: now })
        .eq('id', sourceId)
        .eq('profile_id', profileId);
      if (error) return { success: false, error: error.message };
      return { success: true, data: 'soft_deleted' };
    }

    case 'med_medications': {
      const { error } = await supabase
        .from('med_medications')
        .update({ status: 'stopped', updated_at: now })
        .eq('id', sourceId)
        .eq('profile_id', profileId);
      if (error) return { success: false, error: error.message };
      return { success: true, data: 'status_stopped' };
    }

    case 'result_items': {
      const { error } = await supabase
        .from('result_items')
        .update({ status: 'archived', updated_at: now })
        .eq('id', sourceId)
        .eq('profile_id', profileId);
      if (error) return { success: false, error: error.message };
      return { success: true, data: 'status_archived' };
    }

    case 'result_lab_observations': {
      // No soft-delete column — hard delete. Audited via the resolution event.
      const { error } = await supabase
        .from('result_lab_observations')
        .delete()
        .eq('id', sourceId)
        .eq('profile_id', profileId);
      if (error) return { success: false, error: error.message };
      return { success: true, data: 'hard_deleted' };
    }

    case 'preventive_items': {
      // Preventive items aren't user-duplicable in normal flow; conservative no-op.
      return { success: true, data: 'no_op' };
    }

    default:
      return { success: true, data: 'unknown_source_type_no_op' };
  }
}
