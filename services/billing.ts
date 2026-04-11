/**
 * Billing service — handles billing case CRUD, document uploads, and status events.
 *
 * SETUP REQUIRED: Create a **private** bucket named "billing-documents" in Supabase Dashboard:
 *   Storage > New Bucket > Name: "billing-documents" > Public: OFF (private)
 *
 * Storage RLS: authenticated users can access files in their household folder.
 * Path pattern: {householdId}/{caseId}/{uuid}.{ext}
 */

import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import type {
  BillingCase,
  BillingCaseWithDocCount,
  BillingDocument,
  BillingCaseStatusEvent,
  BillingExtractJob,
  BillingLedgerLine,
  CreateBillingCaseInput,
  UpdateBillingCaseInput,
  BillingDocType,
} from '@/lib/types/billing';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

const BUCKET = 'billing-documents';

// ── Cases ──────────────────────────────────────────────────────────────────

/**
 * Fetch all billing cases for a profile, ordered by created_at desc.
 * Includes a document count for each case.
 */
export async function fetchBillingCases(
  profileId: string,
): Promise<ServiceResult<BillingCaseWithDocCount[]>> {
  const { data: cases, error: casesError } = await supabase
    .from('billing_cases')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });

  if (casesError) {
    return { success: false, error: casesError.message, code: casesError.code };
  }

  if (!cases || cases.length === 0) {
    return { success: true, data: [] };
  }

  const caseIds = cases.map((c) => c.id);

  const { data: docs } = await supabase
    .from('billing_documents')
    .select('id, billing_case_id')
    .in('billing_case_id', caseIds);

  const countMap = new Map<string, number>();
  for (const doc of docs ?? []) {
    countMap.set(doc.billing_case_id, (countMap.get(doc.billing_case_id) ?? 0) + 1);
  }

  const result: BillingCaseWithDocCount[] = (cases as BillingCase[]).map((c) => ({
    ...c,
    document_count: countMap.get(c.id) ?? 0,
  }));

  return { success: true, data: result };
}

/**
 * Fetch a single billing case with document count.
 */
export async function fetchBillingCase(
  caseId: string,
): Promise<ServiceResult<BillingCaseWithDocCount>> {
  const { data, error } = await supabase
    .from('billing_cases')
    .select('*')
    .eq('id', caseId)
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Case not found' };
  }

  const { count } = await supabase
    .from('billing_documents')
    .select('id', { count: 'exact', head: true })
    .eq('billing_case_id', caseId);

  return {
    success: true,
    data: {
      ...(data as BillingCase),
      document_count: count ?? 0,
    },
  };
}

/**
 * Create a new billing case.
 */
export async function createBillingCase(
  params: CreateBillingCaseInput,
  userId: string,
): Promise<ServiceResult<BillingCase>> {
  const { data, error } = await supabase
    .from('billing_cases')
    .insert({
      profile_id: params.profileId,
      household_id: params.householdId,
      title: params.title,
      provider_name: params.providerName ?? null,
      payer_name: params.payerName ?? null,
      service_date_start: params.serviceDateStart ?? null,
      service_date_end: params.serviceDateEnd ?? null,
      notes: params.notes ?? null,
      freeform_input: params.freeformInput ?? null,
      status: 'open',
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to create case' };
  }

  const billingCase = data as BillingCase;

  // Create initial status event
  await supabase.from('billing_case_status_events').insert({
    billing_case_id: billingCase.id,
    profile_id: params.profileId,
    household_id: params.householdId,
    from_status: null,
    to_status: 'open',
    changed_by: 'user',
  });

  // Audit event
  await supabase.from('audit_events').insert({
    profile_id: params.profileId,
    actor_id: userId,
    event_type: 'billing_case.created',
    metadata: {
      billing_case_id: billingCase.id,
      title: billingCase.title,
    },
  });

  return { success: true, data: billingCase };
}

/**
 * Update a billing case (partial update).
 */
export async function updateBillingCase(
  caseId: string,
  updates: UpdateBillingCaseInput,
  userId: string,
): Promise<ServiceResult<BillingCase>> {
  // If status is changing, fetch the old status first
  let oldStatus: string | undefined;
  if (updates.status) {
    const { data: old } = await supabase
      .from('billing_cases')
      .select('status, profile_id, household_id')
      .eq('id', caseId)
      .single();
    if (old) oldStatus = old.status;
  }

  const { data, error } = await supabase
    .from('billing_cases')
    .update(updates)
    .eq('id', caseId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update case' };
  }

  const billingCase = data as BillingCase;

  // Create status event if status changed
  if (updates.status && oldStatus && oldStatus !== updates.status) {
    await supabase.from('billing_case_status_events').insert({
      billing_case_id: caseId,
      profile_id: billingCase.profile_id,
      household_id: billingCase.household_id,
      from_status: oldStatus,
      to_status: updates.status,
      changed_by: 'user',
    });
  }

  await supabase.from('audit_events').insert({
    profile_id: billingCase.profile_id,
    actor_id: userId,
    event_type: 'billing_case.updated',
    metadata: {
      billing_case_id: caseId,
      updated_fields: Object.keys(updates),
    },
  });

  return { success: true, data: billingCase };
}

/**
 * Delete a billing case (hard delete — cascades documents via DB constraint).
 */
export async function deleteBillingCase(
  caseId: string,
  userId: string,
): Promise<ServiceResult<void>> {
  // Fetch case info for audit before deleting
  const { data: caseData } = await supabase
    .from('billing_cases')
    .select('profile_id, title')
    .eq('id', caseId)
    .single();

  // Delete associated files from storage
  const { data: docs } = await supabase
    .from('billing_documents')
    .select('file_path')
    .eq('billing_case_id', caseId);

  if (docs && docs.length > 0) {
    const paths = docs.map((d) => d.file_path).filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from(BUCKET).remove(paths);
    }
  }

  const { error } = await supabase
    .from('billing_cases')
    .delete()
    .eq('id', caseId);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  if (caseData) {
    await supabase.from('audit_events').insert({
      profile_id: caseData.profile_id,
      actor_id: userId,
      event_type: 'billing_case.deleted',
      metadata: {
        billing_case_id: caseId,
        title: caseData.title,
      },
    });
  }

  return { success: true, data: undefined };
}

// ── Documents ──────────────────────────────────────────────────────────────

/**
 * Fetch all documents for a billing case.
 */
export async function fetchBillingDocuments(
  caseId: string,
): Promise<ServiceResult<BillingDocument[]>> {
  const { data, error } = await supabase
    .from('billing_documents')
    .select('*')
    .eq('billing_case_id', caseId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as BillingDocument[] };
}

/**
 * Upload a billing document file and create the billing_documents row.
 * Storage path: {householdId}/{caseId}/{uuid}.{ext}
 */
export async function uploadBillingDocument(params: {
  caseId: string;
  profileId: string;
  householdId: string;
  docType: BillingDocType;
  fileUri: string;
  fileName: string;
  mimeType: string;
  userId: string;
}): Promise<ServiceResult<BillingDocument>> {
  const { caseId, profileId, householdId, docType, fileUri, fileName, mimeType, userId } = params;

  // Generate a unique file name
  const ext = fileName.split('.').pop() ?? 'bin';
  const uniqueId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const storagePath = `${householdId}/${caseId}/${uniqueId}.${ext}`;

  // Read file as base64 and upload to storage
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

  // Create the billing_documents row
  const { data, error: insertError } = await supabase
    .from('billing_documents')
    .insert({
      billing_case_id: caseId,
      profile_id: profileId,
      household_id: householdId,
      doc_type: docType,
      file_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      source: 'upload',
    })
    .select()
    .single();

  if (insertError || !data) {
    // Clean up storage on insert failure
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { success: false, error: insertError?.message ?? 'Failed to create document record' };
  }

  // Audit event
  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'billing_document.uploaded',
    metadata: {
      billing_case_id: caseId,
      billing_document_id: (data as BillingDocument).id,
      doc_type: docType,
    },
  });

  return { success: true, data: data as BillingDocument };
}

/**
 * Delete a billing document — removes from storage and deletes the row.
 */
export async function deleteBillingDocument(
  docId: string,
  userId: string,
): Promise<ServiceResult<void>> {
  // Fetch doc info first
  const { data: doc, error: fetchError } = await supabase
    .from('billing_documents')
    .select('*')
    .eq('id', docId)
    .single();

  if (fetchError || !doc) {
    return { success: false, error: fetchError?.message ?? 'Document not found' };
  }

  const billingDoc = doc as BillingDocument;

  // Remove from storage
  if (billingDoc.file_path) {
    await supabase.storage.from(BUCKET).remove([billingDoc.file_path]);
  }

  // Delete the row
  const { error: deleteError } = await supabase
    .from('billing_documents')
    .delete()
    .eq('id', docId);

  if (deleteError) {
    return { success: false, error: deleteError.message };
  }

  // Audit event
  await supabase.from('audit_events').insert({
    profile_id: billingDoc.profile_id,
    actor_id: userId,
    event_type: 'billing_document.deleted',
    metadata: {
      billing_case_id: billingDoc.billing_case_id,
      billing_document_id: docId,
      doc_type: billingDoc.doc_type,
    },
  });

  return { success: true, data: undefined };
}

// ── Extraction ────────────────────────────────────────────────────────────

/**
 * Trigger AI extraction for a billing document via the extract-billing Edge Function.
 * Fire-and-forget from the client — the Edge Function handles processing.
 */
export async function triggerDocumentExtraction(
  documentId: string,
  caseId: string,
  profileId: string,
  householdId: string,
): Promise<ServiceResult<{ jobId: string }>> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase.functions.invoke('extract-billing', {
    body: { mode: 'document', documentId, caseId, profileId, householdId },
  });

  if (error) {
    return { success: false, error: error.message ?? 'Extraction request failed' };
  }

  return { success: true, data: { jobId: data?.jobId ?? '' } };
}

/**
 * Trigger AI extraction for freeform text via the extract-billing Edge Function.
 * Fire-and-forget from the client — the Edge Function handles processing.
 */
export async function triggerFreeformExtraction(
  caseId: string,
  profileId: string,
  householdId: string,
  text: string,
): Promise<ServiceResult<{ jobId: string }>> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase.functions.invoke('extract-billing', {
    body: { mode: 'freeform', caseId, profileId, householdId, text },
  });

  if (error) {
    return { success: false, error: error.message ?? 'Extraction request failed' };
  }

  return { success: true, data: { jobId: data?.jobId ?? '' } };
}

/**
 * Fetch all extraction jobs for a billing case.
 */
export async function fetchExtractionJobs(
  caseId: string,
): Promise<ServiceResult<BillingExtractJob[]>> {
  const { data, error } = await supabase
    .from('billing_extract_jobs')
    .select('*')
    .eq('billing_case_id', caseId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as BillingExtractJob[] };
}

/**
 * Fetch all ledger lines for a billing case.
 */
export async function fetchLedgerLines(
  caseId: string,
): Promise<ServiceResult<BillingLedgerLine[]>> {
  const { data, error } = await supabase
    .from('billing_ledger_lines')
    .select('*')
    .eq('billing_case_id', caseId)
    .order('created_at', { ascending: true });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as BillingLedgerLine[] };
}

// ── Status Events ──────────────────────────────────────────────────────────

/**
 * Create a billing case status event.
 */
export async function createBillingCaseStatusEvent(params: {
  caseId: string;
  profileId: string;
  householdId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: 'user' | 'system';
  note?: string;
}): Promise<ServiceResult<BillingCaseStatusEvent>> {
  const { data, error } = await supabase
    .from('billing_case_status_events')
    .insert({
      billing_case_id: params.caseId,
      profile_id: params.profileId,
      household_id: params.householdId,
      from_status: params.fromStatus,
      to_status: params.toStatus,
      changed_by: params.changedBy,
      note: params.note ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to create status event' };
  }

  return { success: true, data: data as BillingCaseStatusEvent };
}
