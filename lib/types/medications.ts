// ── Medication Types ───────────────────────────────────────────────────────

export type MedicationStatus = 'active' | 'paused' | 'stopped';
export type MedicationForm = 'tablet' | 'capsule' | 'liquid' | 'cream' | 'injection' | 'inhaler' | 'patch' | 'drops' | 'other';
export type MedicationRoute = 'oral' | 'topical' | 'injection' | 'inhaled' | 'sublingual' | 'other';
export type AdherenceEventType = 'taken' | 'skipped' | 'snoozed';

export type MedicationFrequency =
  | 'once_daily'
  | 'twice_daily'
  | 'three_times_daily'
  | 'four_times_daily'
  | 'every_morning'
  | 'every_evening'
  | 'at_bedtime'
  | 'as_needed'
  | 'other';

export const FREQUENCY_LABELS: Record<MedicationFrequency, string> = {
  once_daily: 'Once daily',
  twice_daily: 'Twice daily',
  three_times_daily: 'Three times daily',
  four_times_daily: 'Four times daily',
  every_morning: 'Every morning',
  every_evening: 'Every evening',
  at_bedtime: 'At bedtime',
  as_needed: 'As needed',
  other: 'Other',
};

export const FORM_LABELS: Record<MedicationForm, string> = {
  tablet: 'Tablet',
  capsule: 'Capsule',
  liquid: 'Liquid',
  cream: 'Cream',
  injection: 'Injection',
  inhaler: 'Inhaler',
  patch: 'Patch',
  drops: 'Drops',
  other: 'Other',
};

export const ROUTE_LABELS: Record<MedicationRoute, string> = {
  oral: 'Oral',
  topical: 'Topical',
  injection: 'Injection',
  inhaled: 'Inhaled',
  sublingual: 'Sublingual',
  other: 'Other',
};

export interface Medication {
  id: string;
  profile_id: string;
  drug_name: string;
  strength: string | null;
  form: MedicationForm | null;
  route: MedicationRoute | null;
  status: MedicationStatus;
  prn_flag: boolean;
  notes: string | null;
  source_type: string | null;
  source_ref: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MedicationSig {
  id: string;
  medication_id: string;
  profile_id: string;
  dose_text: string | null;
  frequency_text: string | null;
  timing_json: string[] | null;
  instructions: string | null;
  source_type: string | null;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface MedicationSupply {
  id: string;
  medication_id: string;
  profile_id: string;
  last_fill_date: string | null;
  days_supply: number | null;
  refills_remaining: number | null;
  pharmacy_name: string | null;
  pharmacy_phone: string | null;
  prescriber_name: string | null;
  prescriber_phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdherenceEvent {
  id: string;
  medication_id: string;
  profile_id: string;
  event_type: AdherenceEventType;
  scheduled_time: string | null;
  recorded_at: string;
  notes: string | null;
  created_at: string;
}

export interface MedicationWithDetails extends Medication {
  sig: MedicationSig | null;
  supply: MedicationSupply | null;
}

export interface MedicationDetail extends MedicationWithDetails {
  recentAdherence: AdherenceEvent[];
}

export type RefillStatus = 'ok' | 'due_soon' | 'overdue' | 'needs_info';

export interface RefillInfo {
  medicationId: string;
  drugName: string;
  strength: string | null;
  status: RefillStatus;
  daysRemaining: number | null;
  lastFillDate: string | null;
  daysSupply: number | null;
  refillsRemaining: number | null;
  pharmacyName: string | null;
  pharmacyPhone: string | null;
  prescriberName: string | null;
  prescriberPhone: string | null;
}

export interface CreateMedicationParams {
  profile_id: string;
  drug_name: string;
  strength?: string;
  form?: MedicationForm;
  route?: MedicationRoute;
  prn_flag?: boolean;
  notes?: string;
  dose_text?: string;
  frequency_text?: string;
  timing_json?: string[];
  instructions?: string;
  last_fill_date?: string;
  days_supply?: number;
  refills_remaining?: number;
  pharmacy_name?: string;
  pharmacy_phone?: string;
  prescriber_name?: string;
  prescriber_phone?: string;
}

export interface UpdateMedicationParams {
  drug_name?: string;
  strength?: string | null;
  form?: MedicationForm | null;
  route?: MedicationRoute | null;
  prn_flag?: boolean;
  notes?: string | null;
}

export interface UpdateSigParams {
  dose_text?: string | null;
  frequency_text?: string | null;
  timing_json?: string[] | null;
  instructions?: string | null;
}

export interface UpdateSupplyParams {
  last_fill_date?: string | null;
  days_supply?: number | null;
  refills_remaining?: number | null;
  pharmacy_name?: string | null;
  pharmacy_phone?: string | null;
  prescriber_name?: string | null;
  prescriber_phone?: string | null;
}

export interface TodaysDose {
  medication: MedicationWithDetails;
  scheduledTime: string | null;
  adherenceToday: AdherenceEventType | null;
}
