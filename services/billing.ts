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
import { createTask } from '@/services/tasks';
import type {
  BillingCase,
  BillingCaseWithDocCount,
  BillingDocument,
  BillingCaseStatusEvent,
  BillingExtractJob,
  BillingLedgerLine,
  BillingCaseFinding,
  BillingCasePayment,
  BillingDenialRecord,
  BillingCaseCallLog,
  BillingCaseParty,
  CallParty,
  ReconciliationFinding,
  CreateBillingCaseInput,
  UpdateBillingCaseInput,
  UpdatePaymentInput,
  CreatePaymentInput,
  PaymentSummary,
  BillingDocType,
  BillingCaseAction,
  BillingActionStatus,
  BillingActionType,
  DenialCategory,
  BillingAppealPacket,
  AppealPacketStatus,
  AppealChecklist,
} from '@/lib/types/billing';
import { DEFAULT_APPEAL_CHECKLIST } from '@/lib/types/billing';
import type { TaskTier, TaskPriority } from '@/lib/types/tasks';

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

  const [docsRes, findingsRes, paymentsRes] = await Promise.all([
    supabase
      .from('billing_documents')
      .select('id, billing_case_id, created_at')
      .in('billing_case_id', caseIds),
    supabase
      .from('billing_case_findings')
      .select('billing_case_id, is_resolved')
      .in('billing_case_id', caseIds)
      .eq('is_resolved', false),
    supabase
      .from('billing_case_payments')
      .select('billing_case_id, kind, amount, created_at')
      .in('billing_case_id', caseIds),
  ]);

  const docCountMap = new Map<string, number>();
  const lastDocDateMap = new Map<string, string>();
  for (const doc of docsRes.data ?? []) {
    docCountMap.set(doc.billing_case_id, (docCountMap.get(doc.billing_case_id) ?? 0) + 1);
    const prev = lastDocDateMap.get(doc.billing_case_id);
    if (!prev || doc.created_at > prev) {
      lastDocDateMap.set(doc.billing_case_id, doc.created_at);
    }
  }

  const findingsCountMap = new Map<string, number>();
  for (const f of findingsRes.data ?? []) {
    findingsCountMap.set(f.billing_case_id, (findingsCountMap.get(f.billing_case_id) ?? 0) + 1);
  }

  const paidMap = new Map<string, number>();
  const lastPaymentDateMap = new Map<string, string>();
  for (const p of paymentsRes.data ?? []) {
    const signed = p.kind === 'refund' ? -Number(p.amount) : Number(p.amount);
    paidMap.set(p.billing_case_id, (paidMap.get(p.billing_case_id) ?? 0) + signed);
    const prev = lastPaymentDateMap.get(p.billing_case_id);
    if (!prev || p.created_at > prev) {
      lastPaymentDateMap.set(p.billing_case_id, p.created_at);
    }
  }

  const result: BillingCaseWithDocCount[] = (cases as BillingCase[]).map((c) => {
    const lastDoc = lastDocDateMap.get(c.id);
    const lastPayment = lastPaymentDateMap.get(c.id);
    const candidates = [c.updated_at, c.last_extracted_at, c.last_reconciled_at, lastDoc, lastPayment]
      .filter((v): v is string => !!v);
    const lastActivity = candidates.reduce(
      (max, cur) => (cur > max ? cur : max),
      c.created_at,
    );
    return {
      ...c,
      document_count: docCountMap.get(c.id) ?? 0,
      unresolved_findings_count: findingsCountMap.get(c.id) ?? 0,
      total_paid: paidMap.get(c.id) ?? 0,
      last_activity_at: lastActivity,
    };
  });

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

  const billingCase = data as BillingCase;

  const [docsRes, findingsRes, paymentsRes] = await Promise.all([
    supabase
      .from('billing_documents')
      .select('id, created_at')
      .eq('billing_case_id', caseId),
    supabase
      .from('billing_case_findings')
      .select('id', { count: 'exact', head: true })
      .eq('billing_case_id', caseId)
      .eq('is_resolved', false),
    supabase
      .from('billing_case_payments')
      .select('kind, amount, created_at')
      .eq('billing_case_id', caseId),
  ]);

  let lastDoc: string | undefined;
  for (const d of docsRes.data ?? []) {
    if (!lastDoc || d.created_at > lastDoc) lastDoc = d.created_at;
  }

  let totalPaid = 0;
  let lastPayment: string | undefined;
  for (const p of paymentsRes.data ?? []) {
    const signed = p.kind === 'refund' ? -Number(p.amount) : Number(p.amount);
    totalPaid += signed;
    if (!lastPayment || p.created_at > lastPayment) lastPayment = p.created_at;
  }

  const candidates = [
    billingCase.updated_at,
    billingCase.last_extracted_at,
    billingCase.last_reconciled_at,
    lastDoc,
    lastPayment,
  ].filter((v): v is string => !!v);
  const lastActivity = candidates.reduce(
    (max, cur) => (cur > max ? cur : max),
    billingCase.created_at,
  );

  return {
    success: true,
    data: {
      ...billingCase,
      document_count: (docsRes.data ?? []).length,
      unresolved_findings_count: findingsRes.count ?? 0,
      total_paid: totalPaid,
      last_activity_at: lastActivity,
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
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

// ── Findings ───────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Fetch unresolved findings for a case, ordered critical → warning → info.
 */
export async function fetchFindings(
  caseId: string,
): Promise<ServiceResult<BillingCaseFinding[]>> {
  const { data, error } = await supabase
    .from('billing_case_findings')
    .select('*')
    .eq('billing_case_id', caseId)
    .eq('is_resolved', false)
    .order('created_at', { ascending: true });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const sorted = ((data ?? []) as BillingCaseFinding[]).sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
  );

  return { success: true, data: sorted };
}

/**
 * Upsert findings for a case and resolve any existing findings that no longer apply.
 *
 * For each incoming finding: insert or update (severity/message/evidence/recommended_actions)
 * keyed by (billing_case_id, code). Findings present in DB but absent from the
 * new list are marked is_resolved=true with resolved_at=now().
 */
export async function upsertFindings(
  caseId: string,
  profileId: string,
  householdId: string,
  findings: ReconciliationFinding[],
): Promise<ServiceResult<BillingCaseFinding[]>> {
  // Fetch existing findings (all, not just unresolved — we may re-activate ones)
  const { data: existing, error: fetchError } = await supabase
    .from('billing_case_findings')
    .select('*')
    .eq('billing_case_id', caseId);

  if (fetchError) {
    return { success: false, error: fetchError.message, code: fetchError.code };
  }

  const existingByCode = new Map<string, BillingCaseFinding>();
  for (const row of (existing ?? []) as BillingCaseFinding[]) {
    existingByCode.set(row.code, row);
  }

  const newCodes = new Set<string>(findings.map((f) => f.code));

  // Resolve findings that no longer apply
  const toResolve: string[] = [];
  for (const row of (existing ?? []) as BillingCaseFinding[]) {
    if (!newCodes.has(row.code) && !row.is_resolved) {
      toResolve.push(row.id);
    }
  }
  if (toResolve.length > 0) {
    await supabase
      .from('billing_case_findings')
      .update({ is_resolved: true, resolved_at: new Date().toISOString() })
      .in('id', toResolve);
  }

  // Upsert each current finding
  for (const finding of findings) {
    const existingRow = existingByCode.get(finding.code);
    if (existingRow) {
      await supabase
        .from('billing_case_findings')
        .update({
          severity: finding.severity,
          message: finding.message,
          evidence: finding.evidence ?? null,
          recommended_actions: finding.recommended_actions ?? null,
          is_resolved: false,
          resolved_at: null,
        })
        .eq('id', existingRow.id);
    } else {
      await supabase.from('billing_case_findings').insert({
        billing_case_id: caseId,
        profile_id: profileId,
        household_id: householdId,
        severity: finding.severity,
        code: finding.code,
        message: finding.message,
        evidence: finding.evidence ?? null,
        recommended_actions: finding.recommended_actions ?? null,
        is_resolved: false,
      });
    }
  }

  // Update last_reconciled_at on the case
  await supabase
    .from('billing_cases')
    .update({ last_reconciled_at: new Date().toISOString() })
    .eq('id', caseId);

  // Return the fresh list of unresolved findings
  return await fetchFindings(caseId);
}

/**
 * Mark all findings for a case as resolved.
 */
export async function resolveAllFindings(
  caseId: string,
): Promise<ServiceResult<void>> {
  const { error } = await supabase
    .from('billing_case_findings')
    .update({ is_resolved: true, resolved_at: new Date().toISOString() })
    .eq('billing_case_id', caseId)
    .eq('is_resolved', false);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: undefined };
}

/**
 * Fetch denial records for a billing case.
 */
export async function fetchDenialRecords(
  caseId: string,
): Promise<ServiceResult<BillingDenialRecord[]>> {
  const { data, error } = await supabase
    .from('billing_denial_records')
    .select('*')
    .eq('billing_case_id', caseId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as BillingDenialRecord[] };
}

/**
 * Fetch payments for a billing case.
 */
export async function fetchCasePayments(
  caseId: string,
): Promise<ServiceResult<BillingCasePayment[]>> {
  const { data, error } = await supabase
    .from('billing_case_payments')
    .select('*')
    .eq('billing_case_id', caseId)
    .order('paid_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as BillingCasePayment[] };
}

/**
 * Create a payment or refund row for a billing case.
 */
export async function createPayment(
  params: CreatePaymentInput,
  userId: string,
): Promise<ServiceResult<BillingCasePayment>> {
  const { data, error } = await supabase
    .from('billing_case_payments')
    .insert({
      billing_case_id: params.caseId,
      profile_id: params.profileId,
      household_id: params.householdId,
      kind: params.kind,
      amount: params.amount,
      paid_at: params.paidAt,
      method: params.method ?? null,
      note: params.note ?? null,
      external_ref: params.externalRef ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to create payment' };
  }

  const payment = data as BillingCasePayment;

  await supabase.from('audit_events').insert({
    profile_id: params.profileId,
    actor_id: userId,
    event_type: 'billing_payment.created',
    metadata: {
      billing_case_id: params.caseId,
      billing_payment_id: payment.id,
      kind: payment.kind,
    },
  });

  return { success: true, data: payment };
}

/**
 * Update an existing payment row.
 */
export async function updatePayment(
  paymentId: string,
  updates: UpdatePaymentInput,
  userId: string,
): Promise<ServiceResult<BillingCasePayment>> {
  const { data, error } = await supabase
    .from('billing_case_payments')
    .update(updates)
    .eq('id', paymentId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update payment' };
  }

  const payment = data as BillingCasePayment;

  await supabase.from('audit_events').insert({
    profile_id: payment.profile_id,
    actor_id: userId,
    event_type: 'billing_payment.updated',
    metadata: {
      billing_case_id: payment.billing_case_id,
      billing_payment_id: payment.id,
      updated_fields: Object.keys(updates),
    },
  });

  return { success: true, data: payment };
}

/**
 * Delete a payment row.
 */
export async function deletePayment(
  paymentId: string,
  userId: string,
): Promise<ServiceResult<{ caseId: string; profileId: string }>> {
  const { data: existing, error: fetchError } = await supabase
    .from('billing_case_payments')
    .select('*')
    .eq('id', paymentId)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: fetchError?.message ?? 'Payment not found' };
  }

  const payment = existing as BillingCasePayment;

  const { error } = await supabase
    .from('billing_case_payments')
    .delete()
    .eq('id', paymentId);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: payment.profile_id,
    actor_id: userId,
    event_type: 'billing_payment.deleted',
    metadata: {
      billing_case_id: payment.billing_case_id,
      billing_payment_id: paymentId,
      kind: payment.kind,
    },
  });

  return {
    success: true,
    data: { caseId: payment.billing_case_id, profileId: payment.profile_id },
  };
}

/**
 * Pure utility: derive payment summary numbers from a list of payments.
 * Null patientResponsibility → estimatedBalance and possibleOverpayment are also null.
 */
export function computePaymentSummary(
  payments: BillingCasePayment[],
  patientResponsibility: number | null,
): PaymentSummary {
  const totalPaid = payments
    .filter((p) => p.kind === 'payment')
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const totalRefunded = payments
    .filter((p) => p.kind === 'refund')
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const netPaid = totalPaid - totalRefunded;

  let estimatedBalance: number | null = null;
  let possibleOverpayment: number | null = null;

  if (patientResponsibility !== null) {
    estimatedBalance = patientResponsibility - netPaid;
    if (netPaid > patientResponsibility + 0.01) {
      possibleOverpayment = netPaid - patientResponsibility;
    }
  }

  return {
    totalPaid,
    totalRefunded,
    netPaid,
    patientResponsibility,
    estimatedBalance,
    possibleOverpayment,
  };
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

// ── Actions ───────────────────────────────────────────────────────────────

const ACTION_STATUS_RANK: Record<BillingActionStatus, number> = {
  proposed: 0,
  active: 1,
  in_progress: 2,
  done: 3,
  dismissed: 4,
};

/**
 * Fetch all actions for a case, ordered proposed → active → in_progress → done → dismissed.
 */
export async function fetchActions(
  caseId: string,
): Promise<ServiceResult<BillingCaseAction[]>> {
  const { data, error } = await supabase
    .from('billing_case_actions')
    .select('*')
    .eq('billing_case_id', caseId)
    .order('created_at', { ascending: true });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const sorted = ((data ?? []) as BillingCaseAction[]).sort(
    (a, b) =>
      (ACTION_STATUS_RANK[a.status] ?? 99) - (ACTION_STATUS_RANK[b.status] ?? 99),
  );

  return { success: true, data: sorted };
}

/**
 * Bulk insert proposed actions.
 */
export async function createActions(
  actions: Array<{
    caseId: string;
    profileId: string;
    householdId: string;
    actionType: BillingActionType;
    title: string;
    description: string;
  }>,
): Promise<ServiceResult<BillingCaseAction[]>> {
  if (actions.length === 0) return { success: true, data: [] };

  const rows = actions.map((a) => ({
    billing_case_id: a.caseId,
    profile_id: a.profileId,
    household_id: a.householdId,
    action_type: a.actionType,
    title: a.title,
    description: a.description,
    status: 'proposed' as BillingActionStatus,
  }));

  const { data, error } = await supabase
    .from('billing_case_actions')
    .insert(rows)
    .select();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as BillingCaseAction[] };
}

/**
 * Update an action's status (and optionally link a task).
 */
export async function updateActionStatus(
  actionId: string,
  status: BillingActionStatus,
  linkedTaskId?: string,
): Promise<ServiceResult<BillingCaseAction>> {
  const updates: Record<string, unknown> = { status };

  if (status === 'active') {
    updates.activated_at = new Date().toISOString();
  }
  if (status === 'done') {
    updates.completed_at = new Date().toISOString();
  }
  if (linkedTaskId) {
    updates.linked_task_id = linkedTaskId;
  }

  const { data, error } = await supabase
    .from('billing_case_actions')
    .update(updates)
    .eq('id', actionId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update action' };
  }

  return { success: true, data: data as BillingCaseAction };
}

/**
 * Dismiss an action (user chose not to pursue it).
 */
export async function dismissAction(
  actionId: string,
): Promise<ServiceResult<BillingCaseAction>> {
  return updateActionStatus(actionId, 'dismissed');
}

const SEVERITY_TO_TIER: Record<string, TaskTier> = {
  critical: 'critical',
  warning: 'important',
  info: 'helpful',
};

const TIER_TO_PRIORITY: Record<TaskTier, TaskPriority> = {
  critical: 'urgent',
  important: 'high',
  helpful: 'medium',
};

/**
 * Map an action to a tier by finding a matching finding whose
 * recommended_actions contains the action_type. Falls back to 'important'.
 */
function deriveTierForAction(
  actionType: BillingActionType,
  findings: BillingCaseFinding[],
): TaskTier {
  const match = findings.find((f) =>
    Array.isArray(f.recommended_actions) &&
    (f.recommended_actions as string[]).includes(actionType),
  );
  if (match) {
    return SEVERITY_TO_TIER[match.severity] ?? 'important';
  }
  return 'important';
}

/**
 * Activate proposed actions — creates a task for each, updates action rows,
 * and transitions the case from 'open' → 'in_progress' on first activation.
 */
export async function activateActions(
  actions: BillingCaseAction[],
  caseId: string,
  profileId: string,
  householdId: string,
  userId: string,
): Promise<ServiceResult<BillingCaseAction[]>> {
  if (actions.length === 0) return { success: true, data: [] };

  // Fetch live findings to derive severity/tier for each action.
  const findingsRes = await fetchFindings(caseId);
  const findings = findingsRes.success ? findingsRes.data : [];

  // Check if this is the first activation on this case.
  const { count: priorActiveCount } = await supabase
    .from('billing_case_actions')
    .select('id', { count: 'exact', head: true })
    .eq('billing_case_id', caseId)
    .in('status', ['active', 'in_progress', 'done']);

  const isFirstActivation = (priorActiveCount ?? 0) === 0;

  const updated: BillingCaseAction[] = [];

  for (const action of actions) {
    const tier = deriveTierForAction(action.action_type, findings);
    const priority = TIER_TO_PRIORITY[tier];

    const taskResult = await createTask(
      {
        profile_id: profileId,
        title: action.title,
        description: action.description ?? undefined,
        priority,
        source_type: 'billing',
        source_ref: caseId,
        trigger_type: 'extraction',
        trigger_source: `billing_case_action:${action.id}`,
        context_json: {
          tier,
          instructions: action.description ? [action.description] : undefined,
        },
      },
      userId,
    );

    if (!taskResult.success) {
      return { success: false, error: taskResult.error };
    }

    const updateResult = await updateActionStatus(
      action.id,
      'active',
      taskResult.data.id,
    );

    if (!updateResult.success) {
      return { success: false, error: updateResult.error };
    }

    updated.push(updateResult.data);
  }

  if (isFirstActivation) {
    // Fetch current status to transition from 'open' → 'in_progress'.
    const { data: caseData } = await supabase
      .from('billing_cases')
      .select('status')
      .eq('id', caseId)
      .single();

    if (caseData?.status === 'open') {
      await supabase
        .from('billing_cases')
        .update({ status: 'in_progress' })
        .eq('id', caseId);

      await supabase.from('billing_case_status_events').insert({
        billing_case_id: caseId,
        profile_id: profileId,
        household_id: householdId,
        from_status: 'open',
        to_status: 'in_progress',
        changed_by: 'system',
        note: 'Action plan activated',
      });
    }
  }

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'billing_case.actions_activated',
    metadata: {
      billing_case_id: caseId,
      action_count: updated.length,
      action_ids: updated.map((a) => a.id),
    },
  });

  return { success: true, data: updated };
}

// ── Call Logs & Parties ───────────────────────────────────────────────────

/**
 * Fetch all call logs for a billing case, ordered by called_at desc.
 */
export async function fetchCallLogs(
  caseId: string,
): Promise<ServiceResult<BillingCaseCallLog[]>> {
  const { data, error } = await supabase
    .from('billing_case_call_logs')
    .select('*')
    .eq('billing_case_id', caseId)
    .order('called_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as BillingCaseCallLog[] };
}

/**
 * Fetch the billing_case_parties row for a case (one per case, or null).
 */
export async function fetchCaseParties(
  caseId: string,
): Promise<ServiceResult<BillingCaseParty | null>> {
  const { data, error } = await supabase
    .from('billing_case_parties')
    .select('*')
    .eq('billing_case_id', caseId)
    .maybeSingle();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data as BillingCaseParty | null) ?? null };
}

/**
 * Insert a new call log row. Returns the created record.
 */
export async function createCallLog(params: {
  caseId: string;
  actionId?: string;
  profileId: string;
  householdId: string;
  party: CallParty;
  partyName?: string;
  phoneNumber?: string;
  calledAt?: string;
  durationMinutes?: number;
  repName?: string;
  referenceNumber?: string;
  outcome?: string;
  nextSteps?: string;
  followUpDue?: string;
}): Promise<ServiceResult<BillingCaseCallLog>> {
  const { data, error } = await supabase
    .from('billing_case_call_logs')
    .insert({
      billing_case_id: params.caseId,
      billing_action_id: params.actionId ?? null,
      profile_id: params.profileId,
      household_id: params.householdId,
      party: params.party,
      party_name: params.partyName ?? null,
      phone_number: params.phoneNumber ?? null,
      called_at: params.calledAt ?? new Date().toISOString(),
      duration_minutes: params.durationMinutes ?? null,
      rep_name: params.repName ?? null,
      reference_number: params.referenceNumber ?? null,
      outcome: params.outcome ?? null,
      next_steps: params.nextSteps ?? null,
      follow_up_due: params.followUpDue ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to create call log' };
  }

  return { success: true, data: data as BillingCaseCallLog };
}

/**
 * Create a follow-up task from a call log and link it back via created_task_id.
 */
export async function createCallFollowUpTask(params: {
  callLogId: string;
  caseId: string;
  profileId: string;
  householdId: string;
  userId: string;
  title: string;
  description?: string;
  dueDate?: string;
}): Promise<ServiceResult<{ taskId: string }>> {
  const taskResult = await createTask(
    {
      profile_id: params.profileId,
      title: params.title,
      description: params.description,
      due_date: params.dueDate,
      priority: 'high',
      source_type: 'billing',
      source_ref: params.caseId,
      trigger_type: 'manual',
      trigger_source: `billing_case_call_log:${params.callLogId}`,
      context_json: {
        instructions: params.description ? [params.description] : undefined,
      },
    },
    params.userId,
  );

  if (!taskResult.success) {
    return { success: false, error: taskResult.error };
  }

  const { error: linkError } = await supabase
    .from('billing_case_call_logs')
    .update({ created_task_id: taskResult.data.id })
    .eq('id', params.callLogId);

  if (linkError) {
    return { success: false, error: linkError.message, code: linkError.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: params.profileId,
    actor_id: params.userId,
    event_type: 'billing_case.call_follow_up_created',
    metadata: {
      billing_case_id: params.caseId,
      call_log_id: params.callLogId,
      task_id: taskResult.data.id,
    },
  });

  return { success: true, data: { taskId: taskResult.data.id } };
}

// ── Denials ───────────────────────────────────────────────────────────────

/**
 * Create a new denial record (manual entry or from extraction).
 */
export async function createDenialRecord(
  params: {
    caseId: string;
    profileId: string;
    householdId: string;
    documentId?: string | null;
    category?: DenialCategory | null;
    denialReason?: string | null;
    deadline?: string | null;
    confidence?: number | null;
    evidence?: Record<string, unknown> | null;
  },
  userId: string,
): Promise<ServiceResult<BillingDenialRecord>> {
  const { data, error } = await supabase
    .from('billing_denial_records')
    .insert({
      billing_case_id: params.caseId,
      profile_id: params.profileId,
      household_id: params.householdId,
      billing_document_id: params.documentId ?? null,
      category: params.category ?? null,
      denial_reason: params.denialReason ?? null,
      deadline: params.deadline ?? null,
      confidence: params.confidence ?? null,
      evidence: params.evidence ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to create denial record' };
  }

  const denial = data as BillingDenialRecord;

  await supabase.from('audit_events').insert({
    profile_id: params.profileId,
    actor_id: userId,
    event_type: 'billing_denial.created',
    metadata: {
      billing_case_id: params.caseId,
      billing_denial_id: denial.id,
      category: denial.category,
    },
  });

  return { success: true, data: denial };
}

/**
 * Update a denial record (partial update).
 */
export async function updateDenialRecord(
  denialId: string,
  updates: Partial<
    Pick<BillingDenialRecord, 'category' | 'denial_reason' | 'deadline' | 'confidence' | 'evidence'>
  >,
  userId: string,
): Promise<ServiceResult<BillingDenialRecord>> {
  const { data, error } = await supabase
    .from('billing_denial_records')
    .update(updates)
    .eq('id', denialId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update denial record' };
  }

  const denial = data as BillingDenialRecord;

  await supabase.from('audit_events').insert({
    profile_id: denial.profile_id,
    actor_id: userId,
    event_type: 'billing_denial.updated',
    metadata: {
      billing_case_id: denial.billing_case_id,
      billing_denial_id: denial.id,
      updated_fields: Object.keys(updates),
    },
  });

  return { success: true, data: denial };
}

// ── Appeal Packets ────────────────────────────────────────────────────────

/**
 * Fetch all appeal packets for a billing case.
 */
export async function fetchAppealPackets(
  caseId: string,
): Promise<ServiceResult<BillingAppealPacket[]>> {
  const { data, error } = await supabase
    .from('billing_appeal_packets')
    .select('*')
    .eq('billing_case_id', caseId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as BillingAppealPacket[] };
}

/**
 * Create a new appeal packet (default: draft status, default checklist, empty letter).
 */
export async function createAppealPacket(
  params: {
    caseId: string;
    profileId: string;
    householdId: string;
    denialId?: string | null;
  },
  userId: string,
): Promise<ServiceResult<BillingAppealPacket>> {
  const { data, error } = await supabase
    .from('billing_appeal_packets')
    .insert({
      billing_case_id: params.caseId,
      profile_id: params.profileId,
      household_id: params.householdId,
      billing_denial_id: params.denialId ?? null,
      status: 'draft' as AppealPacketStatus,
      checklist: DEFAULT_APPEAL_CHECKLIST,
      included_doc_ids: [],
      letter_draft: null,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to create appeal packet' };
  }

  const packet = data as BillingAppealPacket;

  await supabase.from('audit_events').insert({
    profile_id: params.profileId,
    actor_id: userId,
    event_type: 'billing_appeal_packet.created',
    metadata: {
      billing_case_id: params.caseId,
      billing_appeal_packet_id: packet.id,
      billing_denial_id: packet.billing_denial_id,
    },
  });

  return { success: true, data: packet };
}

/**
 * Update an appeal packet. Handles automatic submitted_at when transitioning to 'submitted'.
 */
export async function updateAppealPacket(
  packetId: string,
  updates: {
    status?: AppealPacketStatus;
    letterDraft?: string | null;
    checklist?: AppealChecklist;
    includedDocIds?: string[];
    submittedAt?: string | null;
    outcome?: string | null;
  },
  userId: string,
): Promise<ServiceResult<BillingAppealPacket>> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.letterDraft !== undefined) dbUpdates.letter_draft = updates.letterDraft;
  if (updates.checklist !== undefined) dbUpdates.checklist = updates.checklist;
  if (updates.includedDocIds !== undefined) dbUpdates.included_doc_ids = updates.includedDocIds;
  if (updates.submittedAt !== undefined) dbUpdates.submitted_at = updates.submittedAt;
  if (updates.outcome !== undefined) dbUpdates.outcome = updates.outcome;

  if (updates.status === 'submitted' && updates.submittedAt === undefined) {
    dbUpdates.submitted_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('billing_appeal_packets')
    .update(dbUpdates)
    .eq('id', packetId)
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Failed to update appeal packet' };
  }

  const packet = data as BillingAppealPacket;

  await supabase.from('audit_events').insert({
    profile_id: packet.profile_id,
    actor_id: userId,
    event_type: 'billing_appeal_packet.updated',
    metadata: {
      billing_case_id: packet.billing_case_id,
      billing_appeal_packet_id: packet.id,
      updated_fields: Object.keys(dbUpdates),
    },
  });

  return { success: true, data: packet };
}

/**
 * Delete an appeal packet.
 */
export async function deleteAppealPacket(
  packetId: string,
  userId: string,
): Promise<ServiceResult<{ caseId: string; profileId: string }>> {
  const { data: existing, error: fetchError } = await supabase
    .from('billing_appeal_packets')
    .select('*')
    .eq('id', packetId)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: fetchError?.message ?? 'Appeal packet not found' };
  }

  const packet = existing as BillingAppealPacket;

  const { error } = await supabase
    .from('billing_appeal_packets')
    .delete()
    .eq('id', packetId);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: packet.profile_id,
    actor_id: userId,
    event_type: 'billing_appeal_packet.deleted',
    metadata: {
      billing_case_id: packet.billing_case_id,
      billing_appeal_packet_id: packetId,
    },
  });

  return {
    success: true,
    data: { caseId: packet.billing_case_id, profileId: packet.profile_id },
  };
}

/**
 * Generate an appeal letter draft via the generate-appeal-letter Edge Function.
 * Returns the generated letter text — the caller is responsible for saving it
 * via updateAppealPacket.
 */
export async function generateAppealLetter(params: {
  caseId: string;
  profileId: string;
  denialRecord: BillingDenialRecord;
  billingCase: BillingCase;
  caseParties: BillingCaseParty | null;
}): Promise<ServiceResult<{ letter: string }>> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase.functions.invoke('generate-appeal-letter', {
    body: {
      caseId: params.caseId,
      profileId: params.profileId,
      denialRecord: params.denialRecord,
      billingCase: params.billingCase,
      caseParties: params.caseParties,
    },
  });

  if (error) {
    return { success: false, error: error.message ?? 'Letter generation failed' };
  }

  const letter = typeof data?.letter === 'string' ? data.letter : null;
  if (!letter) {
    return { success: false, error: 'No letter returned' };
  }

  return { success: true, data: { letter } };
}
