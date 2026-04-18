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
} from '@/lib/types/preventive';

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
 * Deterministically evaluate every rule against the profile and return
 * the upsert list. The caller is responsible for persisting the result.
 */
export function runEligibilityScan(
  params: RunEligibilityScanParams,
): EligibilityScanResult {
  const { profileFacts, rules, existingItems } = params;

  const today = new Date();
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

    // ── Preserve user choices ─────────────────────────────────────────
    if (existing && (existing.status === 'deferred' || existing.status === 'declined')) {
      itemsUnchanged.push(existing.id);
      continue;
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
      upsertNeedsReview(rule, existing, rationale, missingData, itemsToUpsert);
      continue;
    }

    // ── Age check ─────────────────────────────────────────────────────
    if (criteria.min_age !== null && age < criteria.min_age) {
      skippedRules.push({
        ruleId: rule.id,
        reason: `Age ${age} below min_age ${criteria.min_age}`,
      });
      continue;
    }
    if (criteria.max_age !== null && age > criteria.max_age) {
      skippedRules.push({
        ruleId: rule.id,
        reason: `Age ${age} above max_age ${criteria.max_age}`,
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
        upsertNeedsReview(rule, existing, rationale, missingData, itemsToUpsert);
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

    // ── Conditions check ──────────────────────────────────────────────
    // When a rule requires specific conditions (e.g., overweight/obese for
    // diabetes screening), we surface it as needs_review with a helpful
    // prompt rather than hard-skipping — the user may have the condition
    // but not have recorded it yet.
    let conditionMissing = false;
    if (criteria.conditions && criteria.conditions.length > 0) {
      const hasAny = criteria.conditions.some((c) => lowerConditions.includes(c.toLowerCase()));
      if (!hasAny) {
        conditionMissing = true;
      }
    }

    // ── Existing scheduled state → preserve ──────────────────────────
    if (existing && existing.status === 'scheduled') {
      itemsUnchanged.push(existing.id);
      continue;
    }

    const missingData: PreventiveMissingDataEntry[] = [];
    if (conditionMissing && criteria.conditions) {
      missingData.push({
        field: 'conditions',
        prompt: `This screening is recommended for people with ${criteria.conditions.join(' or ')}. Let us know if any of these apply to you.`,
      });
    }

    // ── Compute status based on last_done_date + cadence ──────────────
    const lastDone = parseDate(existing?.last_done_date ?? null);

    if (!lastDone) {
      missingData.unshift({
        field: 'last_done_date',
        prompt: `When did you last have a ${rule.title.toLowerCase()}? Enter the date, or mark it as "never done" to add it to your schedule.`,
      });

      const rationale = conditionMissing
        ? `Recommended for ${audience} with specific risk factors. ${footnote} No previous record found — tell us more so we can make a better recommendation.`
        : `Recommended for ${audience}. ${footnote} No record of previous screening — add a date (or mark it as needed) to get started.`;

      upsertProposal(
        rule,
        existing,
        'needs_review',
        null,
        null,
        rationale,
        missingData,
        itemsToUpsert,
        itemsUnchanged,
      );
      continue;
    }

    // We have a last_done_date.
    if (rule.cadence_months === null || rule.cadence_months <= 0) {
      // One-time series (e.g., shingles, pneumococcal)
      const rationale = `One-time recommendation for ${audience}. ${footnote} Completed on ${formatHumanDate(lastDone)}.`;
      upsertProposal(
        rule,
        existing,
        'up_to_date',
        null,
        null,
        rationale,
        missingData,
        itemsToUpsert,
        itemsUnchanged,
      );
      continue;
    }

    const nextDue = addMonths(lastDone, rule.cadence_months);
    nextDue.setHours(0, 0, 0, 0);
    const diffDays = Math.round((nextDue.getTime() - today.getTime()) / MS_PER_DAY);

    const nextDueStr = toDateOnly(nextDue);
    const lastDoneStr = formatHumanDate(lastDone);

    let status: PreventiveStatus;
    let rationale: string;

    if (diffDays < 0) {
      status = 'due';
      const overdueBy = humanizeInterval(nextDue, today);
      rationale = `Recommended for ${audience} every ${describeCadence(rule.cadence_months)}. ${footnote} Last completed ${lastDoneStr} — overdue by ${overdueBy}.`;
    } else if (diffDays <= DUE_SOON_WINDOW_DAYS) {
      status = 'due_soon';
      const inWhen = humanizeInterval(today, nextDue);
      rationale = `Recommended for ${audience} every ${describeCadence(rule.cadence_months)}. ${footnote} Last completed ${lastDoneStr} — due in ${inWhen}.`;
    } else {
      status = 'up_to_date';
      rationale = `Recommended for ${audience} every ${describeCadence(rule.cadence_months)}. ${footnote} Last completed ${lastDoneStr}. Next due ${formatHumanDate(nextDue)}.`;
    }

    upsertProposal(
      rule,
      existing,
      status,
      status === 'due' || status === 'due_soon' ? nextDueStr : null,
      nextDueStr,
      rationale,
      missingData,
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
  });
}
