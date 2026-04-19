/**
 * Mutations triggered from the Data Quality screen.
 *
 * Lives separately from `dataQuality.ts` (pure analyzer, no DB) so that the
 * analyzer remains trivially testable / cacheable.
 */

import { supabase } from '@/lib/supabase';
import type {
  ConfirmCurrentParams,
  DataQualitySourceType,
} from '@/lib/types/dataQuality';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Confirm a single item is "still current" without editing it.
 *
 *  - profile_facts:    verification_status='verified', verified_at=now, verified_by=user
 *  - med_medications:  touch updated_at via no-op rewrite of status
 *  - preventive_items: touch updated_at via no-op rewrite of status
 *  - result_items:     no-op (results are point-in-time and don't decay)
 */
export async function confirmStillCurrent(
  params: ConfirmCurrentParams,
): Promise<ServiceResult<null>> {
  const { sourceType, sourceId, userId } = params;
  const now = new Date().toISOString();

  if (sourceType === 'profile_facts') {
    const { error } = await supabase
      .from('profile_facts')
      .update({
        verification_status: 'verified',
        verified_at: now,
        verified_by: userId,
      })
      .eq('id', sourceId);
    if (error) return { success: false, error: error.message, code: error.code };
    return { success: true, data: null };
  }

  if (sourceType === 'med_medications') {
    const { data: existing, error: fetchError } = await supabase
      .from('med_medications')
      .select('status')
      .eq('id', sourceId)
      .maybeSingle();
    if (fetchError) return { success: false, error: fetchError.message, code: fetchError.code };
    if (!existing) return { success: false, error: 'Medication not found' };
    const { error } = await supabase
      .from('med_medications')
      .update({ status: existing.status, updated_at: now })
      .eq('id', sourceId);
    if (error) return { success: false, error: error.message, code: error.code };
    return { success: true, data: null };
  }

  if (sourceType === 'preventive_items') {
    const { data: existing, error: fetchError } = await supabase
      .from('preventive_items')
      .select('status')
      .eq('id', sourceId)
      .maybeSingle();
    if (fetchError) return { success: false, error: fetchError.message, code: fetchError.code };
    if (!existing) return { success: false, error: 'Preventive item not found' };
    const { error } = await supabase
      .from('preventive_items')
      .update({ status: existing.status, updated_at: now })
      .eq('id', sourceId);
    if (error) return { success: false, error: error.message, code: error.code };
    return { success: true, data: null };
  }

  // result_items: results are point-in-time observations — confirming them
  // doesn't make sense and would mislead. Treat as a successful no-op.
  if (sourceType === 'result_items') {
    return { success: true, data: null };
  }

  return { success: false, error: `Unsupported source type: ${sourceType}` };
}

export async function confirmStillCurrentBatch(
  items: Array<{ sourceType: DataQualitySourceType; sourceId: string }>,
  userId: string | null,
): Promise<ServiceResult<{ confirmed: number; failed: number }>> {
  let confirmed = 0;
  let failed = 0;
  for (const item of items) {
    const res = await confirmStillCurrent({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      userId,
    });
    if (res.success) confirmed += 1;
    else failed += 1;
  }
  return { success: true, data: { confirmed, failed } };
}
