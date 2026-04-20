// ── Annual Wellness Visit Prep Types ─────────────────────────────────────
//
// Types for the guided Annual Wellness Visit preparation flow. The flow is
// self-paced (steps can be done in any order) and its progress persists via
// `stores/wellnessVisitStore.ts` across app sessions.

export type WellnessStepKey =
  | 'freeform'
  | 'profile_review'
  | 'preventive_agenda'
  | 'questions'
  | 'packet';

export type WellnessQuestionCategory =
  | 'symptoms'
  | 'medications'
  | 'screenings'
  | 'lifestyle'
  | 'general';

export type WellnessQuestionPriority = 'high' | 'medium' | 'low';

export type WellnessQuestionSource =
  | 'freeform'
  | 'preventive_agenda'
  | 'medication_concern'
  | 'manual';

export interface WellnessQuestion {
  id: string;
  text: string;
  category: WellnessQuestionCategory;
  priority: WellnessQuestionPriority;
  source: WellnessQuestionSource;
}

export type WellnessLifestyleArea =
  | 'diet'
  | 'exercise'
  | 'sleep'
  | 'stress'
  | 'alcohol'
  | 'tobacco'
  | 'weight'
  | 'other';

export type WellnessConditionUpdateType =
  | 'new'
  | 'worsening'
  | 'improving'
  | 'resolved';

export type WellnessProfileUpdateCategory =
  | 'medication'
  | 'condition'
  | 'allergy'
  | 'insurance'
  | 'care_team'
  | 'pharmacy'
  | 'emergency_contact';

export type WellnessProfileUpdateAction = 'add' | 'update' | 'remove';

export interface WellnessExtractionSymptom {
  description: string;
  duration: string | null;
  severity: string | null;
}

export interface WellnessExtractionMedConcern {
  medication: string | null;
  concern: string;
}

export interface WellnessExtractionConditionUpdate {
  condition: string;
  update_type: WellnessConditionUpdateType;
  detail: string | null;
}

export interface WellnessExtractionQuestion {
  question: string;
  priority: WellnessQuestionPriority;
  category: string;
}

export interface WellnessExtractionLifestyle {
  area: string;
  detail: string;
}

export interface WellnessExtractionScreeningRequest {
  screening: string;
  reason: string | null;
}

export interface WellnessExtractionProfileUpdate {
  category: string;
  action: WellnessProfileUpdateAction;
  detail: string;
}

export interface WellnessExtraction {
  new_symptoms: WellnessExtractionSymptom[];
  medication_concerns: WellnessExtractionMedConcern[];
  condition_updates: WellnessExtractionConditionUpdate[];
  questions_for_doctor: WellnessExtractionQuestion[];
  lifestyle_changes: WellnessExtractionLifestyle[];
  screening_requests: WellnessExtractionScreeningRequest[];
  other_concerns: string[];
  profile_updates_suggested: WellnessExtractionProfileUpdate[];
  confidence: number;
}

export interface WellnessProfileChange {
  id: string;
  category: WellnessProfileUpdateCategory | 'other';
  detail: string;
  action: WellnessProfileUpdateAction;
  appliedAt: string;
}

export interface WellnessVisitPrep {
  currentVisitId: string;
  freeformInput: string;
  extractedData: WellnessExtraction | null;
  profileReviewCompleted: boolean;
  profileChanges: WellnessProfileChange[];
  selectedScreenings: string[];
  questions: WellnessQuestion[];
  packetGenerated: boolean;
  stepsCompleted: Record<WellnessStepKey, boolean>;
  createdAt: string;
  appointmentId: string | null;
}

export interface WellnessPacket {
  title: string;
  generatedAt: string;
  text: string;
}

export const WELLNESS_STEPS: {
  key: WellnessStepKey;
  title: string;
  subtitle: string;
  icon: string;
  route: string;
}[] = [
  {
    key: 'freeform',
    title: "Share what's on your mind",
    subtitle: "Tell us concerns, changes, and questions.",
    icon: 'chatbubble-ellipses-outline',
    route: '/(main)/preventive/wellness-visit/freeform',
  },
  {
    key: 'profile_review',
    title: 'Review your profile',
    subtitle: 'Confirm meds, conditions, allergies, and more.',
    icon: 'person-outline',
    route: '/(main)/preventive/wellness-visit/profile-review',
  },
  {
    key: 'preventive_agenda',
    title: 'Preventive care agenda',
    subtitle: 'Pick screenings to discuss at the visit.',
    icon: 'shield-checkmark-outline',
    route: '/(main)/preventive/wellness-visit/preventive-agenda',
  },
  {
    key: 'questions',
    title: 'Your questions',
    subtitle: 'Prioritize and add to your list.',
    icon: 'help-circle-outline',
    route: '/(main)/preventive/wellness-visit/questions',
  },
  {
    key: 'packet',
    title: 'Your visit packet',
    subtitle: 'Generate a shareable document.',
    icon: 'document-text-outline',
    route: '/(main)/preventive/wellness-visit/packet',
  },
];

export const QUESTION_CATEGORY_LABELS: Record<WellnessQuestionCategory, string> = {
  symptoms: 'Symptoms',
  medications: 'Medications',
  screenings: 'Screenings',
  lifestyle: 'Lifestyle',
  general: 'General',
};

export const QUESTION_PRIORITY_LABELS: Record<WellnessQuestionPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
