// ── Preventive Care Types ─────────────────────────────────────────────────

import { COLORS } from '@/lib/constants/colors';

export type PreventiveStatus =
  | 'due'
  | 'due_soon'
  | 'scheduled'
  | 'completed'
  | 'up_to_date'
  | 'needs_review'
  | 'deferred'
  | 'declined';

export type PreventiveCategory =
  | 'cancer_screening'
  | 'immunization'
  | 'cardiovascular'
  | 'metabolic'
  | 'bone_health'
  | 'other';

export type PreventiveEventType =
  | 'created'
  | 'recomputed'
  | 'status_changed'
  | 'intent_proposed'
  | 'intent_confirmed'
  | 'intent_committed'
  | 'data_updated'
  | 'deferred'
  | 'declined'
  | 'completed'
  | 'reopened';

export type PreventiveLastDoneSource =
  | 'user_reported'
  | 'document_backed'
  | 'extracted'
  | 'imported';

export type PreventiveIntentSheetStatus =
  | 'draft'
  | 'review_ready'
  | 'confirmed'
  | 'committed'
  | 'dismissed';

export interface EligibilityCriteria {
  min_age: number | null;
  max_age: number | null;
  sex: 'any' | 'male' | 'female';
  conditions?: string[];
}

export interface PreventiveMissingDataEntry {
  field: string;
  prompt: string;
}

export interface PreventiveRule {
  id: string;
  code: string;
  title: string;
  description: string;
  category: PreventiveCategory;
  eligibility_criteria: EligibilityCriteria;
  cadence_months: number | null;
  guideline_source: string;
  guideline_version: string | null;
  guideline_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PreventiveItem {
  id: string;
  profile_id: string;
  household_id: string;
  rule_id: string;
  status: PreventiveStatus;
  due_date: string | null;
  due_window_start: string | null;
  due_window_end: string | null;
  last_done_date: string | null;
  last_done_source: PreventiveLastDoneSource | null;
  last_done_evidence_id: string | null;
  last_done_evidence_path: string | null;
  next_due_date: string | null;
  rationale: string | null;
  missing_data: PreventiveMissingDataEntry[];
  deferred_until: string | null;
  declined_reason: string | null;
  linked_task_id: string | null;
  linked_appointment_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PreventiveItemWithRule extends PreventiveItem {
  rule: Pick<
    PreventiveRule,
    'code' | 'title' | 'description' | 'category' | 'cadence_months' | 'guideline_source' | 'guideline_version' | 'guideline_url'
  >;
}

export interface PreventiveItemEvent {
  id: string;
  preventive_item_id: string;
  profile_id: string;
  household_id: string;
  event_type: PreventiveEventType;
  from_status: PreventiveStatus | null;
  to_status: PreventiveStatus | null;
  detail: Record<string, unknown> | null;
  created_by: 'system' | 'user' | 'extraction';
  created_at: string;
}

export type PreventiveTaskTier = 'critical' | 'important' | 'helpful';

export interface PreventiveProposedTask {
  title: string;
  description: string;
  tier: PreventiveTaskTier;
  dueInDays: number | null;
}

export interface PreventiveProposedReminder {
  title: string;
  remindInDays: number;
}

export interface PreventiveIntentSheetItem {
  preventiveItemId: string;
  ruleCode: string;
  title: string;
  currentStatus: PreventiveStatus;
  proposedStatus: 'scheduled';
  proposedTasks: PreventiveProposedTask[];
  proposedReminders: PreventiveProposedReminder[];
}

export interface PreventiveIntentSheetContent {
  items: PreventiveIntentSheetItem[];
}

export interface PreventiveIntentSheet {
  id: string;
  profile_id: string;
  household_id: string;
  status: PreventiveIntentSheetStatus;
  items_json: PreventiveIntentSheetItem[];
  user_edits_json: Record<string, unknown> | null;
  confirmed_at: string | null;
  committed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const PREVENTIVE_STATUS_LABELS: Record<PreventiveStatus, string> = {
  due: 'Due Now',
  due_soon: 'Coming Up',
  scheduled: 'Scheduled',
  completed: 'Completed',
  up_to_date: 'Up to Date',
  needs_review: 'Needs Review',
  deferred: 'Deferred',
  declined: 'Declined',
};

export const PREVENTIVE_CATEGORY_LABELS: Record<PreventiveCategory, string> = {
  cancer_screening: 'Cancer Screening',
  immunization: 'Immunization',
  cardiovascular: 'Cardiovascular',
  metabolic: 'Metabolic',
  bone_health: 'Bone Health',
  other: 'Other',
};

export const PREVENTIVE_STATUS_COLORS: Record<PreventiveStatus, string> = {
  due: COLORS.error.DEFAULT,
  due_soon: COLORS.warning.DEFAULT,
  scheduled: COLORS.primary.DEFAULT,
  completed: COLORS.success.DEFAULT,
  up_to_date: COLORS.success.DEFAULT,
  needs_review: COLORS.accent.DEFAULT,
  deferred: COLORS.text.tertiary,
  declined: COLORS.text.tertiary,
};
