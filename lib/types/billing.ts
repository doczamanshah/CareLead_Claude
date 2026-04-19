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
  unresolved_findings_count: number;
  total_paid: number;
  last_activity_at: string;
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
  open: 'New',
  in_review: 'Reviewing',
  action_plan: 'Has next steps',
  in_progress: 'In Progress',
  resolved: 'Done',
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

export const DENIAL_CATEGORY_LABELS: Record<DenialCategory, string> = {
  prior_auth: 'Prior Authorization',
  medical_necessity: 'Medical Necessity',
  not_covered: 'Not Covered',
  timely_filing: 'Timely Filing',
  coding_error: 'Coding Error',
  duplicate: 'Duplicate Claim',
  other: 'Other',
};

// ── Appeals ───────────────────────────────────────────────────────────────

export type AppealPacketStatus =
  | 'draft'
  | 'ready'
  | 'submitted'
  | 'accepted'
  | 'rejected';

export interface AppealChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export type AppealChecklist = AppealChecklistItem[];

export interface BillingAppealPacket {
  id: string;
  billing_case_id: string;
  billing_denial_id: string | null;
  profile_id: string;
  household_id: string;
  status: AppealPacketStatus;
  letter_draft: string | null;
  checklist: AppealChecklist | null;
  included_doc_ids: string[] | null;
  submitted_at: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

export const APPEAL_STATUS_LABELS: Record<AppealPacketStatus, string> = {
  draft: 'Draft',
  ready: 'Ready',
  submitted: 'Submitted',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export const DEFAULT_APPEAL_CHECKLIST: AppealChecklist = [
  { id: '1', label: 'Review denial letter and note the specific reason', done: false },
  { id: '2', label: 'Gather supporting medical records', done: false },
  { id: '3', label: 'Get a letter of medical necessity from your doctor (if applicable)', done: false },
  { id: '4', label: 'Collect all relevant bills and EOBs', done: false },
  { id: '5', label: 'Draft or review appeal letter', done: false },
  { id: '6', label: 'Make copies of all documents', done: false },
  { id: '7', label: 'Note the appeal deadline', done: false },
  { id: '8', label: 'Send via certified mail or upload to portal', done: false },
  { id: '9', label: 'Save tracking/confirmation number', done: false },
];

// ── Findings ──────────────────────────────────────────────────────────────

export type FindingSeverity = 'info' | 'warning' | 'critical';

export type FindingCode =
  | 'missing_bill'
  | 'missing_eob'
  | 'low_doc_quality'
  | 'low_confidence'
  | 'total_mismatch'
  | 'denial_detected'
  | 'possible_overpayment'
  | 'missing_provider'
  | 'missing_payer'
  | 'no_service_dates';

export type RecommendedActionType =
  | 'upload_eob'
  | 'request_itemized_bill'
  | 'call_provider_billing'
  | 'call_insurer'
  | 'request_refund'
  | 'appeal_denial'
  | 'other';

export interface BillingCaseFinding {
  id: string;
  billing_case_id: string;
  profile_id: string;
  household_id: string;
  severity: FindingSeverity;
  code: FindingCode | string;
  message: string;
  evidence: Record<string, unknown> | null;
  recommended_actions: RecommendedActionType[] | null;
  is_resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

// Input shape used by the reconciliation engine before persistence.
// These are the fields a check produces; persistence adds id/timestamps.
export interface ReconciliationFinding {
  code: FindingCode;
  severity: FindingSeverity;
  message: string;
  evidence?: Record<string, unknown>;
  recommended_actions?: RecommendedActionType[];
}

// ── Actions ───────────────────────────────────────────────────────────────

export type BillingActionStatus =
  | 'proposed'
  | 'active'
  | 'in_progress'
  | 'done'
  | 'dismissed';

export type BillingActionType =
  | 'upload_eob'
  | 'request_itemized_bill'
  | 'call_provider_billing'
  | 'call_insurer'
  | 'request_refund'
  | 'appeal_denial'
  | 'other';

export interface BillingCaseAction {
  id: string;
  billing_case_id: string;
  profile_id: string;
  household_id: string;
  action_type: BillingActionType;
  status: BillingActionStatus;
  title: string;
  description: string | null;
  due_at: string | null;
  linked_task_id: string | null;
  activated_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Output of the action plan generator — not yet persisted. */
export interface ProposedAction {
  action_type: BillingActionType;
  title: string;
  description: string;
  source_finding_code: FindingCode | string;
  source_finding_severity: FindingSeverity;
}

// ── Call Logs & Parties ───────────────────────────────────────────────────

export type CallParty = 'provider' | 'payer' | 'pharmacy' | 'other';

export interface BillingCaseCallLog {
  id: string;
  billing_case_id: string;
  billing_action_id: string | null;
  profile_id: string;
  household_id: string;
  party: CallParty;
  party_name: string | null;
  phone_number: string | null;
  called_at: string;
  duration_minutes: number | null;
  rep_name: string | null;
  reference_number: string | null;
  outcome: string | null;
  next_steps: string | null;
  follow_up_due: string | null;
  created_task_id: string | null;
  created_at: string;
}

export interface BillingCaseParty {
  id: string;
  billing_case_id: string;
  profile_id: string;
  household_id: string;
  provider_contact_id: string | null;
  payer_contact_id: string | null;
  claim_number: string | null;
  member_id: string | null;
  plan_name: string | null;
  group_number: string | null;
  provider_npi: string | null;
  provider_tin: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallScriptReference {
  label: string;
  value: string;
}

export interface CallScriptQuestion {
  question: string;
  why: string;
}

export interface CallScript {
  title: string;
  party: CallParty;
  phoneNumber: string | null;
  referenceNumbers: CallScriptReference[];
  introduction: string;
  questions: CallScriptQuestion[];
  tips: string[];
}

// ── Payments ──────────────────────────────────────────────────────────────

export type BillingPaymentKind = 'payment' | 'refund';

export type BillingPaymentMethod = 'card' | 'check' | 'cash' | 'portal' | 'other';

export const BILLING_PAYMENT_METHOD_LABELS: Record<BillingPaymentMethod, string> = {
  card: 'Card',
  check: 'Check',
  cash: 'Cash',
  portal: 'Online Portal',
  other: 'Other',
};

export interface BillingCasePayment {
  id: string;
  billing_case_id: string;
  profile_id: string;
  household_id: string;
  kind: BillingPaymentKind;
  amount: number;
  paid_at: string;
  method: string | null;
  note: string | null;
  external_ref: string | null;
  created_at: string;
}

export interface CreatePaymentInput {
  caseId: string;
  profileId: string;
  householdId: string;
  kind: BillingPaymentKind;
  amount: number;
  paidAt: string;
  method?: BillingPaymentMethod | null;
  note?: string | null;
  externalRef?: string | null;
}

export interface UpdatePaymentInput {
  kind?: BillingPaymentKind;
  amount?: number;
  paid_at?: string;
  method?: string | null;
  note?: string | null;
  external_ref?: string | null;
}

export interface PaymentSummary {
  totalPaid: number;
  totalRefunded: number;
  netPaid: number;
  patientResponsibility: number | null;
  estimatedBalance: number | null;
  possibleOverpayment: number | null;
}
