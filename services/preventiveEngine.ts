/**
 * Preventive Care Eligibility Engine
 *
 * Pure, deterministic evaluation of preventive_rules against a patient's
 * demographics and conditions. No AI/LLM calls — just rule evaluation.
 *
 * The engine is intentionally explainable: for every proposed upsert it
 * produces a human-readable rationale and, when data is missing, a list
 * of prompts that would unlock a better recommendation.
 */

import type {
  PreventiveRule,
  PreventiveItem,
  PreventiveStatus,
  PreventiveMissingDataEntry,
  EligibilityCriteria,
  ScreeningMethod,
  SeasonalWindow,
} from '@/lib/types/preventive';
import { matchesCondition } from '@/lib/utils/conditionMatcher';

export interface EligibilityProfileFacts {
  dateOfBirth: string | null;
  sex: string | null;
  conditions: string[];
}

export interface PreventiveItemUpsert {
  ruleId: string;
  ruleCode: string;
  title: string;
  status: PreventiveStatus;
  dueDate: string | null;
  nextDueDate: string | null;
  rationale: string;
  missingData: PreventiveMissingDataEntry[];
  hedisMeasureCode: string | null;
  selectedMethod: string | null;
}

export interface EligibilityScanResult {
  itemsToUpsert: PreventiveItemUpsert[];
  itemsUnchanged: string[];
  skippedRules: { ruleId: string; reason: string }[];
}

export interface RunEligibilityScanParams {
  profileId: string;
  householdId: string;
  profileFacts: EligibilityProfileFacts;
  rules: PreventiveRule[];
  existingItems: PreventiveItem[];
  /** Override "now" for testing / deterministic runs. Defaults to new Date(). */
  now?: Date;
}

const DUE_SOON_WINDOW_DAYS = 60;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const iso = value.length === 10 ? `${value}T00:00:00` : value;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function calculateAge(dob: Date, today: Date): number {
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

function normalizeSex(value: string | null): 'male' | 'female' | null {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  if (v === 'm' || v === 'male' || v === 'man') return 'male';
  if (v === 'f' || v === 'female' || v === 'woman') return 'female';
  return null;
}

function humanizeInterval(fromDate: Date, toDate: Date): string {
  const ms = Math.abs(toDate.getTime() - fromDate.getTime());
  const days = Math.round(ms / MS_PER_DAY);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  const months = Math.round(days / 30);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? '' : 's'}`;
}

function formatHumanDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function eligibilityAudience(criteria: EligibilityCriteria): string {
  const sexWord =
    criteria.sex === 'female' ? 'women' : criteria.sex === 'male' ? 'men' : 'adults';
  const { min_age, max_age } = criteria;
  if (min_age !== null && max_age !== null) {
    return `${sexWord} ages ${min_age}-${max_age}`;
  }
  if (min_age !== null) return `${sexWord} ${min_age} and older`;
  if (max_age !== null) return `${sexWord} up to age ${max_age}`;
  return sexWord;
}

function guidelineFootnote(rule: PreventiveRule): string {
  return rule.guideline_version
    ? `Based on ${rule.guideline_source} ${rule.guideline_version}.`
    : `Based on ${rule.guideline_source}.`;
}

/**
 * Resolve which cadence applies, preferring the user's selected method when
 * screening_methods are defined. Returns null when no cadence is known (e.g.
 * user hasn't picked a method yet, or the rule is one-time).
 */
function resolveCadence(
  rule: PreventiveRule,
  selectedMethodId: string | null,
): { cadence: number | null; method: ScreeningMethod | null } {
  const methods = rule.screening_methods ?? null;
  if (methods && methods.length > 0) {
    const picked = selectedMethodId
      ? methods.find((m) => m.method_id === selectedMethodId) ?? null
      : null;
    if (picked) return { cadence: picked.cadence_months, method: picked };
    return { cadence: null, method: null };
  }
  return { cadence: rule.cadence_months, method: null };
}

function isInSeason(today: Date, window: SeasonalWindow): boolean {
  const month = today.getMonth() + 1; // 1-12
  const { start_month, end_month } = window;
  if (start_month <= end_month) {
    return month >= start_month && month <= end_month;
  }
  // Wraparound (e.g., Nov–Feb)
  return month >= start_month || month <= end_month;
}

function nextSeasonStart(today: Date, window: SeasonalWindow): Date {
  const year = today.getFullYear();
  const candidate = new Date(year, window.start_month - 1, 1);
  candidate.setHours(0, 0, 0, 0);
  if (candidate.getTime() >= today.getTime()) return candidate;
  return new Date(year + 1, window.start_month - 1, 1);
}

/**
 * Deterministically evaluate every rule against the profile and return
 * the upsert list. The caller is responsible for persisting the result.
 */
export function runEligibilityScan(
  params: RunEligibilityScanParams,
): EligibilityScanResult {
  const { profileFacts, rules, existingItems } = params;

  const today = params.now ? new Date(params.now) : new Date();
  today.setHours(0, 0, 0, 0);

  const dob = parseDate(profileFacts.dateOfBirth);
  const age = dob ? calculateAge(dob, today) : null;
  const normalizedSex = normalizeSex(profileFacts.sex);
  const lowerConditions = profileFacts.conditions.map((c) => c.toLowerCase());

  const existingByRule = new Map<string, PreventiveItem>();
  for (const item of existingItems) {
    existingByRule.set(item.rule_id, item);
  }

  const itemsToUpsert: PreventiveItemUpsert[] = [];
  const itemsUnchanged: string[] = [];
  const skippedRules: { ruleId: string; reason: string }[] = [];

  for (const rule of rules) {
    if (!rule.is_active) {
      skippedRules.push({ ruleId: rule.id, reason: 'Rule inactive' });
      continue;
    }

    const existing = existingByRule.get(rule.id);
    const criteria = rule.eligibility_criteria;
    const audience = eligibilityAudience(criteria);
    const footnote = guidelineFootnote(rule);
    const hedis = rule.hedis_measure_code ?? null;
    const selectedMethodId = existing?.selected_method ?? null;

    // ── Preserve user choices ─────────────────────────────────────────
    if (existing && (existing.status === 'deferred' || existing.status === 'declined')) {
      itemsUnchanged.push(existing.id);
      continue;
    }

    // ── Condition-triggered rules ─────────────────────────────────────
    // When a rule has condition_triggers we test the patient's condition
    // list. is_condition_dependent decides whether a condition match is
    // required or merely an alternative entry point.
    const triggers = rule.condition_triggers ?? null;
    const conditionHit = triggers ? matchesCondition(profileFacts.conditions, triggers) : false;

    if (rule.is_condition_dependent) {
      if (!conditionHit) {
        skippedRules.push({
          ruleId: rule.id,
          reason: 'Rule requires a matching condition and none is present',
        });
        continue;
      }
    }

    // ── Missing DOB → needs_review ────────────────────────────────────
    if (!dob || age === null) {
      const missingData: PreventiveMissingDataEntry[] = [
        {
          field: 'date_of_birth',
          prompt: 'What is your date of birth? We need this to check which screenings apply to you.',
        },
      ];
      const rationale = `Recommended for ${audience}. ${footnote} To give you a personalized recommendation, we need your date of birth.`;
      upsertNeedsReview(rule, existing, rationale, missingData, hedis, itemsToUpsert);
      continue;
    }

    // ── Age check ─────────────────────────────────────────────────────
    // For is_condition_dependent rules a condition match is sufficient —
    // age bounds still apply when specified, but only as a hard cap.
    // For non-condition-dependent rules, age/sex must match OR a
    // condition trigger must hit.
    const ageOk =
      (criteria.min_age === null || age >= criteria.min_age) &&
      (criteria.max_age === null || age <= criteria.max_age);

    if (!ageOk && !rule.is_condition_dependent && !conditionHit) {
      skippedRules.push({
        ruleId: rule.id,
        reason: `Age ${age} outside ${criteria.min_age ?? '-'}–${criteria.max_age ?? '-'}`,
      });
      continue;
    }

    if (!ageOk && rule.is_condition_dependent) {
      // Condition present but outside the rule's age bounds. Skip to
      // avoid recommending e.g. lung cancer screening at age 45.
      skippedRules.push({
        ruleId: rule.id,
        reason: `Age ${age} outside condition-dependent rule bounds`,
      });
      continue;
    }

    // ── Sex check ─────────────────────────────────────────────────────
    if (criteria.sex !== 'any') {
      if (!normalizedSex) {
        const missingData: PreventiveMissingDataEntry[] = [
          {
            field: 'sex',
            prompt:
              'To check whether this screening applies to you, we need to know your sex assigned at birth.',
          },
        ];
        const rationale = `Recommended for ${audience}. ${footnote} We need a bit more information to confirm whether this applies to you.`;
        upsertNeedsReview(rule, existing, rationale, missingData, hedis, itemsToUpsert);
        continue;
      }
      if (normalizedSex !== criteria.sex) {
        skippedRules.push({
          ruleId: rule.id,
          reason: `Sex ${normalizedSex} does not match required ${criteria.sex}`,
        });
        continue;
      }
    }

    // ── Legacy conditions on eligibility_criteria ─────────────────────
    // (Old rules used criteria.conditions as a soft prompt rather than
    // the new condition_triggers. Preserve that behavior.)
    let legacyConditionMissing = false;
    if (criteria.conditions && criteria.conditions.length > 0) {
      const hasAny = criteria.conditions.some((c) => lowerConditions.includes(c.toLowerCase()));
      if (!hasAny) {
        legacyConditionMissing = true;
      }
    }

    // ── Existing scheduled state → preserve ──────────────────────────
    if (existing && existing.status === 'scheduled') {
      itemsUnchanged.push(existing.id);
      continue;
    }

    const missingData: PreventiveMissingDataEntry[] = [];
    if (legacyConditionMissing && criteria.conditions) {
      missingData.push({
        field: 'conditions',
        prompt: `This screening is recommended for people with ${criteria.conditions.join(' or ')}. Let us know if any of these apply to you.`,
      });
    }

    // ── Screening method prompt ───────────────────────────────────────
    // If the rule has multiple methods and the patient has a last_done
    // but hasn't told us which method they did, we need that before we
    // can compute next_due accurately.
    const hasMethods = rule.screening_methods && rule.screening_methods.length > 0;
    if (hasMethods && existing?.last_done_date && !selectedMethodId) {
      const methodList = (rule.screening_methods ?? []).map((m) => m.name).join(', ');
      missingData.push({
        field: 'selected_method',
        prompt: `Which type of screening did you have? (${methodList})`,
      });
      const rationale = `Recommended for ${audience}. ${footnote} Tell us which type of screening you had so we can set the right follow-up schedule.`;
      upsertProposal(
        rule,
        existing,
        'needs_review',
        null,
        null,
        rationale,
        missingData,
        hedis,
        selectedMethodId,
        itemsToUpsert,
        itemsUnchanged,
      );
      continue;
    }

    // ── Compute status based on last_done_date + cadence ──────────────
    const lastDone = parseDate(existing?.last_done_date ?? null);
    const { cadence: effectiveCadence, method } = resolveCadence(rule, selectedMethodId);
    const cadenceLabel = method ? method.name : null;

    if (!lastDone) {
      missingData.unshift({
        field: 'last_done_date',
        prompt: `When did you last have a ${rule.title.toLowerCase()}? Enter the date, or mark it as "never done" to add it to your schedule.`,
      });

      let rationale: string;
      if (legacyConditionMissing) {
        rationale = `Recommended for ${audience} with specific risk factors. ${footnote} No previous record found — tell us more so we can make a better recommendation.`;
      } else if (rule.is_condition_dependent && conditionHit) {
        rationale = `Recommended because you have a related condition on file. ${footnote} No record of previous completion — add a date (or mark it as needed) to get started.`;
      } else {
        rationale = `Recommended for ${audience}. ${footnote} No record of previous screening — add a date (or mark it as needed) to get started.`;
      }

      upsertProposal(
        rule,
        existing,
        'needs_review',
        null,
        null,
        rationale,
        missingData,
        hedis,
        selectedMethodId,
        itemsToUpsert,
        itemsUnchanged,
      );
      continue;
    }

    // We have a last_done_date.
    if (effectiveCadence === null || effectiveCadence <= 0) {
      // One-time series (e.g. shingles, HPV, Hep B) or rule with methods
      // but no method picked (handled above already).
      const rationale = `One-time recommendation for ${audience}. ${footnote} Completed on ${formatHumanDate(lastDone)}.`;
      upsertProposal(
        rule,
        existing,
        'up_to_date',
        null,
        null,
        rationale,
        missingData,
        hedis,
        selectedMethodId,
        itemsToUpsert,
        itemsUnchanged,
      );
      continue;
    }

    const nextDue = addMonths(lastDone, effectiveCadence);
    nextDue.setHours(0, 0, 0, 0);
    const diffDays = Math.round((nextDue.getTime() - today.getTime()) / MS_PER_DAY);

    const nextDueStr = toDateOnly(nextDue);
    const lastDoneStr = formatHumanDate(lastDone);
    const cadencePhrase = cadenceLabel
      ? `${cadenceLabel} every ${describeCadence(effectiveCadence)}`
      : `every ${describeCadence(effectiveCadence)}`;

    let status: PreventiveStatus;
    let rationale: string;

    const seasonal = rule.seasonal_window ?? null;
    const inSeason = seasonal ? isInSeason(today, seasonal) : true;

    if (diffDays < 0) {
      // Overdue by the cadence clock.
      if (seasonal && !inSeason) {
        status = 'due_soon';
        const seasonStart = nextSeasonStart(today, seasonal);
        rationale = `Recommended for ${audience}, ${cadencePhrase}. ${footnote} Last completed ${lastDoneStr}. Due during ${seasonal.label} — plan for ${formatHumanDate(seasonStart)}.`;
      } else {
        status = 'due';
        const overdueBy = humanizeInterval(nextDue, today);
        rationale = `Recommended for ${audience}, ${cadencePhrase}. ${footnote} Last completed ${lastDoneStr} — overdue by ${overdueBy}.`;
      }
    } else if (diffDays <= DUE_SOON_WINDOW_DAYS) {
      status = 'due_soon';
      const inWhen = humanizeInterval(today, nextDue);
      rationale = seasonal
        ? `Recommended for ${audience}, ${cadencePhrase}. ${footnote} Last completed ${lastDoneStr} — due in ${inWhen} (${seasonal.label}).`
        : `Recommended for ${audience}, ${cadencePhrase}. ${footnote} Last completed ${lastDoneStr} — due in ${inWhen}.`;
    } else {
      status = 'up_to_date';
      rationale = `Recommended for ${audience}, ${cadencePhrase}. ${footnote} Last completed ${lastDoneStr}. Next due ${formatHumanDate(nextDue)}.`;
    }

    upsertProposal(
      rule,
      existing,
      status,
      status === 'due' || status === 'due_soon' ? nextDueStr : null,
      nextDueStr,
      rationale,
      missingData,
      hedis,
      selectedMethodId,
      itemsToUpsert,
      itemsUnchanged,
    );
  }

  return { itemsToUpsert, itemsUnchanged, skippedRules };
}

function describeCadence(months: number): string {
  if (months === 12) return 'year';
  if (months < 12) return `${months} months`;
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? 'year' : `${years} years`;
  }
  return `${months} months`;
}

function upsertNeedsReview(
  rule: PreventiveRule,
  existing: PreventiveItem | undefined,
  rationale: string,
  missingData: PreventiveMissingDataEntry[],
  hedis: string | null,
  itemsToUpsert: PreventiveItemUpsert[],
) {
  const shouldUpdate =
    !existing ||
    existing.status !== 'needs_review' ||
    existing.rationale !== rationale ||
    JSON.stringify(existing.missing_data ?? []) !== JSON.stringify(missingData);

  if (shouldUpdate) {
    itemsToUpsert.push({
      ruleId: rule.id,
      ruleCode: rule.code,
      title: rule.title,
      status: 'needs_review',
      dueDate: null,
      nextDueDate: null,
      rationale,
      missingData,
      hedisMeasureCode: hedis,
      selectedMethod: existing?.selected_method ?? null,
    });
  }
}

function upsertProposal(
  rule: PreventiveRule,
  existing: PreventiveItem | undefined,
  status: PreventiveStatus,
  dueDate: string | null,
  nextDueDate: string | null,
  rationale: string,
  missingData: PreventiveMissingDataEntry[],
  hedis: string | null,
  selectedMethod: string | null,
  itemsToUpsert: PreventiveItemUpsert[],
  itemsUnchanged: string[],
) {
  if (
    existing &&
    existing.status === status &&
    existing.due_date === dueDate &&
    existing.next_due_date === nextDueDate &&
    existing.rationale === rationale &&
    JSON.stringify(existing.missing_data ?? []) === JSON.stringify(missingData)
  ) {
    itemsUnchanged.push(existing.id);
    return;
  }

  itemsToUpsert.push({
    ruleId: rule.id,
    ruleCode: rule.code,
    title: rule.title,
    status,
    dueDate,
    nextDueDate,
    rationale,
    missingData,
    hedisMeasureCode: hedis,
    selectedMethod,
  });
}
