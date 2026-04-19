/**
 * Wellness Visit Bundle.
 *
 * Packages all due / due-soon preventive items into a ready-to-discuss
 * agenda for an annual wellness visit. The UI uses the bundle to render
 * a dedicated card on the preventive dashboard and to seed the pre-visit
 * prep when an AWV-type appointment is approaching.
 */

import { sortByPreventivePriority } from '@/services/preventiveReminders';
import type {
  PreventiveItemWithRule,
  ScreeningMethod,
  WellnessBundle,
} from '@/lib/types/preventive';

interface GenerateWellnessBundleParams {
  profileId: string;
  preventiveItems: PreventiveItemWithRule[];
}

// Items a primary-care provider can close *during* the wellness visit,
// without a separate scheduled procedure. Keyed by rule.code so it stays
// stable as titles evolve.
const CAN_CLOSE_AT_VISIT_CODES = new Set<string>([
  'bp_screening',
  'bmi_screening',
  'depression_screening',
  'tobacco_screening',
  'alcohol_screening',
  'statin_evaluation',
  'diabetes_foot_exam',
  'annual_wellness_visit',
  'flu_vaccine',
  'covid_vaccine',
  'pneumococcal_vaccine',
  'shingles_vaccine',
  'tdap_booster',
  'hpv_vaccine',
]);

// Screenings that typically need their own appointment/procedure even if
// they're on the wellness agenda. Keeping this explicit beats trying to
// infer it from measure_type, since imaging and procedures both need it.
const NEEDS_SEPARATE_SCHEDULING_CODES = new Set<string>([
  'crc_screening',
  'breast_cancer_screening',
  'cervical_cancer_screening',
  'bone_density_screening',
  'lung_cancer_screening',
  'diabetes_eye_exam',
  'diabetes_a1c',
  'diabetes_kidney',
  'lipid_screening',
  'hep_b_screening',
]);

export function generateWellnessBundle(
  params: GenerateWellnessBundleParams,
): WellnessBundle {
  const dueItems = sortByPreventivePriority(
    params.preventiveItems.filter(
      (i) => i.status === 'due' || i.status === 'due_soon',
    ),
  );

  const canCloseAtVisit: PreventiveItemWithRule[] = [];
  const needsSeparateScheduling: PreventiveItemWithRule[] = [];

  for (const item of dueItems) {
    const code = item.rule.code;
    if (CAN_CLOSE_AT_VISIT_CODES.has(code)) {
      canCloseAtVisit.push(item);
    } else if (NEEDS_SEPARATE_SCHEDULING_CODES.has(code)) {
      needsSeparateScheduling.push(item);
    } else {
      // Unknown rule → default to "can discuss" which is the safer visit
      // behavior for the patient.
      canCloseAtVisit.push(item);
    }
  }

  const suggestedAgenda = dueItems.map((item) => formatAgendaLine(item));

  return {
    dueItems,
    totalGaps: dueItems.length,
    suggestedAgenda,
    canCloseAtVisit,
    needsSeparateScheduling,
  };
}

function formatAgendaLine(item: PreventiveItemWithRule): string {
  const methods = item.rule.screening_methods as ScreeningMethod[] | null;
  const method =
    methods && item.selected_method
      ? methods.find((m) => m.method_id === item.selected_method)
      : null;
  const title = method ? `${method.name}` : item.rule.title;
  const code = item.rule.code;

  if (code === 'diabetes_a1c') return `Review A1c trend and plan next draw`;
  if (code === 'diabetes_foot_exam') return `Quick foot check at this visit`;
  if (code === 'bp_screening') return `Take blood pressure at this visit`;
  if (code === 'flu_vaccine' || code === 'covid_vaccine')
    return `Get ${title.toLowerCase()} at this visit if available`;
  if (NEEDS_SEPARATE_SCHEDULING_CODES.has(code))
    return `Discuss scheduling ${title.toLowerCase()}`;
  if (code === 'annual_wellness_visit') return `Book annual wellness visit`;
  return `Bring up ${title.toLowerCase()}`;
}
