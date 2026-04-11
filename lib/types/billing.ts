// ── Billing Types ──────────────────────────────────────────────────────────

export type BillingCaseStatus =
  | 'open'
  | 'in_review'
  | 'action_plan'
  | 'in_progress'
  | 'resolved'
  | 'closed';

export type BillingDocType =
  | 'bill'
  | 'eob'
  | 'itemized_bill'
  | 'denial'
  | 'other';

export type BillingDocSource = 'upload' | 'fhir';

export type ExtractJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface BillingCase {
  id: string;
  profile_id: string;
  household_id: string;
  title: string;
  status: BillingCaseStatus;
  provider_name: string | null;
  payer_name: string | null;
  service_date_start: string | null;
  service_date_end: string | null;
  total_billed: number | null;
  total_allowed: number | null;
  total_plan_paid: number | null;
  total_patient_responsibility: number | null;
  totals_confidence: number | null;
  last_extracted_at: string | null;
  last_reconciled_at: string | null;
  external_ref: string | null;
  notes: string | null;
  freeform_input: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillingCaseWithDocCount extends BillingCase {
  document_count: number;
}

export interface BillingDocument {
  id: string;
  billing_case_id: string;
  profile_id: string;
  household_id: string;
  doc_type: BillingDocType;
  file_path: string;
  file_name: string | null;
  mime_type: string | null;
  source: BillingDocSource;
  extracted_json: Record<string, unknown> | null;
  quality_score: number | null;
  quality_signals: Record<string, unknown> | null;
  created_at: string;
}

export interface BillingCaseStatusEvent {
  id: string;
  billing_case_id: string;
  profile_id: string;
  household_id: string;
  from_status: string | null;
  to_status: string;
  changed_by: 'user' | 'system';
  note: string | null;
  created_at: string;
}

export interface CreateBillingCaseInput {
  profileId: string;
  householdId: string;
  title: string;
  providerName?: string;
  payerName?: string;
  serviceDateStart?: string;
  serviceDateEnd?: string;
  notes?: string;
  freeformInput?: string;
}

export interface UpdateBillingCaseInput {
  title?: string;
  status?: BillingCaseStatus;
  provider_name?: string | null;
  payer_name?: string | null;
  service_date_start?: string | null;
  service_date_end?: string | null;
  notes?: string | null;
  freeform_input?: string | null;
}

export const BILLING_STATUS_LABELS: Record<BillingCaseStatus, string> = {
  open: 'Open',
  in_review: 'In Review',
  action_plan: 'Action Plan',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export interface BillingExtractJob {
  id: string;
  billing_case_id: string;
  billing_document_id: string | null;
  profile_id: string;
  household_id: string;
  status: ExtractJobStatus;
  started_at: string | null;
  completed_at: string | null;
  result_json: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
}

export type LedgerLineKind = 'total' | 'bill_line' | 'eob_line';

export interface BillingLedgerLine {
  id: string;
  billing_case_id: string;
  billing_document_id: string | null;
  profile_id: string;
  household_id: string;
  line_kind: LedgerLineKind;
  description: string | null;
  service_date: string | null;
  procedure_code: string | null;
  amount_billed: number | null;
  amount_allowed: number | null;
  amount_plan_paid: number | null;
  amount_patient: number | null;
  confidence: number | null;
  evidence_snippet: string | null;
  evidence_context: string | null;
  evidence_page_hint: string | null;
  external_line_key: string | null;
  matched_line_id: string | null;
  created_at: string;
}

export type DenialCategory =
  | 'prior_auth'
  | 'medical_necessity'
  | 'not_covered'
  | 'timely_filing'
  | 'coding_error'
  | 'duplicate'
  | 'other';

export interface BillingDenialRecord {
  id: string;
  billing_case_id: string;
  billing_document_id: string | null;
  profile_id: string;
  household_id: string;
  category: DenialCategory | null;
  denial_reason: string | null;
  keywords: Record<string, unknown> | null;
  codes: Record<string, unknown> | null;
  deadline: string | null;
  confidence: number | null;
  evidence: Record<string, unknown> | null;
  created_at: string;
}

export const BILLING_DOC_TYPE_LABELS: Record<BillingDocType, string> = {
  bill: 'Bill',
  eob: 'EOB',
  itemized_bill: 'Itemized Bill',
  denial: 'Denial Letter',
  other: 'Other',
};
