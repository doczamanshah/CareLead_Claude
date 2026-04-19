// ── Data Quality Types ────────────────────────────────────────────────────
//
// The Data Quality module scans a profile for staleness (data that hasn't
// been verified in a while) and inconsistencies (logical conflicts across
// modules — meds without conditions, conditions without specialists, etc.).
// All analysis is client-side from already-fetched data — no API calls.

export type StalenessLevel = 'fresh' | 'aging' | 'stale' | 'very_stale';

export type DataQualityCategory =
  | 'medications'
  | 'conditions'
  | 'allergies'
  | 'insurance'
  | 'care_team'
  | 'emergency_contact'
  | 'lab_recency'
  | 'other';

export type DataQualitySourceType =
  | 'profile_facts'
  | 'med_medications'
  | 'result_items'
  | 'preventive_items';

export interface StaleItem {
  id: string;
  sourceType: DataQualitySourceType;
  sourceId: string;
  label: string;
  category: DataQualityCategory;
  lastUpdated: string;
  daysSinceUpdate: number;
  staleness: StalenessLevel;
  suggestion: string;
}

export type InconsistencyType =
  | 'med_without_condition'
  | 'condition_without_provider'
  | 'condition_without_med'
  | 'duplicate_entries'
  | 'insurance_expired'
  | 'stale_emergency_contact';

export type InconsistencySeverity = 'info' | 'warning';

export interface InconsistencyRelatedItem {
  sourceType: DataQualitySourceType;
  sourceId: string;
  label: string;
}

export interface DataInconsistency {
  id: string;
  type: InconsistencyType;
  severity: InconsistencySeverity;
  title: string;
  detail: string;
  suggestion: string;
  relatedItems: InconsistencyRelatedItem[];
}

export type DataQualityHealthTier = 'good' | 'fair' | 'needs_attention';

export interface DataQualityReport {
  staleItems: StaleItem[];
  inconsistencies: DataInconsistency[];
  overallHealthScore: number;
  healthTier: DataQualityHealthTier;
  lastCheckedAt: string;
}

export interface ConfirmCurrentParams {
  sourceType: DataQualitySourceType;
  sourceId: string;
  userId: string | null;
}
