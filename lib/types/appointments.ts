// ── Appointment Types ──────────────────────────────────────────────────────

export type AppointmentType =
  | 'doctor'
  | 'labs'
  | 'imaging'
  | 'procedure'
  | 'therapy'
  | 'other';

export type AppointmentStatus =
  | 'draft'
  | 'scheduled'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled'
  | 'rescheduled';

export type AppointmentPlanStatus = 'none' | 'draft' | 'committed' | 'needs_review';

export type PlanItemType = 'task' | 'logistics' | 'prep' | 'question';
export type PlanItemPriority = 'low' | 'medium' | 'high';
export type PlanItemStatus = 'proposed' | 'accepted' | 'rejected' | 'completed';
export type PlanItemSource = 'template' | 'ai_generated' | 'manual';

export type CloseoutStatus = 'draft' | 'needs_review' | 'finalized';

export type OutcomeType =
  | 'followup_action'
  | 'medication_change'
  | 'diagnosis_change'
  | 'allergy_change'
  | 'order'
  | 'instruction';

export type OutcomeStatus = 'proposed' | 'accepted' | 'edited' | 'rejected';

export interface Appointment {
  id: string;
  profile_id: string;
  title: string;
  appointment_type: AppointmentType;
  provider_name: string | null;
  facility_name: string | null;
  location_text: string | null;
  purpose: string | null;
  notes: string | null;
  start_time: string;
  end_time: string | null;
  timezone: string;
  status: AppointmentStatus;
  plan_status: AppointmentPlanStatus;
  linked_appointment_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  prep_json: VisitPrep | null;
  /**
   * True when the structured post-visit capture flow has been completed
   * (or the legacy closeout wizard finalized). Briefings surface past
   * uncaptured appointments as high-priority "How did it go?" prompts.
   */
  post_visit_captured: boolean;
  /**
   * Extra context captured when the patient created the appointment via the
   * freeform/dictation entry flow. Read by visit-prep generation so the
   * initial question list reflects what the patient actually cares about.
   */
  context_json: AppointmentContext | null;
}

/**
 * Optional freeform context stored alongside the structured appointment
 * fields. Populated by the dictation-first creation flow; null for
 * manually-entered appointments.
 */
export interface AppointmentContext {
  reason_for_visit?: string;
  concerns_to_discuss?: string[];
  companion?: string;
  transportation?: string;
  special_needs?: string[];
  prep_notes?: string;
  /** The raw freeform text the patient originally dictated/typed. */
  freeform_input?: string;
}

/**
 * Result shape returned by the extract-appointment Edge Function. Used to
 * pre-fill the review screen and to construct the final appointment +
 * context_json record when the patient confirms.
 */
export interface ExtractedAppointment {
  title: string | null;
  appointment_type:
    | 'doctor_visit'
    | 'labs'
    | 'imaging'
    | 'procedure'
    | 'therapy'
    | 'other'
    | null;
  provider_name: string | null;
  facility_name: string | null;
  location_address: string | null;
  date: string | null;
  time: string | null;
  date_description: string | null;
  reason_for_visit: string | null;
  concerns_to_discuss: string[];
  companion: string | null;
  transportation: string | null;
  special_needs: string[];
  prep_notes: string | null;
  additional_context: string | null;
  confidence: number;
}

// ── Visit Prep ─────────────────────────────────────────────────────────────

export type VisitPrepQuestionSource =
  | 'ai_suggested'
  | 'user_added'
  | 'profile'
  | 'patient';

export interface VisitPrepQuestion {
  id: string;
  text: string;
  source: VisitPrepQuestionSource;
  priority: number;
  /** True if this came from the AI based on profile context (not patient input). */
  ai_suggested?: boolean;
  /** When the user dismisses an AI suggestion, hide it without removing. */
  dismissed?: boolean;
}

export interface VisitPrepRefill {
  medication: string;
  reason: string;
}

export interface VisitPrepConcern {
  text: string;
  source: VisitPrepQuestionSource;
}

export interface VisitPrepDriver {
  name: string;
  user_id: string | null;
  notified: boolean;
}

export interface VisitPrepLogistics {
  depart_by: string | null;
  driver: VisitPrepDriver | null;
  what_to_bring: string[];
}

/**
 * Lifecycle of a Visit Prep object:
 *   - 'not_started' is conceptual only — represented as `prep_json === null`.
 *   - 'draft'       — prep exists, patient is still iterating.
 *   - 'ready'       — patient has marked it ready to share/export.
 *
 * Editing a 'ready' prep automatically reverts it to 'draft' until the
 * patient explicitly marks it ready again.
 */
export type VisitPrepStatus = 'not_started' | 'draft' | 'ready';

export type CaregiverSuggestionStatus = 'pending' | 'accepted' | 'dismissed';

export interface CaregiverSuggestion {
  id: string;
  from_user_id: string;
  from_name: string;
  text: string;
  status: CaregiverSuggestionStatus;
  created_at: string;
}

export interface VisitPrep {
  purpose_summary: string;
  questions: VisitPrepQuestion[];
  refills_needed: VisitPrepRefill[];
  concerns: VisitPrepConcern[];
  logistics: VisitPrepLogistics;
  packet_generated: boolean;
  packet_content?: string;
  /** Lifecycle status (defaults to 'draft' for any persisted prep). */
  prep_status?: VisitPrepStatus;
  /** Raw patient input(s) used to seed this prep, in the order they were added. */
  patient_input_history?: string[];
  /** Any additional special needs the patient mentioned (mobility, translator, etc.). */
  special_needs?: string[];
  /** Suggestions from caregivers viewing the shared prep. */
  caregiver_suggestions?: CaregiverSuggestion[];
}

/** Resolve the conceptual prep status from an appointment's prep_json. */
export function getPrepStatus(prep: VisitPrep | null | undefined): VisitPrepStatus {
  if (!prep) return 'not_started';
  return prep.prep_status ?? 'draft';
}

export interface PlanItemMetadata {
  contact_name?: string;
  contact_phone?: string;
  reference_number?: string;
  reminder_offset_hours?: number;
  notes?: string;
  [key: string]: unknown;
}

export interface PlanItem {
  id: string;
  appointment_id: string;
  profile_id: string;
  item_type: PlanItemType;
  title: string;
  description: string | null;
  priority: PlanItemPriority;
  sort_order: number;
  status: PlanItemStatus;
  assigned_to: string | null;
  due_at: string | null;
  reminder_at: string | null;
  metadata_json: PlanItemMetadata | null;
  source: PlanItemSource;
  created_at: string;
  updated_at: string;
}

export interface AppointmentWithPlan extends Appointment {
  plan_items: PlanItem[];
}

export type AppointmentDetail = Appointment;

export interface CreateAppointmentParams {
  profile_id: string;
  title: string;
  appointment_type: AppointmentType;
  provider_name?: string;
  facility_name?: string;
  location_text?: string;
  purpose?: string;
  notes?: string;
  start_time: string;
  end_time?: string;
  timezone?: string;
  status?: AppointmentStatus;
  context_json?: AppointmentContext;
}

export interface UpdateAppointmentParams {
  title?: string;
  appointment_type?: AppointmentType;
  provider_name?: string | null;
  facility_name?: string | null;
  location_text?: string | null;
  purpose?: string | null;
  notes?: string | null;
  start_time?: string;
  end_time?: string | null;
  timezone?: string;
  status?: AppointmentStatus;
  plan_status?: AppointmentPlanStatus;
}

export interface AppointmentFilter {
  status?: AppointmentStatus | AppointmentStatus[];
  startBefore?: string;
  startAfter?: string;
  appointmentType?: AppointmentType;
}

/** Plan item draft used during generation, before persisting. */
export interface PlanItemDraft {
  item_type: PlanItemType;
  title: string;
  description?: string;
  priority: PlanItemPriority;
  sort_order: number;
  source: PlanItemSource;
  metadata_json?: PlanItemMetadata;
  due_at?: string;
  reminder_at?: string;
}

export interface Closeout {
  id: string;
  appointment_id: string;
  profile_id: string;
  status: CloseoutStatus;
  visit_happened: boolean | null;
  quick_summary: string | null;
  followup_timeframe: string | null;
  attendees: string | null;
  created_at: string;
  updated_at: string;
}

export interface Outcome {
  id: string;
  closeout_id: string;
  profile_id: string;
  outcome_type: OutcomeType;
  description: string;
  proposed_value: Record<string, unknown> | null;
  confidence: number | null;
  status: OutcomeStatus;
  edited_value: Record<string, unknown> | null;
  created_at: string;
}

// ── Pre-Appointment Profile Accuracy Check ────────────────────────────────

export type PreAppointmentCheckStatus =
  | 'good'
  | 'stale'
  | 'missing'
  | 'action_needed';

export type PreAppointmentCheckCategory =
  | 'medications'
  | 'allergies'
  | 'conditions'
  | 'insurance'
  | 'care_team'
  | 'questions'
  | 'documents';

export interface PreAppointmentCheckItem {
  id: string;
  category: PreAppointmentCheckCategory;
  title: string;
  detail: string;
  status: PreAppointmentCheckStatus;
  actionLabel?: string;
  actionRoute?: string;
  actionParams?: Record<string, string>;
}

export interface PreAppointmentCheckResult {
  isReady: boolean;
  items: PreAppointmentCheckItem[];
  completedCount: number;
  totalCount: number;
}

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  doctor: 'Doctor Visit',
  labs: 'Labs',
  imaging: 'Imaging',
  procedure: 'Procedure',
  therapy: 'Therapy',
  other: 'Other',
};

export const APPOINTMENT_TYPE_ICONS: Record<AppointmentType, string> = {
  doctor: '\uD83E\uDE7A',
  labs: '\uD83E\uDDEA',
  imaging: '\uD83D\uDCF8',
  procedure: '\uD83C\uDFE5',
  therapy: '\uD83D\uDCAC',
  other: '\uD83D\uDCC5',
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
};

export const PLAN_ITEM_TYPE_LABELS: Record<PlanItemType, string> = {
  task: 'Tasks',
  logistics: 'Logistics',
  prep: 'Prep Checklist',
  question: 'Questions to Ask',
};
