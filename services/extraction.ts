/**
 * Extraction service — triggers AI extraction via Supabase Edge Function
 * and fetches intent sheets / items for review.
 */

import { supabase } from '@/lib/supabase';
import type {
  TriggerExtractionParams,
  ExtractionResponse,
  IntentSheet,
  IntentItem,
  IntentSheetWithItems,
} from '@/lib/types/intent-sheet';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Trigger AI extraction for an artifact via the extract-document Edge Function.
 * This is fire-and-forget from the UI perspective — processing happens server-side.
 * Returns the intent sheet ID so the app can navigate to the review screen.
 */
export async function triggerExtraction(
  params: TriggerExtractionParams,
): Promise<ServiceResult<ExtractionResponse>> {
  const { artifactId, profileId } = params;

  console.log('[extraction] Calling extract-document Edge Function', { artifactId, profileId });

  // Ensure we have a valid session — the Supabase gateway requires a JWT
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    console.error('[extraction] No active session — cannot call Edge Function');
    return { success: false, error: 'Not authenticated' };
  }

  console.log('[extraction] Session found, invoking function...');

  const { data, error } = await supabase.functions.invoke('extract-document', {
    body: { artifactId, profileId },
  });

  if (error) {
    console.error('[extraction] Edge Function error:', error.message, error);
    return { success: false, error: error.message ?? 'Extraction request failed' };
  }

  console.log('[extraction] Edge Function response:', JSON.stringify(data));

  // Edge Function may return a message (e.g., for voice/PDF) with no intent sheet
  if (!data?.intentSheetId) {
    return {
      success: true,
      data: {
        intentSheetId: '',
        documentType: data?.documentType ?? 'unknown',
        fieldCount: data?.fieldCount ?? 0,
      },
    };
  }

  return {
    success: true,
    data: {
      intentSheetId: data.intentSheetId,
      documentType: data.documentType,
      fieldCount: data.fieldCount,
    },
  };
}

/**
 * Fetch an intent sheet by ID.
 */
export async function fetchIntentSheet(
  intentSheetId: string,
): Promise<ServiceResult<IntentSheet>> {
  const { data, error } = await supabase
    .from('intent_sheets')
    .select('*')
    .eq('id', intentSheetId)
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: data as IntentSheet };
}

/**
 * Fetch all intent items for an intent sheet.
 */
export async function fetchIntentItems(
  intentSheetId: string,
): Promise<ServiceResult<IntentItem[]>> {
  const { data, error } = await supabase
    .from('intent_items')
    .select('*')
    .eq('intent_sheet_id', intentSheetId)
    .order('field_key', { ascending: true });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as IntentItem[] };
}

/**
 * Fetch an intent sheet with all its items in one call.
 */
export async function fetchIntentSheetWithItems(
  intentSheetId: string,
): Promise<ServiceResult<IntentSheetWithItems>> {
  const sheetResult = await fetchIntentSheet(intentSheetId);
  if (!sheetResult.success) return sheetResult;

  const itemsResult = await fetchIntentItems(intentSheetId);
  if (!itemsResult.success) return itemsResult;

  return {
    success: true,
    data: { ...sheetResult.data, items: itemsResult.data },
  };
}

/**
 * Fetch the most recent intent sheet for an artifact (if any).
 */
export async function fetchIntentSheetForArtifact(
  artifactId: string,
): Promise<ServiceResult<IntentSheet | null>> {
  const { data, error } = await supabase
    .from('intent_sheets')
    .select('*')
    .eq('artifact_id', artifactId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: data as IntentSheet | null };
}

/**
 * Fetch all pending-review intent sheets for a profile.
 */
export async function fetchPendingIntentSheets(
  profileId: string,
): Promise<ServiceResult<IntentSheet[]>> {
  const { data, error } = await supabase
    .from('intent_sheets')
    .select('*')
    .eq('profile_id', profileId)
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as IntentSheet[] };
}
