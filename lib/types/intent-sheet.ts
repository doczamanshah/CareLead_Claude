// ── Intent Sheet Types ──────────────────────────────────────────────────────

export type IntentSheetSourceType = 'extraction' | 'manual' | 'voice' | 'reconciliation';

export type IntentSheetStatus =
  | 'draft'
  | 'pending_review'
  | 'partially_committed'
  | 'committed'
  | 'dismissed';

export type IntentItemType =
  | 'profile_fact'
  | 'task'
  | 'reminder'
  | 'medication'
  | 'appointment';

export type IntentItemStatus = 'pending' | 'accepted' | 'edited' | 'rejected';

export interface IntentSheet {
  id: string;
  profile_id: string;
  artifact_id: string | null;
  source_type: IntentSheetSourceType;
  status: IntentSheetStatus;
  created_at: string;
  updated_at: string;
}

export interface IntentItem {
  id: string;
  intent_sheet_id: string;
  profile_id: string;
  item_type: IntentItemType;
  field_key: string | null;
  proposed_value: Record<string, unknown>;
  current_value: Record<string, unknown> | null;
  confidence: number | null;
  evidence_json: Record<string, unknown> | null;
  status: IntentItemStatus;
  edited_value: Record<string, unknown> | null;
  committed_at: string | null;
  created_at: string;
}

export interface IntentSheetWithItems extends IntentSheet {
  items: IntentItem[];
}

// ── Extracted Field Types ───────────────────────────────────────────────────

export type ExtractedFieldStatus = 'unreviewed' | 'accepted' | 'rejected' | 'superseded';

export interface ExtractedField {
  id: string;
  artifact_id: string;
  profile_id: string;
  field_key: string;
  value_json: Record<string, unknown>;
  confidence: number;
  evidence_json: Record<string, unknown> | null;
  status: ExtractedFieldStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

// ── Extraction API Types ────────────────────────────────────────────────────

/** Shape returned by Claude API extraction prompt */
export interface ExtractionResult {
  document_type: string;
  confidence: number;
  fields: ExtractionField[];
}

export interface ExtractionField {
  field_key: string;
  value: string | number | boolean | Record<string, unknown>;
  confidence: number;
  evidence?: string;
}

/** Payload sent to the extract-document Edge Function */
export interface TriggerExtractionParams {
  artifactId: string;
  profileId: string;
}

/** Response from the extract-document Edge Function */
export interface ExtractionResponse {
  intentSheetId: string;
  documentType: string;
  fieldCount: number;
}
