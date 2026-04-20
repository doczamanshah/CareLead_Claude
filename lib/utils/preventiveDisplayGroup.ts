/**
 * Map a PreventiveRule to one of the six clinical display groups used on
 * the dashboard. Derived in code (no DB migration) so we can tweak the
 * groupings without a round-trip through the rule library.
 */

import {
  PREVENTIVE_DISPLAY_GROUPS,
  type PreventiveDisplayGroup,
  type PreventiveRule,
} from '@/lib/types/preventive';

const DIABETES_TERMS = ['diabetes', 'type 1 diabetes', 'type 2 diabetes', 'prediabetes'];
const BEHAVIORAL_CODES = new Set([
  'depression_screening',
  'tobacco_screening',
  'alcohol_screening',
]);
const WELLNESS_CODES = new Set(['annual_wellness_visit', 'bmi_screening']);

type RuleLike = Pick<
  PreventiveRule,
  'code' | 'category' | 'condition_triggers' | 'is_condition_dependent'
>;

function mentionsDiabetes(triggers: string[] | null | undefined): boolean {
  if (!triggers || triggers.length === 0) return false;
  const lower = triggers.map((t) => t.toLowerCase());
  return DIABETES_TERMS.some((term) => lower.some((t) => t.includes(term)));
}

export function getDisplayGroup(rule: RuleLike): PreventiveDisplayGroup {
  // 1. Behavioral health — explicit codes.
  if (BEHAVIORAL_CODES.has(rule.code)) {
    return PREVENTIVE_DISPLAY_GROUPS.behavioral;
  }

  // 2. Wellness — explicit codes (annual visit + BMI).
  if (WELLNESS_CODES.has(rule.code)) {
    return PREVENTIVE_DISPLAY_GROUPS.wellness;
  }

  // 3. Cancer screenings — direct category match.
  if (rule.category === 'cancer_screening') {
    return PREVENTIVE_DISPLAY_GROUPS.cancer;
  }

  // 4. Immunizations — direct category match.
  if (rule.category === 'immunization') {
    return PREVENTIVE_DISPLAY_GROUPS.immunizations;
  }

  // 5. Diabetes care — anything condition-dependent on diabetes.
  if (rule.is_condition_dependent && mentionsDiabetes(rule.condition_triggers)) {
    return PREVENTIVE_DISPLAY_GROUPS.diabetes;
  }

  // 6. Cardiovascular — category or condition-based.
  if (rule.category === 'cardiovascular') {
    return PREVENTIVE_DISPLAY_GROUPS.cardiovascular;
  }

  // 7. Metabolic — diabetes-triggered metabolic items went to diabetes
  //    above; the rest (lipid-like) go to cardiovascular.
  if (rule.category === 'metabolic') {
    return PREVENTIVE_DISPLAY_GROUPS.cardiovascular;
  }

  // 8. Bone health → wellness.
  if (rule.category === 'bone_health') {
    return PREVENTIVE_DISPLAY_GROUPS.wellness;
  }

  // 9. Fall-through — any remaining 'other' goes to wellness.
  return PREVENTIVE_DISPLAY_GROUPS.wellness;
}

export function sortedDisplayGroups(): PreventiveDisplayGroup[] {
  return Object.values(PREVENTIVE_DISPLAY_GROUPS).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}
