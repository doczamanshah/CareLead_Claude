// ── Cross-Document Profile Enrichment Types ────────────────────────────────
//
// When documents are processed (bills, EOBs, lab/imaging results, generic
// uploads), CareLead detects profile-relevant facts beyond the document's
// own domain and surfaces them as suggestions the user can accept with one
// tap. This file defines the shape of those suggestions and the categories
// detection can produce.

import type { ProfileFactCategory } from './profile';

/**
 * Categories the enrichment engine is allowed to propose. These map 1:1 to
 * `profile_facts.category` values and are constrained by the DB CHECK
 * constraint in migration 00001 (no `facility` — facility-like detections
 * are routed to `care_team`).
 */
export type EnrichmentCategory = Extract<
  ProfileFactCategory,
  | 'care_team'
  | 'insurance'
  | 'condition'
  | 'allergy'
  | 'medication'
  | 'pharmacy'
>;

/** Where the suggestion was derived from. */
export type EnrichmentSourceType = 'billing' | 'result' | 'document';

/**
 * A single enrichment suggestion the user can accept or dismiss. The
 * `valueJson` is the structured payload that becomes the new profile_fact
 * value when accepted. `id` is a stable hash derived from
 * (source, category, normalized identifier) so the same suggestion never
 * reappears with a new ID across renders.
 */
export interface ProfileEnrichmentSuggestion {
  id: string;
  category: EnrichmentCategory;
  factKey: string;
  displayTitle: string;
  displayDetail: string;
  valueJson: Record<string, unknown>;
  confidence: number;
  source: string;
  sourceLabel: string;
  isDuplicate: boolean;
}

/** Minimum confidence required for a suggestion to be surfaced to the user. */
export const ENRICHMENT_MIN_CONFIDENCE = 0.5;

/** Max suggestions shown per source so the card never feels overwhelming. */
export const ENRICHMENT_MAX_PER_SOURCE = 5;

/**
 * Category-aware visual metadata for the suggestion row. Lives here (not in
 * the component) so other surfaces — Home briefing, badges, etc. — can stay
 * visually consistent.
 */
export const ENRICHMENT_CATEGORY_META: Record<
  EnrichmentCategory,
  { icon: string; verb: string }
> = {
  care_team: { icon: 'people-outline', verb: 'Add to your care team' },
  insurance: { icon: 'card-outline', verb: 'Update insurance' },
  condition: { icon: 'fitness-outline', verb: 'Add as a condition' },
  allergy: { icon: 'alert-circle-outline', verb: 'Add as an allergy' },
  medication: { icon: 'medical-outline', verb: 'Add as a medication' },
  pharmacy: { icon: 'storefront-outline', verb: 'Add pharmacy' },
};
