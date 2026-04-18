/**
 * Results (Labs/Imaging) service — handles result item CRUD, document uploads,
 * and extraction job tracking.
 *
 * SETUP REQUIRED: Create a **private** bucket named "result-documents" in
 * Supabase Dashboard:
 *   Storage > New Bucket > Name: "result-documents" > Public: OFF (private)
 *
 * Storage RLS: authenticated users can access files in their household folder.
 * Path pattern: {householdId}/{resultId}/{uuid}.{ext}
 */

import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import type {
  ResultItem,
  ResultItemWithDocCount,
  ResultDocument,
  ResultExtractJob,
  ResultLabObservation,
  CreateResultInput,
  UpdateResultInput,
  DocumentSource,
  ResultType,
  LabFlag,
} from '@/lib/types/results';

// ── Corrections Overlay Types ──────────────────────────────────────────────

export interface AnalyteCorrection {
  name?: string;
  value?: string | null;
  numeric_value?: number | null;
  unit?: string | null;
  ref_range_text?: string | null;
  flag?: LabFlag | null;
  source?: 'user_confirmed';
}

export interface AddedAnalyte {
  name: string;
  value?: string | null;
  numeric_value?: number | null;
  unit?: string | null;
  ref_range_text?: string | null;
  flag?: LabFlag | null;
}

export interface LabCorrections {
  analytes?: Record<string, AnalyteCorrection>;
  added_analytes?: AddedAnalyte[];
  removed_analytes?: string[];
}

export interface ImagingCorrections {
  modality?: string | null;
  body_part?: string | null;
  findings?: string | null;
  impression?: string | null;
  radiologist?: string | null;
  comparison?: string | null;
  technique?: string | null;
}

export interface OtherKeyFinding {
  label?: string;
  value?: string;
  confidence?: number | null;
}

export interface OtherCorrections {
  summary?: string | null;
  key_findings?: OtherKeyFinding[];
  test_category?: string | null;
}

export type ResultCorrections = LabCorrections | ImagingCorrections | OtherCorrections;

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

const BUCKET = 'result-documents';

// ── Result Items ───────────────────────────────────────────────────────────

/**
 * Fetch all results for a profile. Pinned items first, then most-recently-performed
 * (falling back to reported_at, then created_at). Returns full rows including
 * structured_data and user_corrections so the list can render previews, plus a
 * document count aggregated from result_documents.
 */
export async function fetchResults(
  profileId: string,
): Promise<ServiceResult<ResultItemWithDocCount[]>> {
  const { data: items, error: itemsError } = await supabase
    .from('result_items')
    .select('*')
    .eq('profile_id', profileId)
    .neq('status', 'archived')
    .order('is_pinned', { ascending: false })
    .order('performed_at', { ascending: false, nullsFirst: false })
    .order('reported_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (itemsError) {
    return { success: false, error: itemsError.message, code: itemsError.code };
  }

  if (!items || items.length === 0) {
    return { success: true, data: [] };
  }

  const ids = items.map((i) => i.id);
  const { data: docs } = await supabase
    .from('result_documents')
    .select('id, result_id')
    .in('result_id', ids);

  const docCount = new Map<string, number>();
  for (const d of docs ?? []) {
    docCount.set(d.result_id, (docCount.get(d.result_id) ?? 0) + 1);
  }

  const enriched: ResultItemWithDocCount[] = (items as ResultItem[]).map((i) => ({
    ...i,
    document_count: docCount.get(i.id) ?? 0,
  }));

  return { success: true, data: enriched };
}

/**
 * Fetch a single result with its document count.
 */
export async function fetchResult(
  resultId: string,
): Promise<ServiceResult<ResultItemWithDocCount>> {
  const { data, error } = await supabase
    .from('result_items')
    .select('*')
    .eq('id', resultId)
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Result not found' };
  }

  const { count } = await supabase
    .from('result_documents')
    .select('id', { count: 'exact', head: true })
    .eq('result_id', resultId);

  return {
    success: true,
    data: { ...(data as ResultItem), document_count: count ?? 0 },
  };
}

/**
 * Create a new result item.
 */
export async function createResult(
  input: CreateResultInput,
  userId: string,
): Promise<ServiceResult<ResultItem>> {
  const { data, error } = await supabase
    .from('result_items')
    .insert({
      profile_id: input.profileId,
      household_id: input.householdId,
      result_type: input.resultType,
      test_name: input.testName,
      performed_at: input.performedAt ?? null,
      reported_at: input.reportedAt ?? null,
      facility: input.facility ?? null,
      ordering_clinician: input.orderingClinician ?? null,
      source_method: input.sourceMethod,
      raw_text: input.rawText ?? null,
      notes: input.notes ?? null,
      status: 'draft',
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to create result' };
  }

  const result = data as ResultItem;

  await supabase.from('audit_events').insert({
    profile_id: input.profileId,
    actor_id: userId,
    event_type: 'result_item.created',
    metadata: {
      result_id: result.id,
      result_type: result.result_type,
      source_method: result.source_method,
    },
  });

  return { success: true, data: result };
}

/**
 * Update a result item (partial update).
 */
export async function updateResult(
  resultId: string,
  updates: UpdateResultInput,
  userId: string,
): Promise<ServiceResult<ResultItem>> {
  const { data, error } = await supabase
    .from('result_items')
    .update(updates)
    .eq('id', resultId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update result' };
  }

  const result = data as ResultItem;

  await supabase.from('audit_events').insert({
    profile_id: result.profile_id,
    actor_id: userId,
    event_type: 'result_item.updated',
    metadata: {
      result_id: resultId,
      updated_fields: Object.keys(updates),
    },
  });

  return { success: true, data: result };
}

/**
 * Delete a result item. Cascades to documents, observations, and extract jobs
 * via DB constraints. Associated storage files are removed first.
 */
export async function deleteResult(
  resultId: string,
  userId: string,
): Promise<ServiceResult<{ profileId: string }>> {
  const { data: existing, error: fetchError } = await supabase
    .from('result_items')
    .select('profile_id, test_name')
    .eq('id', resultId)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: fetchError?.message ?? 'Result not found' };
  }

  // Remove associated storage files
  const { data: docs } = await supabase
    .from('result_documents')
    .select('file_path')
    .eq('result_id', resultId);

  if (docs && docs.length > 0) {
    const paths = docs.map((d) => d.file_path).filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from(BUCKET).remove(paths);
    }
  }

  const { error } = await supabase
    .from('result_items')
    .delete()
    .eq('id', resultId);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: existing.profile_id,
    actor_id: userId,
    event_type: 'result_item.deleted',
    metadata: {
      result_id: resultId,
      test_name: existing.test_name,
    },
  });

  return { success: true, data: { profileId: existing.profile_id } };
}

/**
 * Toggle the pinned state of a result item.
 */
export async function togglePin(
  resultId: string,
  isPinned: boolean,
  userId: string,
): Promise<ServiceResult<ResultItem>> {
  const { data, error } = await supabase
    .from('result_items')
    .update({ is_pinned: isPinned })
    .eq('id', resultId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update pin state' };
  }

  const result = data as ResultItem;

  await supabase.from('audit_events').insert({
    profile_id: result.profile_id,
    actor_id: userId,
    event_type: isPinned ? 'result_item.pinned' : 'result_item.unpinned',
    metadata: { result_id: resultId },
  });

  return { success: true, data: result };
}

/**
 * Replace the tag list for a result item.
 */
export async function updateTags(
  resultId: string,
  tags: string[],
  userId: string,
): Promise<ServiceResult<ResultItem>> {
  const { data, error } = await supabase
    .from('result_items')
    .update({ tags })
    .eq('id', resultId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update tags' };
  }

  const result = data as ResultItem;

  await supabase.from('audit_events').insert({
    profile_id: result.profile_id,
    actor_id: userId,
    event_type: 'result_item.tags_updated',
    metadata: { result_id: resultId, tag_count: tags.length },
  });

  return { success: true, data: result };
}

// ── Documents ──────────────────────────────────────────────────────────────

/**
 * Fetch all documents for a result item.
 */
export async function fetchResultDocuments(
  resultId: string,
): Promise<ServiceResult<ResultDocument[]>> {
  const { data, error } = await supabase
    .from('result_documents')
    .select('*')
    .eq('result_id', resultId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as ResultDocument[] };
}

/**
 * Upload a result document file and create the result_documents row.
 * Storage path: {householdId}/{resultId}/{uuid}.{ext}
 */
export async function uploadResultDocument(params: {
  resultId: string;
  profileId: string;
  householdId: string;
  fileUri: string;
  fileName: string;
  mimeType: string;
  source: DocumentSource;
  userId: string;
}): Promise<ServiceResult<ResultDocument>> {
  const {
    resultId,
    profileId,
    householdId,
    fileUri,
    fileName,
    mimeType,
    source,
    userId,
  } = params;

  const ext = fileName.split('.').pop() ?? 'bin';
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const storagePath = `${householdId}/${resultId}/${uniqueId}.${ext}`;

  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: 'base64',
    });

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
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

  const { data, error: insertError } = await supabase
    .from('result_documents')
    .insert({
      result_id: resultId,
      profile_id: profileId,
      household_id: householdId,
      file_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      source,
    })
    .select()
    .single();

  if (insertError || !data) {
    // Clean up storage on insert failure
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return {
      success: false,
      error: insertError?.message ?? 'Failed to create document record',
    };
  }

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'result_document.uploaded',
    metadata: {
      result_id: resultId,
      result_document_id: (data as ResultDocument).id,
      source,
    },
  });

  return { success: true, data: data as ResultDocument };
}

/**
 * Delete a result document — removes from storage and deletes the row.
 */
export async function deleteResultDocument(
  docId: string,
  userId: string,
): Promise<ServiceResult<{ resultId: string; profileId: string }>> {
  const { data: doc, error: fetchError } = await supabase
    .from('result_documents')
    .select('*')
    .eq('id', docId)
    .single();

  if (fetchError || !doc) {
    return { success: false, error: fetchError?.message ?? 'Document not found' };
  }

  const resultDoc = doc as ResultDocument;

  if (resultDoc.file_path) {
    await supabase.storage.from(BUCKET).remove([resultDoc.file_path]);
  }

  const { error: deleteError } = await supabase
    .from('result_documents')
    .delete()
    .eq('id', docId);

  if (deleteError) {
    return { success: false, error: deleteError.message };
  }

  await supabase.from('audit_events').insert({
    profile_id: resultDoc.profile_id,
    actor_id: userId,
    event_type: 'result_document.deleted',
    metadata: {
      result_id: resultDoc.result_id,
      result_document_id: docId,
    },
  });

  return {
    success: true,
    data: { resultId: resultDoc.result_id, profileId: resultDoc.profile_id },
  };
}

// ── Extraction Jobs ───────────────────────────────────────────────────────

/**
 * Fetch all extraction jobs for a result item.
 */
export async function fetchResultExtractJobs(
  resultId: string,
): Promise<ServiceResult<ResultExtractJob[]>> {
  const { data, error } = await supabase
    .from('result_extract_jobs')
    .select('*')
    .eq('result_id', resultId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as ResultExtractJob[] };
}

/**
 * Trigger AI extraction for a result item via the extract-result Edge Function.
 * Fire-and-forget from the client — the Edge Function creates the job row,
 * calls Claude, and writes results back to result_items + result_lab_observations.
 *
 * Provide documentId for document-based extraction, or rely on rawText already
 * stored on the result_items row (we'll load it server-side).
 */
export async function triggerResultExtraction(params: {
  resultId: string;
  profileId: string;
  householdId: string;
  resultType: string;
  rawText?: string | null;
  documentId?: string | null;
}): Promise<ServiceResult<{ jobId: string }>> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase.functions.invoke('extract-result', {
    body: {
      resultId: params.resultId,
      profileId: params.profileId,
      householdId: params.householdId,
      resultType: params.resultType,
      rawText: params.rawText ?? null,
      documentId: params.documentId ?? null,
    },
  });

  if (error) {
    return {
      success: false,
      error: error.message ?? 'Extraction request failed',
    };
  }

  return { success: true, data: { jobId: data?.jobId ?? '' } };
}

// ── Lab Observations ──────────────────────────────────────────────────────

/**
 * Fetch all lab observations for a result item.
 */
export async function fetchLabObservations(
  resultId: string,
): Promise<ServiceResult<ResultLabObservation[]>> {
  const { data, error } = await supabase
    .from('result_lab_observations')
    .select('*')
    .eq('result_id', resultId)
    .order('analyte_name', { ascending: true });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as ResultLabObservation[] };
}

// ── Corrections & Confirmation ────────────────────────────────────────────

/**
 * Save user corrections to a result item without changing status. Stored as
 * a JSON overlay on top of the AI extraction, so the original extraction is
 * preserved and can be compared against the user's edits.
 */
export async function saveCorrections(
  resultId: string,
  corrections: ResultCorrections,
  userId: string,
): Promise<ServiceResult<ResultItem>> {
  const { data, error } = await supabase
    .from('result_items')
    .update({ user_corrections: corrections })
    .eq('id', resultId)
    .select()
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? 'Failed to save corrections',
    };
  }

  const result = data as ResultItem;

  await supabase.from('audit_events').insert({
    profile_id: result.profile_id,
    actor_id: userId,
    event_type: 'result_item.corrections_saved',
    metadata: {
      result_id: resultId,
    },
  });

  return { success: true, data: result };
}

interface ConfirmResultParams {
  resultId: string;
  profileId: string;
  householdId: string;
  corrections: ResultCorrections;
  resultType: ResultType;
  structuredData: Record<string, unknown> | null;
}

/**
 * Finalize a result: saves corrections, sets status to 'ready', syncs lab
 * observations with user-confirmed values, and writes an audit event.
 *
 * For labs, the sync semantics are:
 *   - corrected analytes      → upsert with source='user_confirmed'
 *   - manually added analytes → insert with source='user_entered'
 *   - removed analytes        → delete matching observation rows
 */
export async function confirmResult(
  params: ConfirmResultParams,
  userId: string,
): Promise<ServiceResult<ResultItem>> {
  const {
    resultId,
    profileId,
    householdId,
    corrections,
    resultType,
    structuredData,
  } = params;

  const { data: updated, error: updateError } = await supabase
    .from('result_items')
    .update({
      user_corrections: corrections,
      status: 'ready',
    })
    .eq('id', resultId)
    .select()
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message ?? 'Failed to confirm result',
    };
  }

  const result = updated as ResultItem;
  let correctedCount = 0;
  let addedCount = 0;
  let removedCount = 0;

  if (resultType === 'lab') {
    const labCorrections = corrections as LabCorrections;

    // Source-of-truth observed_at: prefer performed_at, then reported_at, then today
    const observedAt =
      result.performed_at ??
      result.reported_at ??
      new Date().toISOString().slice(0, 10);

    // Apply corrections to existing observations
    const correctedAnalytes = labCorrections.analytes ?? {};
    for (const [originalName, correction] of Object.entries(correctedAnalytes)) {
      const targetName = correction.name?.trim() || originalName;

      // If the user renamed an analyte, we need to delete the old row first
      // to avoid leaving an orphan under the original name.
      if (correction.name && correction.name.trim() !== originalName) {
        await supabase
          .from('result_lab_observations')
          .delete()
          .eq('result_id', resultId)
          .eq('analyte_name', originalName);
      }

      const flag = normalizeFlag(correction.flag);

      await supabase.from('result_lab_observations').upsert(
        {
          result_id: resultId,
          profile_id: profileId,
          household_id: householdId,
          analyte_name: targetName,
          numeric_value: correction.numeric_value ?? null,
          value_text: correction.value ?? null,
          unit: correction.unit ?? null,
          ref_range_text: correction.ref_range_text ?? null,
          flag,
          observed_at: observedAt,
          source: 'user_confirmed',
        },
        { onConflict: 'result_id,analyte_name' },
      );
      correctedCount++;
    }

    // Insert manually added analytes
    const added = labCorrections.added_analytes ?? [];
    for (const a of added) {
      if (!a.name || !a.name.trim()) continue;
      await supabase.from('result_lab_observations').upsert(
        {
          result_id: resultId,
          profile_id: profileId,
          household_id: householdId,
          analyte_name: a.name.trim(),
          numeric_value: a.numeric_value ?? null,
          value_text: a.value ?? null,
          unit: a.unit ?? null,
          ref_range_text: a.ref_range_text ?? null,
          flag: normalizeFlag(a.flag),
          observed_at: observedAt,
          source: 'user_entered',
        },
        { onConflict: 'result_id,analyte_name' },
      );
      addedCount++;
    }

    // Remove analytes the user explicitly deleted
    const removed = labCorrections.removed_analytes ?? [];
    if (removed.length > 0) {
      await supabase
        .from('result_lab_observations')
        .delete()
        .eq('result_id', resultId)
        .in('analyte_name', removed);
      removedCount = removed.length;
    }
  }

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'result_item.confirmed',
    metadata: {
      result_id: resultId,
      result_type: resultType,
      corrected_count: correctedCount,
      added_count: addedCount,
      removed_count: removedCount,
      had_structured_data: structuredData !== null,
    },
  });

  return { success: true, data: result };
}

function normalizeFlag(flag: LabFlag | null | undefined): LabFlag | null {
  if (!flag) return null;
  const allowed: LabFlag[] = ['normal', 'high', 'low', 'abnormal', 'critical'];
  return allowed.includes(flag) ? flag : null;
}

// ── Effective Data (merge structured_data + user_corrections) ─────────────

export interface EffectiveAnalyte {
  name: string;
  value: string | null;
  numeric_value: number | null;
  unit: string | null;
  ref_range_text: string | null;
  flag: LabFlag | null;
  confidence: number | null;
  edited: boolean;
  added: boolean;
}

export interface EffectiveLabData {
  analytes: EffectiveAnalyte[];
  overall_confidence: number | null;
}

export interface EffectiveImagingData {
  modality: string | null;
  body_part: string | null;
  findings: string | null;
  impression: string | null;
  radiologist: string | null;
  comparison: string | null;
  technique: string | null;
  edited_fields: Set<keyof ImagingCorrections>;
}

export interface EffectiveOtherData {
  test_category: string | null;
  summary: string | null;
  key_findings: OtherKeyFinding[];
  edited_fields: Set<string>;
}

/**
 * Merges AI-extracted structured_data with user_corrections into a single
 * "effective" view for display. Corrections override extraction. Analytes
 * that were added or edited by the user are flagged with `edited`/`added`
 * so the UI can surface an "edited" indicator.
 */
export function getEffectiveData(
  result: Pick<ResultItem, 'result_type' | 'structured_data' | 'user_corrections'>,
): EffectiveLabData | EffectiveImagingData | EffectiveOtherData | null {
  const structured = (result.structured_data ?? {}) as Record<string, unknown>;
  const corrections = (result.user_corrections ?? {}) as Record<string, unknown>;

  if (result.result_type === 'lab') {
    const baseAnalytes = (structured.analytes ?? []) as Array<{
      name?: string;
      value?: string | null;
      numeric_value?: number | null;
      unit?: string | null;
      ref_range_low?: number | null;
      ref_range_high?: number | null;
      ref_range_text?: string | null;
      flag?: LabFlag | null;
      confidence?: number | null;
    }>;

    const labCorrections = corrections as LabCorrections;
    const corrected = labCorrections.analytes ?? {};
    const removed = new Set(labCorrections.removed_analytes ?? []);
    const added = labCorrections.added_analytes ?? [];

    const merged: EffectiveAnalyte[] = [];

    for (const a of baseAnalytes) {
      if (!a.name) continue;
      if (removed.has(a.name)) continue;

      const override = corrected[a.name];
      if (override) {
        merged.push({
          name: override.name ?? a.name,
          value: override.value ?? a.value ?? null,
          numeric_value: override.numeric_value ?? a.numeric_value ?? null,
          unit: override.unit ?? a.unit ?? null,
          ref_range_text:
            override.ref_range_text ??
            a.ref_range_text ??
            buildRangeText(a.ref_range_low, a.ref_range_high),
          flag: (override.flag ?? a.flag ?? null) as LabFlag | null,
          confidence: a.confidence ?? null,
          edited: true,
          added: false,
        });
      } else {
        merged.push({
          name: a.name,
          value: a.value ?? null,
          numeric_value: a.numeric_value ?? null,
          unit: a.unit ?? null,
          ref_range_text:
            a.ref_range_text ?? buildRangeText(a.ref_range_low, a.ref_range_high),
          flag: (a.flag ?? null) as LabFlag | null,
          confidence: a.confidence ?? null,
          edited: false,
          added: false,
        });
      }
    }

    for (const a of added) {
      if (!a.name) continue;
      merged.push({
        name: a.name,
        value: a.value ?? null,
        numeric_value: a.numeric_value ?? null,
        unit: a.unit ?? null,
        ref_range_text: a.ref_range_text ?? null,
        flag: (a.flag ?? null) as LabFlag | null,
        confidence: null,
        edited: false,
        added: true,
      });
    }

    const overall =
      typeof structured.overall_confidence === 'number'
        ? (structured.overall_confidence as number)
        : null;

    return { analytes: merged, overall_confidence: overall };
  }

  if (result.result_type === 'imaging') {
    const imgCorrections = corrections as ImagingCorrections;
    const editedFields = new Set<keyof ImagingCorrections>();
    const stringOrNull = (v: unknown) => (typeof v === 'string' ? v : null);

    const pick = (key: keyof ImagingCorrections): string | null => {
      if (key in imgCorrections && imgCorrections[key] !== undefined) {
        editedFields.add(key);
        return imgCorrections[key] ?? null;
      }
      return stringOrNull(structured[key]);
    };

    return {
      modality: pick('modality'),
      body_part: pick('body_part'),
      findings: pick('findings'),
      impression: pick('impression'),
      radiologist: pick('radiologist'),
      comparison: pick('comparison'),
      technique: pick('technique'),
      edited_fields: editedFields,
    };
  }

  // OTHER
  const otherCorrections = corrections as OtherCorrections;
  const editedFields = new Set<string>();

  const hasSummaryOverride = 'summary' in otherCorrections;
  const summary = hasSummaryOverride
    ? otherCorrections.summary ?? null
    : (typeof structured.summary === 'string' ? structured.summary : null);
  if (hasSummaryOverride) editedFields.add('summary');

  const hasCategoryOverride = 'test_category' in otherCorrections;
  const test_category = hasCategoryOverride
    ? otherCorrections.test_category ?? null
    : (typeof structured.test_category === 'string'
        ? structured.test_category
        : null);
  if (hasCategoryOverride) editedFields.add('test_category');

  const hasFindingsOverride = 'key_findings' in otherCorrections;
  const key_findings = hasFindingsOverride
    ? otherCorrections.key_findings ?? []
    : ((structured.key_findings ?? []) as OtherKeyFinding[]);
  if (hasFindingsOverride) editedFields.add('key_findings');

  return { test_category, summary, key_findings, edited_fields: editedFields };
}

function buildRangeText(
  low: number | null | undefined,
  high: number | null | undefined,
): string | null {
  if (low != null && high != null) return `${low}–${high}`;
  return null;
}
