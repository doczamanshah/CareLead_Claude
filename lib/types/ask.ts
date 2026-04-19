// ── Voice Retrieval ("Ask Profile") Types ─────────────────────────────────
//
// The Voice Retrieval module queries a unified, cross-domain view of a
// profile's data. The Profile Index is a READ-ONLY aggregation that pulls
// from the canonical domain tables (profile_facts, med_medications,
// result_items, apt_appointments, billing_cases, preventive_items, etc.)
// and projects every row into the same CanonicalFact shape so retrieval
// and ranking can reason over one schema.
//
// Nothing here writes to the database. The shape is built on demand and
// cached client-side via TanStack Query.

export type FactDomain =
  | 'medications'
  | 'labs'
  | 'allergies'
  | 'conditions'
  | 'appointments'
  | 'insurance'
  | 'care_team'
  | 'surgeries'
  | 'immunizations'
  | 'vitals'
  | 'results'
  | 'billing'
  | 'preventive';

export type FactStatus =
  | 'active'
  | 'inactive'
  | 'unverified'
  | 'verified'
  | 'conflicted'
  | 'archived';

export type FactProvenanceSource =
  | 'manual'
  | 'document'
  | 'extraction'
  | 'import'
  | 'system';

export interface FactProvenance {
  source: FactProvenanceSource;
  sourceLabel: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

/**
 * Freshness derived from the most-relevant timestamp on a fact:
 *  - current : updated within the last 30 days
 *  - recent  : 30 – 90 days old
 *  - stale   : 90+ days old
 *  - unknown : no date available
 */
export type FactFreshness = 'current' | 'recent' | 'stale' | 'unknown';

export interface CanonicalFact {
  id: string;
  profileId: string;
  domain: FactDomain;
  factType: string;
  factKey: string;
  displayName: string;
  value: unknown;
  secondaryValue: string | null;
  dateRelevant: string | null;
  status: FactStatus;
  provenance: FactProvenance;
  sourceId: string | null;
  sourceType: string | null;
  sourceDocumentId: string | null;
  freshness: FactFreshness;
  updatedAt: string;
  conflictGroupId: string | null;
}

export interface ProfileIndex {
  profileId: string;
  profileName: string;
  facts: CanonicalFact[];
  lastBuilt: string;
  factCounts: Record<FactDomain, number>;
}

// ── Answer surface (used by the retrieval engine in Step 2) ────────────────

export type AnswerCardActionType =
  | 'view_source'
  | 'verify'
  | 'resolve_conflict'
  | 'view_detail';

export interface AnswerCardAction {
  type: AnswerCardActionType;
  label: string;
  targetId: string | null;
  targetRoute: string | null;
  sourceType?: string | null;
  conflictGroupId?: string | null;
}

export interface AnswerCard {
  id: string;
  title: string;
  primaryValue: string;
  secondaryValue: string | null;
  domain: FactDomain;
  provenance: FactProvenance;
  freshness: FactFreshness;
  dateRelevant: string | null;
  status: FactStatus;
  sourceId: string | null;
  sourceType: string | null;
  conflictGroupId: string | null;
  actions: AnswerCardAction[];
}

// ── Rich visualization card formats ────────────────────────────────────────

export type AnswerFormat =
  | 'single_card'
  | 'table_card'
  | 'trend_chart'
  | 'comparison_table'
  | 'summary_list'
  | 'timeline'
  | 'multi_card';

export type FlagColor = 'normal' | 'high' | 'low' | 'abnormal' | 'critical';

export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
}

export interface TableRow {
  values: Record<string, string | number | null>;
  flag?: string | null;
  flagColor?: FlagColor;
}

export interface TableCard {
  id: string;
  title: string;
  domain: FactDomain;
  columns: TableColumn[];
  rows: TableRow[];
  provenance: FactProvenance;
  dateRelevant: string | null;
  sourceId: string | null;
  sourceType: string | null;
  actions: AnswerCardAction[];
}

export interface TrendDataPoint {
  date: string;
  value: number;
  flag: string | null;
  sourceId: string | null;
}

export interface TrendChartCard {
  id: string;
  title: string;
  domain: FactDomain;
  analyteName: string;
  unit: string;
  dataPoints: TrendDataPoint[];
  refRangeLow: number | null;
  refRangeHigh: number | null;
  provenance: FactProvenance;
  actions: AnswerCardAction[];
}

export interface ComparisonCellValue {
  value: string;
  flag: string | null;
}

export interface ComparisonTableCard {
  id: string;
  title: string;
  domain: FactDomain;
  dates: string[];
  analyteNames: string[];
  values: Record<string, Record<string, ComparisonCellValue>>;
  provenance: FactProvenance;
  actions: AnswerCardAction[];
}

export interface SummaryListItem {
  label: string;
  detail: string;
  secondary?: string;
  flag?: string | null;
  flagColor?: FlagColor;
  sourceId?: string | null;
  sourceType?: string | null;
  sourceRoute?: string | null;
  status?: FactStatus;
  conflictGroupId?: string | null;
}

export interface SummaryListCard {
  id: string;
  title: string;
  domain: FactDomain;
  items: SummaryListItem[];
  provenance: FactProvenance;
  actions: AnswerCardAction[];
}

export interface TimelineItem {
  label: string;
  sublabel: string;
  date: string;
  status?: string;
  sourceId?: string | null;
  sourceType?: string | null;
  sourceRoute?: string | null;
}

export interface TimelineCard {
  id: string;
  title: string;
  domain: FactDomain;
  upcoming: TimelineItem[];
  past: TimelineItem[];
  actions: AnswerCardAction[];
}

/**
 * A one-tap entry point offered to the user when their question can't be
 * answered from the profile. The Ask screen renders a primary button (and
 * optional secondary) that navigates to the relevant capture/entry screen
 * with `actionParams` passed as route query params.
 *
 * GapAction is rendered both for total-empty responses AND alongside
 * partial-match responses (e.g., "no Atorvastatin, but here are your meds —
 * want to add it?").
 */
export interface GapAction {
  message: string;
  actionLabel: string;
  actionRoute: string;
  actionParams?: Record<string, string>;
  secondaryLabel?: string;
  secondaryRoute?: string;
  secondaryParams?: Record<string, string>;
}

export interface AskResponse {
  query: string;
  shortAnswer: string;
  cards: AnswerCard[];
  tableCards: TableCard[];
  trendCharts: TrendChartCard[];
  comparisonTables: ComparisonTableCard[];
  summaryLists: SummaryListCard[];
  timelines: TimelineCard[];
  suggestedFollowUps: string[];
  noResults: boolean;
  gapAction: GapAction | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export const ALL_FACT_DOMAINS: FactDomain[] = [
  'medications',
  'labs',
  'allergies',
  'conditions',
  'appointments',
  'insurance',
  'care_team',
  'surgeries',
  'immunizations',
  'vitals',
  'results',
  'billing',
  'preventive',
];

export function emptyFactCounts(): Record<FactDomain, number> {
  return ALL_FACT_DOMAINS.reduce(
    (acc, d) => {
      acc[d] = 0;
      return acc;
    },
    {} as Record<FactDomain, number>,
  );
}
