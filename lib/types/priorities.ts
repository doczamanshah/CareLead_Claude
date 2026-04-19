// ── Patient Priorities — "What Matters to You" ────────────────────────

export type PriorityImportance = 'high' | 'medium';

export type FrictionCategory =
  | 'medications'
  | 'appointments'
  | 'billing'
  | 'results'
  | 'preventive'
  | 'coordination'
  | 'other';

export type FrequencyPreference = 'minimal' | 'moderate' | 'frequent';

export interface HealthPriority {
  topic: string;
  importance: PriorityImportance;
  detail: string | null;
}

export interface FrictionPoint {
  area: string;
  description: string;
  category: FrictionCategory;
}

export interface TrackingDifficulty {
  what: string;
  category: string;
}

export interface SupportContext {
  helpers: string[];
  coordination_challenges: string | null;
}

export interface ReminderPreferences {
  preferred_time: string | null;
  frequency_preference: FrequencyPreference | null;
  channels: string[];
}

export interface ExtractedPriorities {
  health_priorities: HealthPriority[];
  friction_points: FrictionPoint[];
  tracking_difficulties: TrackingDifficulty[];
  support_context: SupportContext | null;
  reminder_preferences: ReminderPreferences | null;
  conditions_of_focus: string[];
  confidence: number;
}

/** Implicit signals learned from task/module usage behavior. */
export interface ImplicitSignals {
  completionRateByCategory?: Record<string, number>;
  dismissalRateByCategory?: Record<string, number>;
  averageCompletionTimeByCategory?: Record<string, string>;
  mostUsedModules?: string[];
  lastUpdatedAt?: string;
}

export interface PatientPriorities {
  id: string;
  profile_id: string;
  household_id: string;
  raw_input: string | null;
  health_priorities: HealthPriority[];
  friction_points: FrictionPoint[];
  tracking_difficulties: TrackingDifficulty[];
  support_context: SupportContext | null;
  reminder_preferences: ReminderPreferences | null;
  conditions_of_focus: string[];
  implicit_signals: ImplicitSignals;
  last_prompted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertPatientPrioritiesParams {
  profile_id: string;
  household_id: string;
  raw_input: string;
  extracted: ExtractedPriorities;
}
