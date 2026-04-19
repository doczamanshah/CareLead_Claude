/**
 * Data Quality service.
 *
 * Scans a profile's already-fetched data for two classes of trust signal:
 *
 *   1. Staleness — items that haven't been verified in long enough that the
 *      patient may have forgotten to remove or update them. Per-category
 *      thresholds because medications change far more often than conditions.
 *
 *   2. Inconsistencies — logical conflicts across modules. A med implies a
 *      condition that's not on the profile; a condition typically requires a
 *      specialist who isn't in the care team; a condition almost always needs
 *      medication but the profile lists none. These are *suggestions*, not
 *      errors — patients have valid reasons to deviate (diet-controlled
 *      diabetes, in-progress workups, etc).
 *
 * Pure client-side analysis. No DB calls — caller hands in the slices already
 * loaded by hooks elsewhere in the app. This keeps the data quality screen
 * fast, lets it re-run without round-trips, and decouples the rules from
 * Supabase.
 */

import type { ProfileFact } from '@/lib/types/profile';
import type { Medication } from '@/lib/types/medications';
import type { ResultItem, ResultLabObservation } from '@/lib/types/results';
import type { PreventiveItem } from '@/lib/types/preventive';
import type {
  DataInconsistency,
  DataQualityCategory,
  DataQualityHealthTier,
  DataQualityReport,
  StaleItem,
  StalenessLevel,
} from '@/lib/types/dataQuality';
import { inferConditionFromMedication } from '@/lib/data/medConditionMap';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ── Per-category staleness thresholds (days) ──────────────────────────────
//
// "fresh" / "aging" / "stale" / "very_stale" boundaries. Anything older than
// `very_stale` falls into the very_stale bucket (open-ended).
//
// Notes:
//  - Insurance plans cycle annually, so the bar is tighter.
//  - Conditions are slow-changing — only flag once they're truly old.
//  - Allergies use a separate path (see `evaluateAllergyStaleness` below).

interface StalenessThresholds {
  freshUntil: number;
  agingUntil: number;
  staleUntil: number;
}

const THRESHOLDS: Record<Exclude<DataQualityCategory, 'lab_recency' | 'other'>, StalenessThresholds> = {
  medications: { freshUntil: 90, agingUntil: 180, staleUntil: 365 },
  insurance: { freshUntil: 180, agingUntil: 365, staleUntil: 365 },
  conditions: { freshUntil: 365, agingUntil: 730, staleUntil: 730 },
  care_team: { freshUntil: 365, agingUntil: 730, staleUntil: 730 },
  allergies: { freshUntil: 365, agingUntil: 365, staleUntil: 365 },
  emergency_contact: { freshUntil: 365, agingUntil: 365, staleUntil: 365 },
};

const KEY_LAB_ANALYTES = ['a1c', 'hemoglobin a1c', 'hba1c', 'lipid', 'cholesterol', 'ldl', 'hdl', 'triglycerides'];

// ── Helpers ───────────────────────────────────────────────────────────────

function daysSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - t) / MS_PER_DAY);
}

function classifyStaleness(days: number, thresholds: StalenessThresholds): StalenessLevel {
  if (days < thresholds.freshUntil) return 'fresh';
  if (days < thresholds.agingUntil) return 'aging';
  if (days < thresholds.staleUntil) return 'stale';
  return 'very_stale';
}

function describeAge(days: number): string {
  if (!Number.isFinite(days)) return 'Date unknown';
  if (days < 1) return 'Updated today';
  if (days < 30) return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `Updated ${months} month${months === 1 ? '' : 's'} ago`;
  }
  const years = Math.floor(days / 365);
  return `Updated over ${years} year${years === 1 ? '' : 's'} ago`;
}

function suggestionFor(category: DataQualityCategory, level: StalenessLevel): string {
  if (level === 'very_stale') return 'This may be outdated — please review';
  if (level === 'stale') return 'Confirm this is still current';
  if (level === 'aging') return 'A quick check-in keeps your profile accurate';
  return 'Looks current';
}

function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b(dr\.?|md|do|np|pa|rn)\b/g, '')
    .replace(/[\.,]/g, '')
    .trim();
}

function unwrapValue(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) return {};
  if (
    Object.keys(value).length === 1 &&
    'value' in value &&
    typeof value.value === 'object' &&
    value.value !== null
  ) {
    return value.value as Record<string, unknown>;
  }
  return value;
}

function strField(v: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const raw = v[k];
    if (raw == null) continue;
    const s = String(raw).trim();
    if (s.length > 0) return s;
  }
  return null;
}

function profileFactLabel(fact: ProfileFact): string {
  const v = unwrapValue(fact.value_json);
  switch (fact.category) {
    case 'condition':
      return strField(v, 'name', 'condition', 'value') ?? 'Condition';
    case 'allergy':
      return strField(v, 'substance', 'allergen', 'name', 'value') ?? 'Allergy';
    case 'insurance':
      return strField(v, 'payer_name', 'provider', 'plan', 'value') ?? 'Insurance';
    case 'care_team':
      return strField(v, 'name', 'provider', 'value') ?? 'Provider';
    case 'emergency_contact':
      return strField(v, 'name', 'value') ?? 'Emergency contact';
    case 'pharmacy':
      return strField(v, 'name', 'value') ?? 'Pharmacy';
    default:
      return strField(v, 'name', 'value') ?? 'Item';
  }
}

function medicationLabel(med: Medication): string {
  return [med.drug_name, med.strength].filter(Boolean).join(' ').trim() || 'Medication';
}

function lastVerifiedAt(fact: ProfileFact): string {
  return fact.verified_at ?? fact.updated_at;
}

// ── Specialty matching for condition_without_provider ──────────────────────
//
// Conservative — only conditions that almost universally have a primary
// specialist association. Specialty matching is a fuzzy includes() over the
// normalized free-text specialty field.

interface ConditionSpecialtyRule {
  conditionPatterns: string[];
  specialtyPatterns: string[];
  specialtyLabel: string;
}

const CONDITION_SPECIALIST_RULES: ConditionSpecialtyRule[] = [
  {
    conditionPatterns: ['diabetes'],
    specialtyPatterns: ['endocrinolog', 'diabetolog'],
    specialtyLabel: 'endocrinologist',
  },
  {
    conditionPatterns: ['heart disease', 'heart failure', 'coronary', 'arrhythmia', 'atrial fibrillation', 'afib'],
    specialtyPatterns: ['cardiolog'],
    specialtyLabel: 'cardiologist',
  },
  {
    conditionPatterns: ['kidney disease', 'ckd', 'renal'],
    specialtyPatterns: ['nephrolog'],
    specialtyLabel: 'nephrologist',
  },
  {
    conditionPatterns: ['cancer', 'carcinoma', 'leukemia', 'lymphoma'],
    specialtyPatterns: ['oncolog', 'hematolog'],
    specialtyLabel: 'oncologist',
  },
  {
    conditionPatterns: ['copd', 'asthma'],
    specialtyPatterns: ['pulmonolog', 'allerg'],
    specialtyLabel: 'pulmonologist',
  },
];

const CONDITIONS_REQUIRING_MED = [
  'diabetes',
  'hypertension',
  'high blood pressure',
  'hypothyroidism',
];

// ── Public API ────────────────────────────────────────────────────────────

export interface RunDataQualityCheckParams {
  profileId: string;
  householdId: string;
  profileFacts: ProfileFact[];
  medications: Medication[];
  results?: ResultItem[];
  labObservations?: ResultLabObservation[];
  preventiveItems?: PreventiveItem[];
}

export function runDataQualityCheck(params: RunDataQualityCheckParams): DataQualityReport {
  const staleItems: StaleItem[] = [];
  const inconsistencies: DataInconsistency[] = [];

  for (const item of evaluateMedicationStaleness(params.medications)) staleItems.push(item);
  for (const item of evaluateProfileFactStaleness(params.profileFacts)) staleItems.push(item);
  for (const item of evaluateLabRecency(params.labObservations ?? [])) staleItems.push(item);

  for (const i of detectMedWithoutCondition(params.medications, params.profileFacts)) {
    inconsistencies.push(i);
  }
  for (const i of detectConditionWithoutProvider(params.profileFacts)) {
    inconsistencies.push(i);
  }
  for (const i of detectConditionWithoutMed(params.profileFacts, params.medications)) {
    inconsistencies.push(i);
  }
  for (const i of detectDuplicateEntries(params.profileFacts)) {
    inconsistencies.push(i);
  }
  for (const i of detectInsuranceLikelyExpired(params.profileFacts)) {
    inconsistencies.push(i);
  }
  for (const i of detectStaleEmergencyContact(params.profileFacts)) {
    inconsistencies.push(i);
  }

  staleItems.sort((a, b) => stalenessRank(b.staleness) - stalenessRank(a.staleness));

  const score = computeHealthScore(staleItems, inconsistencies);

  return {
    staleItems,
    inconsistencies,
    overallHealthScore: score,
    healthTier: tierFromScore(score),
    lastCheckedAt: new Date().toISOString(),
  };
}

// ── Stale evaluators ──────────────────────────────────────────────────────

function evaluateMedicationStaleness(meds: Medication[]): StaleItem[] {
  const out: StaleItem[] = [];
  for (const med of meds) {
    if (med.deleted_at) continue;
    if (med.status !== 'active') continue;
    const days = daysSince(med.updated_at);
    const level = classifyStaleness(days, THRESHOLDS.medications);
    if (level === 'fresh') continue;
    out.push({
      id: `stale:med:${med.id}`,
      sourceType: 'med_medications',
      sourceId: med.id,
      label: medicationLabel(med),
      category: 'medications',
      lastUpdated: med.updated_at,
      daysSinceUpdate: days,
      staleness: level,
      suggestion: suggestionFor('medications', level),
    });
  }
  return out;
}

function evaluateProfileFactStaleness(facts: ProfileFact[]): StaleItem[] {
  const out: StaleItem[] = [];
  for (const fact of facts) {
    if (fact.deleted_at) continue;
    const category = mapFactCategory(fact.category);
    if (!category) continue;
    const lastConfirmed = lastVerifiedAt(fact);
    const days = daysSince(lastConfirmed);

    if (category === 'allergies') {
      // Allergies are never truly "stale", but unverified allergies > 365 days
      // get a single "aging" flag so they show up in the data quality screen.
      if (fact.verification_status === 'verified') continue;
      if (days < 365) continue;
      out.push({
        id: `stale:fact:${fact.id}`,
        sourceType: 'profile_facts',
        sourceId: fact.id,
        label: profileFactLabel(fact),
        category: 'allergies',
        lastUpdated: lastConfirmed,
        daysSinceUpdate: days,
        staleness: 'aging',
        suggestion: 'Confirm this allergy is still accurate',
      });
      continue;
    }

    const thresholds = THRESHOLDS[category];
    if (!thresholds) continue;
    const level = classifyStaleness(days, thresholds);
    if (level === 'fresh') continue;
    out.push({
      id: `stale:fact:${fact.id}`,
      sourceType: 'profile_facts',
      sourceId: fact.id,
      label: profileFactLabel(fact),
      category,
      lastUpdated: lastConfirmed,
      daysSinceUpdate: days,
      staleness: level,
      suggestion: suggestionFor(category, level),
    });
  }
  return out;
}

function evaluateLabRecency(obs: ResultLabObservation[]): StaleItem[] {
  // Lab results are point-in-time, but if the most recent draw of a key
  // analyte (A1c, lipids) is > 365 days old, surface a different message.
  const latestByAnalyte = new Map<string, ResultLabObservation>();
  for (const o of obs) {
    const name = (o.analyte_name ?? '').toLowerCase().trim();
    if (!name) continue;
    const existing = latestByAnalyte.get(name);
    const dateA = o.observed_at ? new Date(o.observed_at).getTime() : 0;
    const dateB = existing?.observed_at ? new Date(existing.observed_at).getTime() : 0;
    if (!existing || dateA > dateB) latestByAnalyte.set(name, o);
  }

  const out: StaleItem[] = [];
  for (const [name, latest] of latestByAnalyte) {
    if (!KEY_LAB_ANALYTES.some((k) => name.includes(k))) continue;
    const refDate = latest.observed_at;
    const days = daysSince(refDate);
    if (!Number.isFinite(days) || days < 365) continue;
    out.push({
      id: `stale:lab:${latest.id}`,
      sourceType: 'result_items',
      sourceId: latest.result_id,
      label: latest.analyte_name,
      category: 'lab_recency',
      lastUpdated: refDate ?? latest.observed_at ?? '',
      daysSinceUpdate: days,
      staleness: days > 730 ? 'very_stale' : 'stale',
      suggestion: `Your last ${latest.analyte_name} was over a year ago`,
    });
  }
  return out;
}

function mapFactCategory(category: ProfileFact['category']): Exclude<DataQualityCategory, 'lab_recency' | 'other'> | null {
  switch (category) {
    case 'condition':
      return 'conditions';
    case 'allergy':
      return 'allergies';
    case 'insurance':
      return 'insurance';
    case 'care_team':
      return 'care_team';
    case 'emergency_contact':
      return 'emergency_contact';
    default:
      return null;
  }
}

// ── Inconsistency detectors ───────────────────────────────────────────────

function detectMedWithoutCondition(
  meds: Medication[],
  facts: ProfileFact[],
): DataInconsistency[] {
  const conditions = facts.filter((f) => f.category === 'condition' && !f.deleted_at);
  const conditionNames = new Set(
    conditions.map((c) => normalizeName(profileFactLabel(c))),
  );

  const seen = new Set<string>();
  const out: DataInconsistency[] = [];
  for (const med of meds) {
    if (med.deleted_at || med.status !== 'active') continue;
    const implied = inferConditionFromMedication(med.drug_name);
    if (!implied) continue;
    const impliedKey = normalizeName(implied);
    if (seen.has(`${med.id}:${impliedKey}`)) continue;

    const hasMatch = [...conditionNames].some(
      (cn) => cn.includes(impliedKey) || impliedKey.includes(cn),
    );
    if (hasMatch) continue;

    seen.add(`${med.id}:${impliedKey}`);
    out.push({
      id: `inc:med-no-cond:${med.id}`,
      type: 'med_without_condition',
      severity: 'info',
      title: `${medicationLabel(med)} usually treats ${implied}`,
      detail: `You're taking ${medicationLabel(med)} but ${implied} isn't listed in your conditions.`,
      suggestion: `Add ${implied} as a condition if it applies to you.`,
      relatedItems: [
        {
          sourceType: 'med_medications',
          sourceId: med.id,
          label: medicationLabel(med),
        },
      ],
    });
  }
  return out;
}

function detectConditionWithoutProvider(facts: ProfileFact[]): DataInconsistency[] {
  const conditions = facts.filter((f) => f.category === 'condition' && !f.deleted_at);
  const careTeam = facts.filter((f) => f.category === 'care_team' && !f.deleted_at);

  const specialties = careTeam
    .map((f) => {
      const v = unwrapValue(f.value_json);
      return (strField(v, 'specialty') ?? '').toLowerCase();
    })
    .filter((s) => s.length > 0);

  const out: DataInconsistency[] = [];
  for (const cond of conditions) {
    const condNameRaw = profileFactLabel(cond).toLowerCase();
    for (const rule of CONDITION_SPECIALIST_RULES) {
      if (!rule.conditionPatterns.some((p) => condNameRaw.includes(p))) continue;
      const hasSpecialist = specialties.some((s) =>
        rule.specialtyPatterns.some((p) => s.includes(p)),
      );
      if (hasSpecialist) continue;
      out.push({
        id: `inc:cond-no-prov:${cond.id}:${rule.specialtyLabel}`,
        type: 'condition_without_provider',
        severity: 'info',
        title: `No ${rule.specialtyLabel} on your care team`,
        detail: `You have ${profileFactLabel(cond)} listed but no ${rule.specialtyLabel} in your care team.`,
        suggestion: `Add a ${rule.specialtyLabel} so visit prep and outreach include them.`,
        relatedItems: [
          {
            sourceType: 'profile_facts',
            sourceId: cond.id,
            label: profileFactLabel(cond),
          },
        ],
      });
      break;
    }
  }
  return out;
}

function detectConditionWithoutMed(
  facts: ProfileFact[],
  meds: Medication[],
): DataInconsistency[] {
  const conditions = facts.filter((f) => f.category === 'condition' && !f.deleted_at);
  const activeMeds = meds.filter((m) => !m.deleted_at && m.status === 'active');
  const impliedFromMeds = new Set(
    activeMeds
      .map((m) => inferConditionFromMedication(m.drug_name))
      .filter((c): c is string => !!c)
      .map((c) => normalizeName(c)),
  );

  const out: DataInconsistency[] = [];
  for (const cond of conditions) {
    const condName = profileFactLabel(cond).toLowerCase();
    if (!CONDITIONS_REQUIRING_MED.some((c) => condName.includes(c))) continue;
    const condKey = normalizeName(profileFactLabel(cond));
    const hasMed = [...impliedFromMeds].some(
      (m) => m.includes(condKey) || condKey.includes(m),
    );
    if (hasMed) continue;
    out.push({
      id: `inc:cond-no-med:${cond.id}`,
      type: 'condition_without_med',
      severity: 'warning',
      title: `No medications listed for ${profileFactLabel(cond)}`,
      detail: `You have ${profileFactLabel(cond)} listed but no medications for it. Is this correct?`,
      suggestion: `Add the medication you take, or confirm it's managed without one.`,
      relatedItems: [
        {
          sourceType: 'profile_facts',
          sourceId: cond.id,
          label: profileFactLabel(cond),
        },
      ],
    });
  }
  return out;
}

function detectDuplicateEntries(facts: ProfileFact[]): DataInconsistency[] {
  const buckets = new Map<string, ProfileFact[]>();
  for (const fact of facts) {
    if (fact.deleted_at) continue;
    if (
      fact.category !== 'condition' &&
      fact.category !== 'allergy' &&
      fact.category !== 'care_team' &&
      fact.category !== 'insurance' &&
      fact.category !== 'pharmacy' &&
      fact.category !== 'emergency_contact'
    ) {
      continue;
    }
    const key = `${fact.category}::${normalizeName(profileFactLabel(fact))}`;
    if (!key.endsWith('::')) {
      const list = buckets.get(key) ?? [];
      list.push(fact);
      buckets.set(key, list);
    }
  }

  const out: DataInconsistency[] = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const label = profileFactLabel(list[0]);
    out.push({
      id: `inc:dup:${key}`,
      type: 'duplicate_entries',
      severity: 'info',
      title: `Possible duplicate: ${label}`,
      detail: `You may have duplicate entries for ${label} in your ${list[0].category.replace('_', ' ')}.`,
      suggestion: 'Review and merge or remove duplicates.',
      relatedItems: list.map((f) => ({
        sourceType: 'profile_facts' as const,
        sourceId: f.id,
        label: profileFactLabel(f),
      })),
    });
  }
  return out;
}

function detectInsuranceLikelyExpired(facts: ProfileFact[]): DataInconsistency[] {
  const insurance = facts.filter((f) => f.category === 'insurance' && !f.deleted_at);
  const out: DataInconsistency[] = [];
  for (const ins of insurance) {
    const lastConfirmed = lastVerifiedAt(ins);
    const days = daysSince(lastConfirmed);
    if (days < 13 * 30) continue;
    out.push({
      id: `inc:ins-expired:${ins.id}`,
      type: 'insurance_expired',
      severity: 'info',
      title: `Insurance info is over a year old`,
      detail: `${profileFactLabel(ins)} hasn't been updated in ${Math.floor(days / 30)} months. Plans often change annually.`,
      suggestion: 'Confirm or update your insurance info if anything changed.',
      relatedItems: [
        {
          sourceType: 'profile_facts',
          sourceId: ins.id,
          label: profileFactLabel(ins),
        },
      ],
    });
  }
  return out;
}

function detectStaleEmergencyContact(facts: ProfileFact[]): DataInconsistency[] {
  const contacts = facts.filter((f) => f.category === 'emergency_contact' && !f.deleted_at);
  const out: DataInconsistency[] = [];
  for (const c of contacts) {
    const lastConfirmed = lastVerifiedAt(c);
    const days = daysSince(lastConfirmed);
    if (days < 730) continue;
    out.push({
      id: `inc:ec-stale:${c.id}`,
      type: 'stale_emergency_contact',
      severity: 'info',
      title: `Emergency contact hasn't been verified in 2+ years`,
      detail: `${profileFactLabel(c)} hasn't been confirmed since ${describeAge(days).toLowerCase()}.`,
      suggestion: 'Confirm the phone number is still correct.',
      relatedItems: [
        {
          sourceType: 'profile_facts',
          sourceId: c.id,
          label: profileFactLabel(c),
        },
      ],
    });
  }
  return out;
}

// ── Score & tier ──────────────────────────────────────────────────────────

function stalenessRank(level: StalenessLevel): number {
  switch (level) {
    case 'very_stale':
      return 3;
    case 'stale':
      return 2;
    case 'aging':
      return 1;
    default:
      return 0;
  }
}

function computeHealthScore(stale: StaleItem[], inc: DataInconsistency[]): number {
  let score = 100;
  for (const s of stale) {
    if (s.staleness === 'very_stale') score -= 8;
    else if (s.staleness === 'stale') score -= 5;
    else if (s.staleness === 'aging') score -= 2;
  }
  for (const i of inc) {
    score -= i.severity === 'warning' ? 6 : 3;
  }
  return Math.max(0, Math.min(100, score));
}

function tierFromScore(score: number): DataQualityHealthTier {
  if (score >= 85) return 'good';
  if (score >= 65) return 'fair';
  return 'needs_attention';
}

// ── Public helpers consumed by UI ─────────────────────────────────────────

export function describeStaleAge(daysSinceUpdate: number): string {
  return describeAge(daysSinceUpdate);
}

export function healthTierLabel(tier: DataQualityHealthTier): string {
  switch (tier) {
    case 'good':
      return 'Your profile data looks current';
    case 'fair':
      return 'Some items may need updating';
    case 'needs_attention':
      return 'Several items are outdated';
  }
}
