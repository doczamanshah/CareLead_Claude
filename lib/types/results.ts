// ── Results (Labs/Imaging) Types ────────────────────────────────────────────

export type ResultType = 'lab' | 'imaging' | 'other';

export type ResultStatus =
  | 'draft'
  | 'processing'
  | 'needs_review'
  | 'ready'
  | 'archived';

export type ResultSourceMethod = 'typed' | 'dictated' | 'document' | 'import';

export type DocumentSource = 'upload' | 'photo' | 'scan';

export type LabFlag = 'normal' | 'high' | 'low' | 'abnormal' | 'critical';

export type ResultExtractJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export type ObservationSource = 'extracted' | 'user_confirmed' | 'user_entered';

export interface ResultItem {
  id: string;
  profile_id: string;
  household_id: string;
  result_type: ResultType;
  test_name: string;
  performed_at: string | null;
  reported_at: string | null;
  facility: string | null;
  ordering_clinician: string | null;
  source_method: ResultSourceMethod;
  raw_text: string | null;
  structured_data: Record<string, unknown> | null;
  field_confidence: Record<string, unknown> | null;
  user_corrections: Record<string, unknown> | null;
  status: ResultStatus;
  tags: string[];
  is_pinned: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResultItemWithDocCount extends ResultItem {
  document_count: number;
}

export interface ResultDocument {
  id: string;
  result_id: string;
  profile_id: string;
  household_id: string;
  file_path: string;
  file_name: string | null;
  mime_type: string | null;
  source: DocumentSource;
  extracted_text: string | null;
  created_at: string;
}

export interface ResultLabObservation {
  id: string;
  result_id: string;
  profile_id: string;
  household_id: string;
  analyte_name: string;
  analyte_code: string | null;
  numeric_value: number | null;
  value_text: string | null;
  unit: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  ref_range_text: string | null;
  flag: LabFlag | null;
  observed_at: string | null;
  confidence: number | null;
  source: ObservationSource;
  created_at: string;
}

export interface ResultExtractJob {
  id: string;
  result_id: string;
  profile_id: string;
  household_id: string;
  status: ResultExtractJobStatus;
  started_at: string | null;
  completed_at: string | null;
  result_json: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
}

export interface CreateResultInput {
  profileId: string;
  householdId: string;
  resultType: ResultType;
  testName: string;
  performedAt?: string | null;
  reportedAt?: string | null;
  facility?: string | null;
  orderingClinician?: string | null;
  sourceMethod: ResultSourceMethod;
  rawText?: string | null;
  notes?: string | null;
}

export interface UpdateResultInput {
  result_type?: ResultType;
  test_name?: string;
  performed_at?: string | null;
  reported_at?: string | null;
  facility?: string | null;
  ordering_clinician?: string | null;
  raw_text?: string | null;
  structured_data?: Record<string, unknown> | null;
  user_corrections?: Record<string, unknown> | null;
  status?: ResultStatus;
  tags?: string[];
  is_pinned?: boolean;
  notes?: string | null;
}

export const RESULT_TYPE_LABELS: Record<ResultType, string> = {
  lab: 'Lab',
  imaging: 'Imaging',
  other: 'Other Test',
};

export const RESULT_STATUS_LABELS: Record<ResultStatus, string> = {
  draft: 'Draft',
  processing: 'Processing',
  needs_review: 'Needs Review',
  ready: 'Ready',
  archived: 'Archived',
};

export const RESULT_SOURCE_METHOD_LABELS: Record<ResultSourceMethod, string> = {
  typed: 'Typed',
  dictated: 'Dictated',
  document: 'Document',
  import: 'Imported',
};
