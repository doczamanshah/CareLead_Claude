/**
 * Cross-document profile enrichment.
 *
 * After any extraction (billing, result, generic document), this service
 * scans the structured output for facts the user might want on their profile
 * but that the document's primary domain wouldn't capture on its own — e.g.,
 * a billing extraction mentioning a cardiologist by name, or a lab report
 * naming the ordering clinician.
 *
 * The detector is intentionally conservative:
 *  • It only proposes categories that are valid in the `profile_facts` CHECK
 *    constraint (no `facility` — those route to `care_team` instead).
 *  • It dedupes against the user's existing profile facts using a normalized
 *    identifier (lowercased, stripped of titles like "Dr." / "MD" / "PhD").
 *  • It only suggests a condition from a result when the lab value is well
 *    above the diagnostic threshold AND the condition is absent — to avoid
 *    nudging users toward self-diagnosis on borderline values.
 */

import type { ProfileFact } from '@/lib/types/profile';
import {
  ENRICHMENT_MAX_PER_SOURCE,
  ENRICHMENT_MIN_CONFIDENCE,
  type EnrichmentCategory,
  type EnrichmentSourceType,
  type ProfileEnrichmentSuggestion,
} from '@/lib/types/enrichment';

// ── Normalization ─────────────────────────────────────────────────────────

const TITLE_TOKENS = new Set([
  'dr',
  'dr.',
  'md',
  'm.d.',
  'do',
  'd.o.',
  'phd',
  'ph.d.',
  'np',
  'n.p.',
  'pa',
  'p.a.',
  'rn',
  'r.n.',
  'mph',
  'msn',
  'fnp',
  'dnp',
]);

/**
 * Lowercase, strip punctuation, drop credential/title tokens, collapse
 * whitespace. "Dr. Michael Chen, MD" and "Michael Chen MD" and "Dr Chen"
 * normalize to substrings that match each other reliably.
 */
function normalizePersonName(raw: string): string {
  if (!raw) return '';
  const cleaned = raw
    .toLowerCase()
    .replace(/[,.()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = cleaned.split(' ').filter((t) => t && !TITLE_TOKENS.has(t));
  return tokens.join(' ').trim();
}

function normalizeText(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Deterministic ID so the same suggestion across renders gets the same id. */
function suggestionId(
  source: string,
  category: EnrichmentCategory,
  identifier: string,
): string {
  return `${source}:${category}:${identifier.toLowerCase().replace(/\s+/g, '_')}`;
}

// ── Duplicate detection ───────────────────────────────────────────────────

/**
 * Returns true when an existing profile fact already covers this proposed
 * value. Names are matched after normalization (titles/credentials stripped);
 * insurance is matched on (payer + member_id) when both are present, payer
 * alone otherwise; conditions on condition_name; medications on drug_name.
 */
function isDuplicate(
  category: EnrichmentCategory,
  proposed: Record<string, unknown>,
  existing: ProfileFact[],
): boolean {
  const sameCategory = existing.filter((f) => f.category === category);
  if (sameCategory.length === 0) return false;

  switch (category) {
    case 'care_team': {
      const name = normalizePersonName(String(proposed.name ?? ''));
      if (!name) return false;
      return sameCategory.some((f) => {
        const existingName = normalizePersonName(
          String(f.value_json?.name ?? ''),
        );
        if (!existingName) return false;
        return existingName === name || existingName.includes(name) || name.includes(existingName);
      });
    }
    case 'insurance': {
      const payer = normalizeText(String(proposed.payer_name ?? proposed.plan_name ?? ''));
      const memberId = String(proposed.member_id ?? '').trim();
      if (!payer && !memberId) return false;
      return sameCategory.some((f) => {
        const v = (f.value_json ?? {}) as Record<string, unknown>;
        const existingPayer = normalizeText(
          String(v.payer_name ?? v.plan_name ?? v.provider ?? ''),
        );
        const existingMember = String(v.member_id ?? '').trim();
        if (memberId && existingMember && memberId === existingMember) return true;
        if (payer && existingPayer && payer === existingPayer) return true;
        return false;
      });
    }
    case 'condition': {
      const name = normalizeText(String(proposed.condition_name ?? proposed.name ?? ''));
      if (!name) return false;
      return sameCategory.some((f) => {
        const v = (f.value_json ?? {}) as Record<string, unknown>;
        const existingName = normalizeText(
          String(v.condition_name ?? v.name ?? ''),
        );
        return !!existingName && (existingName === name || existingName.includes(name));
      });
    }
    case 'allergy': {
      const subst = normalizeText(String(proposed.substance ?? ''));
      if (!subst) return false;
      return sameCategory.some((f) => {
        const existing = normalizeText(String(f.value_json?.substance ?? ''));
        return existing === subst;
      });
    }
    case 'medication': {
      const drug = normalizeText(String(proposed.drug_name ?? proposed.name ?? ''));
      if (!drug) return false;
      return sameCategory.some((f) => {
        const v = (f.value_json ?? {}) as Record<string, unknown>;
        const existingDrug = normalizeText(String(v.drug_name ?? v.name ?? ''));
        return existingDrug === drug;
      });
    }
    case 'pharmacy': {
      const name = normalizeText(String(proposed.name ?? ''));
      if (!name) return false;
      return sameCategory.some((f) => {
        const existing = normalizeText(String(f.value_json?.name ?? ''));
        return existing === name;
      });
    }
  }
}

// ── Detectors per source type ─────────────────────────────────────────────

interface DetectInput {
  sourceId: string;
  sourceLabel: string;
  extraction: Record<string, unknown>;
  existingFacts: ProfileFact[];
}

function pushIfNew(
  out: ProfileEnrichmentSuggestion[],
  seen: Set<string>,
  candidate: ProfileEnrichmentSuggestion,
) {
  if (seen.has(candidate.id)) return;
  if (candidate.confidence < ENRICHMENT_MIN_CONFIDENCE) return;
  if (candidate.isDuplicate) return;
  seen.add(candidate.id);
  out.push(candidate);
}

function detectFromBilling({
  sourceId,
  sourceLabel,
  extraction,
  existingFacts,
}: DetectInput): ProfileEnrichmentSuggestion[] {
  const suggestions: ProfileEnrichmentSuggestion[] = [];
  const seen = new Set<string>();

  // 1. Provider → care team
  const providerName = (extraction.provider_name as string | null)?.trim();
  if (providerName) {
    const value = { name: providerName, specialty: null, source: 'billing' };
    const dup = isDuplicate('care_team', value, existingFacts);
    pushIfNew(suggestions, seen, {
      id: suggestionId(sourceId, 'care_team', normalizePersonName(providerName)),
      category: 'care_team',
      factKey: 'care_team.name',
      displayTitle: `Add ${providerName} to your care team`,
      displayDetail: `Found in ${sourceLabel}`,
      valueJson: value,
      confidence: 0.85,
      source: sourceId,
      sourceLabel,
      isDuplicate: dup,
    });
  }

  // 2. Payer (+ member id / group / plan) → insurance
  const payerName = (extraction.payer_name as string | null)?.trim();
  const memberId = (extraction.member_id as string | null)?.trim();
  const groupNumber = (extraction.group_number as string | null)?.trim();
  const planName = (extraction.plan_name as string | null)?.trim();
  if (payerName || memberId || planName) {
    const value: Record<string, unknown> = {
      payer_name: payerName ?? null,
      member_id: memberId ?? null,
      group_number: groupNumber ?? null,
      plan_name: planName ?? null,
      source: 'billing',
    };
    const identifier = payerName || memberId || planName || 'insurance';
    const dup = isDuplicate('insurance', value, existingFacts);
    // Insurance specificity raises confidence: payer + member id is near-certain.
    const confidence = payerName && memberId ? 0.9 : payerName ? 0.75 : 0.6;
    pushIfNew(suggestions, seen, {
      id: suggestionId(sourceId, 'insurance', identifier),
      category: 'insurance',
      factKey: 'insurance.payer',
      displayTitle: payerName
        ? `Update insurance: ${payerName}`
        : 'Update your insurance details',
      displayDetail: `Found in ${sourceLabel}`,
      valueJson: value,
      confidence,
      source: sourceId,
      sourceLabel,
      isDuplicate: dup,
    });
  }

  // 3. Denial reason mentioning a condition → condition (cautious)
  const denialInfo = extraction.denial_info as
    | { reason?: string | null }
    | null
    | undefined;
  const denialReason = denialInfo?.reason?.trim();
  if (denialReason) {
    const matched = matchConditionInText(denialReason);
    if (matched) {
      const value = {
        condition_name: matched,
        status: 'active',
        source: 'billing',
      };
      const dup = isDuplicate('condition', value, existingFacts);
      pushIfNew(suggestions, seen, {
        id: suggestionId(sourceId, 'condition', matched),
        category: 'condition',
        factKey: 'condition.name',
        displayTitle: `Add ${matched} to your conditions`,
        displayDetail: `Mentioned in a denial on ${sourceLabel}`,
        valueJson: value,
        confidence: 0.55,
        source: sourceId,
        sourceLabel,
        isDuplicate: dup,
      });
    }
  }

  return suggestions.slice(0, ENRICHMENT_MAX_PER_SOURCE);
}

function detectFromResult({
  sourceId,
  sourceLabel,
  extraction,
  existingFacts,
}: DetectInput): ProfileEnrichmentSuggestion[] {
  const suggestions: ProfileEnrichmentSuggestion[] = [];
  const seen = new Set<string>();

  // 1. Ordering clinician → care team
  const ordering = (extraction.ordering_clinician as string | null)?.trim();
  if (ordering) {
    const value = {
      name: ordering,
      specialty: inferSpecialtyFromTestName(extraction.suggested_test_name as string | null),
      source: 'result',
    };
    const dup = isDuplicate('care_team', value, existingFacts);
    pushIfNew(suggestions, seen, {
      id: suggestionId(sourceId, 'care_team', normalizePersonName(ordering)),
      category: 'care_team',
      factKey: 'care_team.name',
      displayTitle: `Add ${ordering} to your care team`,
      displayDetail: `Ordered your test in ${sourceLabel}`,
      valueJson: value,
      confidence: 0.8,
      source: sourceId,
      sourceLabel,
      isDuplicate: dup,
    });
  }

  // 2. Radiologist (imaging) → care team with Radiology specialty
  const radiologist = (extraction.radiologist as string | null)?.trim();
  if (radiologist) {
    const value = { name: radiologist, specialty: 'Radiology', source: 'result' };
    const dup = isDuplicate('care_team', value, existingFacts);
    pushIfNew(suggestions, seen, {
      id: suggestionId(sourceId, 'care_team', normalizePersonName(radiologist)),
      category: 'care_team',
      factKey: 'care_team.name',
      displayTitle: `Add ${radiologist} (Radiology) to your care team`,
      displayDetail: `Read your imaging in ${sourceLabel}`,
      valueJson: value,
      confidence: 0.75,
      source: sourceId,
      sourceLabel,
      isDuplicate: dup,
    });
  }

  // 3. Reporting clinician (other-type tests) → care team
  const reporting = (extraction.reporting_clinician as string | null)?.trim();
  if (reporting && reporting !== ordering) {
    const value = { name: reporting, specialty: null, source: 'result' };
    const dup = isDuplicate('care_team', value, existingFacts);
    pushIfNew(suggestions, seen, {
      id: suggestionId(sourceId, 'care_team', normalizePersonName(reporting)),
      category: 'care_team',
      factKey: 'care_team.name',
      displayTitle: `Add ${reporting} to your care team`,
      displayDetail: `Reported your result in ${sourceLabel}`,
      valueJson: value,
      confidence: 0.7,
      source: sourceId,
      sourceLabel,
      isDuplicate: dup,
    });
  }

  // 4. Test-implied conditions — narrowly scoped to clearly diagnostic values.
  //    Only fires when a numeric analyte exceeds the diagnostic threshold
  //    AND the condition is absent from the profile.
  const inferred = inferConditionsFromAnalytes(extraction);
  for (const cond of inferred) {
    const value = {
      condition_name: cond.name,
      status: 'suspected',
      source: 'result',
      basis: cond.basis,
    };
    const dup = isDuplicate('condition', value, existingFacts);
    pushIfNew(suggestions, seen, {
      id: suggestionId(sourceId, 'condition', cond.name),
      category: 'condition',
      factKey: 'condition.name',
      displayTitle: `Consider adding ${cond.name} to your conditions`,
      displayDetail: `${cond.basis} in ${sourceLabel}`,
      valueJson: value,
      confidence: cond.confidence,
      source: sourceId,
      sourceLabel,
      isDuplicate: dup,
    });
  }

  return suggestions.slice(0, ENRICHMENT_MAX_PER_SOURCE);
}

function detectFromGenericDocument({
  sourceId,
  sourceLabel,
  extraction,
  existingFacts,
}: DetectInput): ProfileEnrichmentSuggestion[] {
  const suggestions: ProfileEnrichmentSuggestion[] = [];
  const seen = new Set<string>();

  // Generic document extractions (extract-document Edge Function) emit
  // `extracted_fields` keyed by category. We accept either a flat list of
  // {field_key, value} or pre-grouped buckets — both shapes appear depending
  // on caller. We read whichever is present.

  const fields = Array.isArray(extraction.extracted_fields)
    ? (extraction.extracted_fields as Array<{
        field_key?: string;
        value_json?: Record<string, unknown>;
        confidence?: number;
      }>)
    : [];

  for (const f of fields) {
    if (!f.field_key || !f.value_json) continue;
    const conf = typeof f.confidence === 'number' ? f.confidence : 0.7;
    const v = f.value_json;

    // medication.entry → medication suggestion
    if (f.field_key.startsWith('medication')) {
      const drug = String(v.drug_name ?? v.name ?? '').trim();
      if (!drug) continue;
      const dup = isDuplicate('medication', v, existingFacts);
      pushIfNew(suggestions, seen, {
        id: suggestionId(sourceId, 'medication', drug),
        category: 'medication',
        factKey: 'medication.name',
        displayTitle: `Add ${drug} to your medications`,
        displayDetail: `Found in ${sourceLabel}`,
        valueJson: v,
        confidence: conf,
        source: sourceId,
        sourceLabel,
        isDuplicate: dup,
      });
    } else if (f.field_key.startsWith('allergy')) {
      const subst = String(v.substance ?? '').trim();
      if (!subst) continue;
      const dup = isDuplicate('allergy', v, existingFacts);
      pushIfNew(suggestions, seen, {
        id: suggestionId(sourceId, 'allergy', subst),
        category: 'allergy',
        factKey: 'allergy.substance',
        displayTitle: `Add ${subst} as an allergy`,
        displayDetail: `Found in ${sourceLabel}`,
        valueJson: v,
        confidence: conf,
        source: sourceId,
        sourceLabel,
        isDuplicate: dup,
      });
    } else if (f.field_key.startsWith('condition')) {
      const name = String(v.condition_name ?? v.name ?? '').trim();
      if (!name) continue;
      const dup = isDuplicate('condition', v, existingFacts);
      pushIfNew(suggestions, seen, {
        id: suggestionId(sourceId, 'condition', name),
        category: 'condition',
        factKey: 'condition.name',
        displayTitle: `Add ${name} to your conditions`,
        displayDetail: `Found in ${sourceLabel}`,
        valueJson: v,
        confidence: conf,
        source: sourceId,
        sourceLabel,
        isDuplicate: dup,
      });
    } else if (f.field_key.startsWith('insurance')) {
      const payer = String(v.payer_name ?? v.plan_name ?? '').trim();
      const dup = isDuplicate('insurance', v, existingFacts);
      pushIfNew(suggestions, seen, {
        id: suggestionId(sourceId, 'insurance', payer || 'insurance'),
        category: 'insurance',
        factKey: 'insurance.payer',
        displayTitle: payer ? `Update insurance: ${payer}` : 'Update insurance details',
        displayDetail: `Found in ${sourceLabel}`,
        valueJson: v,
        confidence: conf,
        source: sourceId,
        sourceLabel,
        isDuplicate: dup,
      });
    } else if (f.field_key.startsWith('care_team')) {
      const name = String(v.name ?? '').trim();
      if (!name) continue;
      const dup = isDuplicate('care_team', v, existingFacts);
      pushIfNew(suggestions, seen, {
        id: suggestionId(sourceId, 'care_team', normalizePersonName(name)),
        category: 'care_team',
        factKey: 'care_team.name',
        displayTitle: `Add ${name} to your care team`,
        displayDetail: `Found in ${sourceLabel}`,
        valueJson: v,
        confidence: conf,
        source: sourceId,
        sourceLabel,
        isDuplicate: dup,
      });
    } else if (f.field_key.startsWith('pharmacy')) {
      const name = String(v.name ?? '').trim();
      if (!name) continue;
      const dup = isDuplicate('pharmacy', v, existingFacts);
      pushIfNew(suggestions, seen, {
        id: suggestionId(sourceId, 'pharmacy', name),
        category: 'pharmacy',
        factKey: 'pharmacy.name',
        displayTitle: `Add ${name} as your pharmacy`,
        displayDetail: `Found in ${sourceLabel}`,
        valueJson: v,
        confidence: conf,
        source: sourceId,
        sourceLabel,
        isDuplicate: dup,
      });
    }
  }

  return suggestions.slice(0, ENRICHMENT_MAX_PER_SOURCE);
}

// ── Heuristics ────────────────────────────────────────────────────────────

const CONDITION_KEYWORDS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Type 2 Diabetes', pattern: /\b(type[- ]?2 diabetes|t2dm|diabetes mellitus type 2)\b/i },
  { name: 'Diabetes', pattern: /\bdiabetes\b/i },
  { name: 'Hypertension', pattern: /\b(hypertension|high blood pressure)\b/i },
  { name: 'Hyperlipidemia', pattern: /\b(hyperlipidemia|high cholesterol)\b/i },
  { name: 'Asthma', pattern: /\basthma\b/i },
  { name: 'Hypothyroidism', pattern: /\bhypothyroidism\b/i },
  { name: 'COPD', pattern: /\bcopd\b/i },
];

function matchConditionInText(text: string): string | null {
  for (const c of CONDITION_KEYWORDS) {
    if (c.pattern.test(text)) return c.name;
  }
  return null;
}

/**
 * Look at the test name's domain to suggest a likely specialty for the
 * ordering clinician. Conservative — returns null when ambiguous so we don't
 * mislabel (e.g., a CMP could be ordered by anyone).
 */
function inferSpecialtyFromTestName(testName: string | null): string | null {
  if (!testName) return null;
  const t = testName.toLowerCase();
  if (/\b(echo|ekg|stress test|cardiac|troponin)\b/.test(t)) return 'Cardiology';
  if (/\b(tsh|t3|t4|thyroid)\b/.test(t)) return 'Endocrinology';
  if (/\b(psa|prostate)\b/.test(t)) return 'Urology';
  if (/\b(mammogram|pap|hpv)\b/.test(t)) return 'Gynecology';
  if (/\b(colonoscopy|liver function|hepatic)\b/.test(t)) return 'Gastroenterology';
  if (/\b(mri brain|ct head|eeg)\b/.test(t)) return 'Neurology';
  return null;
}

/**
 * Inspect a lab extraction's analytes for clearly diagnostic values that
 * imply a condition. Thresholds are deliberately set above the diagnostic
 * cutoff so borderline results don't get suggested.
 */
function inferConditionsFromAnalytes(
  extraction: Record<string, unknown>,
): Array<{ name: string; basis: string; confidence: number }> {
  const analytes = extraction.analytes as Array<{
    name?: string;
    numeric_value?: number | null;
    unit?: string | null;
  }> | undefined;
  if (!Array.isArray(analytes)) return [];

  const out: Array<{ name: string; basis: string; confidence: number }> = [];
  for (const a of analytes) {
    if (!a?.name || typeof a.numeric_value !== 'number') continue;
    const name = a.name.toLowerCase();

    // A1c >= 6.5% is the diagnostic threshold for diabetes.
    if (/\b(hemoglobin\s*a1c|hba1c|a1c)\b/.test(name) && a.numeric_value >= 6.5) {
      out.push({
        name: 'Type 2 Diabetes',
        basis: `A1c ${a.numeric_value}${a.unit ?? '%'}`,
        confidence: 0.6,
      });
    }
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────

export interface DetectProfileEnrichmentParams {
  profileId: string;
  householdId: string;
  extractionResult: Record<string, unknown> | null | undefined;
  sourceType: EnrichmentSourceType;
  sourceId: string;
  sourceLabel: string;
  existingProfileFacts: ProfileFact[];
}

/**
 * Inspect an extraction result for profile-relevant facts the user might
 * want to add. Returns at most ENRICHMENT_MAX_PER_SOURCE non-duplicate
 * suggestions above the confidence threshold. Pure function — no I/O.
 */
export function detectProfileEnrichment(
  params: DetectProfileEnrichmentParams,
): ProfileEnrichmentSuggestion[] {
  const { extractionResult, sourceType, sourceId, sourceLabel, existingProfileFacts } = params;
  if (!extractionResult || typeof extractionResult !== 'object') return [];

  const input: DetectInput = {
    sourceId,
    sourceLabel,
    extraction: extractionResult,
    existingFacts: existingProfileFacts,
  };

  switch (sourceType) {
    case 'billing':
      return detectFromBilling(input);
    case 'result':
      return detectFromResult(input);
    case 'document':
      return detectFromGenericDocument(input);
  }
}
