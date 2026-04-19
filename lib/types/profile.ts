export interface Household {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  household_id: string;
  user_id: string | null;
  display_name: string;
  date_of_birth: string | null;
  gender: string | null;
  relationship: 'self' | 'dependent';
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type ProfileFactCategory =
  | 'condition'
  | 'allergy'
  | 'medication'
  | 'surgery'
  | 'family_history'
  | 'insurance'
  | 'care_team'
  | 'pharmacy'
  | 'emergency_contact'
  | 'goal'
  | 'measurement'
  | 'immunization';

export interface ProfileFact {
  id: string;
  profile_id: string;
  category: ProfileFactCategory;
  field_key: string;
  value_json: Record<string, unknown>;
  source_type: 'manual' | 'voice' | 'photo' | 'document' | 'import';
  source_ref: string | null;
  verification_status: 'unverified' | 'verified' | 'needs_review';
  verified_at: string | null;
  verified_by: string | null;
  actor_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProfileWithFacts extends Profile {
  facts: ProfileFact[];
}

export interface HouseholdMember {
  id: string;
  household_id: string;
  user_id: string | null;
  role: 'owner' | 'admin' | 'caregiver' | 'viewer';
  status: 'active' | 'invited' | 'removed';
  invited_email: string | null;
  created_at: string;
  updated_at: string;
}

// ── Quarterly Profile Review ──────────────────────────────────────────────

export type ReviewFrequency = 'quarterly' | 'biannual' | 'never';

export type ProfileReviewSourceType =
  | 'profile_fact'
  | 'medication';

export type ProfileReviewCategory =
  | 'medications'
  | 'conditions'
  | 'allergies'
  | 'care_team'
  | 'insurance'
  | 'emergency_contact';

export interface ProfileReviewItem {
  id: string;
  label: string;
  detail: string;
  lastUpdated: string;
  isStale: boolean;
  sourceType: ProfileReviewSourceType;
  sourceId: string;
}

export interface ProfileReviewSection {
  category: ProfileReviewCategory;
  title: string;
  icon: string;
  items: ProfileReviewItem[];
  isEmpty: boolean;
}

export interface ProfileReviewResult {
  sections: ProfileReviewSection[];
  totalItems: number;
  staleItems: number;
  lastReviewedAt: string | null;
}

export const PROFILE_FACT_CATEGORIES: {
  key: ProfileFactCategory;
  label: string;
  icon: string;
  fieldKeys: string[];
}[] = [
  {
    key: 'condition',
    label: 'Conditions',
    icon: '🩺',
    fieldKeys: ['condition.name', 'condition.status', 'condition.diagnosed_date', 'condition.notes'],
  },
  {
    key: 'allergy',
    label: 'Allergies',
    icon: '⚠️',
    fieldKeys: ['allergy.substance', 'allergy.reaction', 'allergy.severity', 'allergy.notes'],
  },
  {
    key: 'medication',
    label: 'Medications',
    icon: '💊',
    fieldKeys: ['medication.name', 'medication.dosage', 'medication.frequency', 'medication.prescriber', 'medication.notes'],
  },
  {
    key: 'surgery',
    label: 'Surgical History',
    icon: '🏥',
    fieldKeys: ['surgery.name', 'surgery.date', 'surgery.hospital', 'surgery.notes'],
  },
  {
    key: 'family_history',
    label: 'Family History',
    icon: '🧬',
    fieldKeys: ['family_history.condition', 'family_history.relative', 'family_history.notes'],
  },
  {
    key: 'insurance',
    label: 'Insurance',
    icon: '🛡️',
    fieldKeys: ['insurance.provider', 'insurance.plan', 'insurance.member_id', 'insurance.group_number', 'insurance.phone'],
  },
  {
    key: 'care_team',
    label: 'Care Team',
    icon: '👨‍⚕️',
    fieldKeys: ['care_team.name', 'care_team.specialty', 'care_team.phone', 'care_team.address', 'care_team.notes'],
  },
  {
    key: 'pharmacy',
    label: 'Pharmacy',
    icon: '🏪',
    fieldKeys: ['pharmacy.name', 'pharmacy.phone', 'pharmacy.address', 'pharmacy.notes'],
  },
  {
    key: 'emergency_contact',
    label: 'Emergency Contacts',
    icon: '📞',
    fieldKeys: ['emergency_contact.name', 'emergency_contact.relationship', 'emergency_contact.phone', 'emergency_contact.notes'],
  },
  {
    key: 'goal',
    label: 'Goals',
    icon: '🎯',
    fieldKeys: ['goal.description', 'goal.target_date', 'goal.status', 'goal.notes'],
  },
];
