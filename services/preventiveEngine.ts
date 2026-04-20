/**
 * Preventive Care Eligibility Engine
 *
 * Pure, deterministic evaluation of preventive_rules against a patient's
 * demographics and conditions. No AI/LLM calls — just rule evaluation.
 *
 * The engine is intentionally explainable: for every proposed upsert it
 * produces a human-readable rationale and, when data is missing, a list
 * of prompts that would unlock a better recommendation.
 *
 * Filtering rules (Phase 3 Item 5c):
 *   • Rules that don't apply to the patient (wrong age, wrong sex, missing
 *     condition) are SKIPPED — no preventive_item is created. Previously
 *     these surfaced as "Needs Review," which was misleading.
 *   • When DOB is missing, only age-agnostic adult rules (min_age=18,
 *     max_age=null) are evaluated.
 *   • When sex is missing, only sex-neutral rules are evaluated.
 *   • Existing items for rules that no longer apply (user aged out, sex
 *     mismatch now known, condition resolved) are returned in
 *     `itemsToArchive` so the orchestrator can mark them 'archived'.
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
import { normalizeSexForEligibility } from '@/lib/utils/gender';

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

export interface PreventiveItemArchive {
  itemId: string;
  ruleId: string;
  reason: string;
}

export interface EligibilityScanResult {
  itemsToUpsert: PreventiveItemUpsert[];
  itemsUnchanged: string[];
  /** Existing items whose rule no longer applies — orchestrator archives these. */
  itemsToArchive: PreventiveItemArchive[];
  /** Rules we didn't create an item for (with reason). */
  skippedRules: { ruleId: string; reason: string }[];
  /** DOB is missing — age-dependent rules couldn't be evaluated. */
  needsDOB: boolean;
  /** Sex is missing — sex-specific rules couldn't be evaluated. */
  needsSex: boolean;
  /** Count of rules skipped due to insufficient demographic data. */
  skippedCount: number;
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

/** @deprecated use normalizeSexForEligibility from '@/lib/utils/gender' */
const normalizeSex = normalizeSexForEligibility;

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
 * Is this rule safe to evaluate without a known DOB? Only broad-adult rules
 * (min_age=18, max_age=null, not condition-dependent) qualify. We assume
 * authenticated users are adults; that's the only assumption we'll make.
 */
function isAgeAgnosticAdultRule(rule: PreventiveRule): boolean {
  const c = rule.eligibility_criteria;
  return c.min_age === 18 && c.max_age === null && !rule.is_condition_dependent;
}

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
  const itemsToArchive: PreventiveItemArchive[] = [];
  const skippedRules: { ruleId: string; reason: string }[] = [];

  let needsDOB = false;
  let needsSex = false;

  // Helper: when a rule doesn't apply and an existing item is present,
  // queue it for archival (unless it's already archived or completed).
  const queueArchive = (rule: PreventiveRule, reason: string) => {
    const existing = existingByRule.get(rule.id);
    if (!existing) return;
    if (existing.status === 'archived' || existing.status === 'completed') return;
    itemsToArchive.push({ itemId: existing.id, ruleId: rule.id, reason });
  };

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

    // ── Archived items are left alone unless re-eligible ─────────────
    // (We only re-evaluate them below if they pass all filters; otherwise
    // they stay archived.)

    // ── Condition-triggered rules ─────────────────────────────────────
    const triggers = rule.condition_triggers ?? null;
    const conditionHit = triggers ? matchesCondition(profileFacts.conditions, triggers) : false;

    if (rule.is_condition_dependent && !conditionHit) {
      skippedRules.push({
        ruleId: rule.id,
        reason: 'Rule requires a matching condition and none is present',
      });
      queueArchive(rule, 'No longer applicable — related condition is no longer on file');
      continue;
    }

    // ── DOB filtering ─────────────────────────────────────────────────
    if (!dob || age === null) {
      if (!isAgeAgnosticAdultRule(rule)) {
        needsDOB = true;
        skippedRules.push({
          ruleId: rule.id,
          reason: 'Age-dependent rule skipped — date of birth is missing',
        });
        // Don't archive: we don't KNOW this doesn't apply — we just can't tell.
        continue;
      }
      // Else: fall through and evaluate (we'll skip the age check below).
    } else {
      // We have an age. Bounds-check.
      const ageOk =
        (criteria.min_age === null || age >= criteria.min_age) &&
        (criteria.max_age === null || age <= criteria.max_age);

      if (!ageOk) {
        skippedRules.push({
          ruleId: rule.id,
          reason: `Age ${age} outside ${criteria.min_age ?? '-'}–${criteria.max_age ?? '-'}`,
        });
        queueArchive(rule, 'No longer applicable based on age');
        continue;
      }
    }

    // ── Sex filtering ─────────────────────────────────────────────────
    if (criteria.sex !== 'any') {
      if (!normalizedSex) {
        needsSex = true;
        skippedRules.push({
          ruleId: rule.id,
          reason: 'Sex-specific rule skipped — sex is missing',
        });
        // Don't archive — we don't know yet.
        continue;
      }
      if (normalizedSex !== criteria.sex) {
        skippedRules.push({
          ruleId: rule.id,
          reason: `Sex ${normalizedSex} does not match required ${criteria.sex}`,
        });
        queueArchive(rule, 'No longer applicable based on sex');
        continue;
      }
    }

    // ── Legacy conditions on eligibility_criteria ─────────────────────
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

    // An archived item that's become applicable again should be resurrected
    // as needs_review so the user sees it flow back into the dashboard.
    const isResurrecting = existing?.status === 'archived';

    const missingData: PreventiveMissingDataEntry[] = [];
    if (legacyConditionMissing && criteria.conditions) {
      missingData.push({
        field: 'conditions',
        prompt: `This screening is recommended for people with ${criteria.conditions.join(' or ')}. Let us know if any of these apply to you.`,
      });
    }

    // ── Screening method prompt ───────────────────────────────────────
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
        isResurrecting,
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
        isResurrecting,
      );
      continue;
    }

    if (effectiveCadence === null || effectiveCadence <= 0) {
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
        isResurrecting,
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
      isResurrecting,
    );
  }

  return {
    itemsToUpsert,
    itemsUnchanged,
    itemsToArchive,
    skippedRules,
    needsDOB,
    needsSex,
    skippedCount: skippedRules.length,
  };
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
  /** When true the prior state was 'archived' — we force an update even
   *  if other fields match, because the status must transition. */
  resurrecting = false,
) {
  if (
    !resurrecting &&
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
