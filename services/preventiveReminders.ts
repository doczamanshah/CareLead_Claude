/**
 * Appointment-anchored preventive reminders.
 *
 * The core strategy of Part 2: instead of nagging patients with standalone
 * reminders, tie every due/due-soon preventive item to an upcoming visit
 * where it can naturally be addressed. This service powers:
 *   - pre-appointment prep ("Discuss at this visit" suggestions)
 *   - the "Discuss at my next visit" one-tap briefing action
 */

import { supabase } from '@/lib/supabase';
import { createTask } from '@/services/tasks';
import {
  setSnoozeUntilAppointment,
} from '@/services/preventiveReminderPrefs';
import type {
  PreventiveAppointmentReminder,
  PreventiveItemWithRule,
  PreventiveStatus,
} from '@/lib/types/preventive';
import type { VisitPrep, VisitPrepQuestion } from '@/lib/types/appointments';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// ── HEDIS weighting ──────────────────────────────────────────────────────
// Higher weight = higher provider/payer importance → higher priority.
const HEDIS_WEIGHT: Record<string, number> = {
  COL: 3,
  BCS: 3,
  CCS: 3,
  HBD: 3,
  EED: 3,
  KED: 2,
  LCS: 2,
  SPC: 2,
  FLU: 2,
  CBP: 2,
  OMW: 1,
  PHQ9: 1,
  AWV: 1,
};

interface GetRemindersParams {
  profileId: string;
  householdId: string;
  appointmentId: string;
  appointmentDate: string;
  appointmentProvider?: string;
  appointmentType?: string;
}

/**
 * Build appointment-anchored reminders for each due / due_soon preventive
 * item on this profile. Sorted: visit-relevant first, then status severity,
 * then HEDIS weight.
 */
export async function getPreventiveRemindersForAppointment(
  params: GetRemindersParams,
): Promise<ServiceResult<PreventiveAppointmentReminder[]>> {
  const { profileId, appointmentProvider, appointmentType } = params;

  const { data, error } = await supabase
    .from('preventive_items')
    .select(
      `
      id,
      status,
      last_done_date,
      selected_method,
      hedis_measure_code,
      rule:preventive_rules!rule_id (
        code,
        title,
        category,
        measure_type,
        screening_methods,
        hedis_measure_code,
        condition_triggers
      )
    `,
    )
    .eq('profile_id', profileId)
    .in('status', ['due', 'due_soon']);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  interface Row {
    id: string;
    status: PreventiveStatus;
    last_done_date: string | null;
    selected_method: string | null;
    hedis_measure_code: string | null;
    rule:
      | {
          code: string;
          title: string;
          category: string;
          measure_type: string | null;
          screening_methods:
            | { method_id: string; name: string }[]
            | null;
          hedis_measure_code: string | null;
          condition_triggers: string[] | null;
        }
      | {
          code: string;
          title: string;
          category: string;
          measure_type: string | null;
          screening_methods:
            | { method_id: string; name: string }[]
            | null;
          hedis_measure_code: string | null;
          condition_triggers: string[] | null;
        }[]
      | null;
  }

  const rows = (data ?? []) as Row[];

  const reminders: PreventiveAppointmentReminder[] = rows.map((row) => {
    const ruleRaw = row.rule;
    const rule = Array.isArray(ruleRaw) ? ruleRaw[0] : ruleRaw;
    const ruleTitle = rule?.title ?? 'this screening';
    const hedis = rule?.hedis_measure_code ?? row.hedis_measure_code ?? null;
    const providerLabel = appointmentProvider?.trim() || 'your provider';

    const { suggestion, questionForPrep, relevance } = framePrompt({
      ruleCode: rule?.code ?? '',
      ruleTitle,
      ruleCategory: rule?.category ?? 'other',
      measureType: rule?.measure_type ?? 'screening',
      conditionTriggers: rule?.condition_triggers ?? null,
      appointmentType: appointmentType ?? null,
      providerLabel,
      status: row.status,
    });

    const priority: 'high' | 'medium' | 'low' = relevance.isRelevant
      ? 'high'
      : row.status === 'due'
      ? 'medium'
      : 'low';

    return {
      preventiveItemId: row.id,
      ruleTitle,
      hedisCode: hedis,
      status: row.status,
      suggestion,
      questionForPrep,
      priority,
      isRelevantToVisitType: relevance.isRelevant,
    };
  });

  reminders.sort((a, b) => {
    if (a.isRelevantToVisitType !== b.isRelevantToVisitType) {
      return a.isRelevantToVisitType ? -1 : 1;
    }
    if (a.status !== b.status) {
      if (a.status === 'due' && b.status !== 'due') return -1;
      if (b.status === 'due' && a.status !== 'due') return 1;
    }
    const aw = a.hedisCode ? HEDIS_WEIGHT[a.hedisCode] ?? 0 : 0;
    const bw = b.hedisCode ? HEDIS_WEIGHT[b.hedisCode] ?? 0 : 0;
    return bw - aw;
  });

  return { success: true, data: reminders };
}

// ── Prompt framing ───────────────────────────────────────────────────────

function framePrompt(params: {
  ruleCode: string;
  ruleTitle: string;
  ruleCategory: string;
  measureType: string;
  conditionTriggers: string[] | null;
  appointmentType: string | null;
  providerLabel: string;
  status: PreventiveStatus;
}): {
  suggestion: string;
  questionForPrep: string;
  relevance: { isRelevant: boolean };
} {
  const {
    ruleCode,
    ruleTitle,
    measureType,
    ruleCategory,
    appointmentType,
    providerLabel,
    conditionTriggers,
  } = params;

  const apt = (appointmentType ?? '').toLowerCase();
  const isLabsAppt = apt === 'labs';
  const isDoctorAppt = apt === 'doctor' || apt === '';
  const isImagingAppt = apt === 'imaging';

  // Measure-type specific relevance
  let isRelevant = false;

  if (measureType === 'monitoring' && (isLabsAppt || isDoctorAppt)) {
    isRelevant = true;
  }
  if (measureType === 'immunization' && isDoctorAppt) {
    isRelevant = true;
  }
  if (ruleCategory === 'cancer_screening' && isImagingAppt) {
    isRelevant = true;
  }
  if (conditionTriggers && conditionTriggers.length > 0 && isDoctorAppt) {
    // A specialist/general visit is a natural place to discuss a
    // condition-dependent screening.
    isRelevant = true;
  }
  if (ruleCode === 'annual_wellness_visit' && isDoctorAppt) {
    isRelevant = true;
  }

  // Suggestion text — opportunity framing, never guilt.
  let suggestion: string;
  if (measureType === 'monitoring' && isLabsAppt) {
    suggestion = `Ask about adding your ${ruleTitle.toLowerCase()} to this labs visit`;
  } else if (measureType === 'immunization') {
    suggestion = `Ask ${providerLabel} about your ${ruleTitle.toLowerCase()}`;
  } else if (ruleCategory === 'cancer_screening') {
    suggestion = `Discuss scheduling your ${ruleTitle.toLowerCase()} with ${providerLabel}`;
  } else if (measureType === 'counseling') {
    suggestion = `This is a great time for a quick ${ruleTitle.toLowerCase()}`;
  } else if (measureType === 'visit') {
    suggestion = `Consider booking your ${ruleTitle.toLowerCase()} — covered by most insurance`;
  } else {
    suggestion = `Great visit to discuss your ${ruleTitle.toLowerCase()}`;
  }

  // Prep question text — first-person, short, actionable.
  const questionForPrep = buildPrepQuestion(ruleCode, ruleTitle, measureType, isLabsAppt);

  return {
    suggestion,
    questionForPrep,
    relevance: { isRelevant },
  };
}

function buildPrepQuestion(
  ruleCode: string,
  ruleTitle: string,
  measureType: string,
  isLabsAppt: boolean,
): string {
  const lower = ruleTitle.toLowerCase();
  if (measureType === 'monitoring' && isLabsAppt) {
    return `Can we add a ${lower} to today's labs? I'm due for it.`;
  }
  if (ruleCode === 'annual_wellness_visit') {
    return `I'd like to schedule my annual wellness visit — can we talk about timing?`;
  }
  if (measureType === 'immunization') {
    return `I'm due for my ${lower}. Can we handle it today or schedule it?`;
  }
  if (measureType === 'counseling') {
    return `I'd like to do a ${lower} while I'm here.`;
  }
  return `I'm due for a ${lower}. Can we discuss scheduling it?`;
}

// ── Discuss at next visit ────────────────────────────────────────────────

export interface AddToNextVisitPrepParams {
  profileId: string;
  preventiveItemId: string;
  ruleTitle: string;
  questionText: string;
}

export interface AddToNextVisitPrepResult {
  added: boolean;
  appointmentId: string | null;
  appointmentTitle: string | null;
  appointmentStartTime: string | null;
  /** True when there was no upcoming appointment to attach to. */
  noUpcomingAppointment: boolean;
}

/**
 * Attach the preventive question to the next upcoming appointment's prep,
 * create a reminder task, and snooze the briefing item until the visit.
 *
 * If no upcoming appointment exists, returns `noUpcomingAppointment: true`
 * so the UI can offer to schedule one.
 */
export async function addToNextVisitPrep(
  params: AddToNextVisitPrepParams,
): Promise<ServiceResult<AddToNextVisitPrepResult>> {
  const { profileId, preventiveItemId, ruleTitle, questionText } = params;

  const { data: aptRow, error: aptErr } = await supabase
    .from('apt_appointments')
    .select('id, title, start_time, prep_json, notes')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .in('status', ['scheduled', 'preparing', 'ready'])
    .gte('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (aptErr) {
    return { success: false, error: aptErr.message, code: aptErr.code };
  }

  if (!aptRow) {
    return {
      success: true,
      data: {
        added: false,
        appointmentId: null,
        appointmentTitle: null,
        appointmentStartTime: null,
        noUpcomingAppointment: true,
      },
    };
  }

  const existingPrep = (aptRow.prep_json as VisitPrep | null) ?? null;

  const newQuestion: VisitPrepQuestion = {
    id: `pv-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    text: questionText,
    source: 'patient',
    priority: 1,
  };

  const basePrep: VisitPrep = existingPrep ?? {
    purpose_summary: '',
    questions: [],
    refills_needed: [],
    concerns: [],
    logistics: { depart_by: null, driver: null, what_to_bring: [] },
    packet_generated: false,
    prep_status: 'draft',
  };

  // De-dupe on identical text so repeated taps don't stack the list.
  const alreadyPresent = basePrep.questions.some(
    (q) => q.text.trim().toLowerCase() === questionText.trim().toLowerCase(),
  );

  const updatedPrep: VisitPrep = alreadyPresent
    ? basePrep
    : {
        ...basePrep,
        questions: [...basePrep.questions, newQuestion],
        prep_status: 'draft',
      };

  const { error: updateErr } = await supabase
    .from('apt_appointments')
    .update({ prep_json: updatedPrep })
    .eq('id', aptRow.id);

  if (updateErr) {
    return { success: false, error: updateErr.message, code: updateErr.code };
  }

  // Annotate the preventive item so the user can see where it's parked.
  const note = `Will discuss at ${aptRow.title} on ${formatShortDate(aptRow.start_time)}`;
  await supabase
    .from('preventive_items')
    .update({ notes: note })
    .eq('id', preventiveItemId);

  // Create a reminder task tied back to the preventive item.
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id ?? '';
  await createTask(
    {
      profile_id: profileId,
      title: `Discuss ${ruleTitle} at ${aptRow.title}`,
      description: questionText,
      due_date: aptRow.start_time,
      priority: 'medium',
      source_type: 'preventive',
      source_ref: preventiveItemId,
      trigger_type: 'manual',
    },
    userId,
  );

  await setSnoozeUntilAppointment(preventiveItemId, aptRow.start_time);

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    event_type: 'preventive_item.deferred_to_visit',
    metadata: {
      preventive_item_id: preventiveItemId,
      appointment_id: aptRow.id,
    },
  });

  return {
    success: true,
    data: {
      added: true,
      appointmentId: aptRow.id,
      appointmentTitle: aptRow.title,
      appointmentStartTime: aptRow.start_time,
      noUpcomingAppointment: false,
    },
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Sort input items by a mix of status + HEDIS weight for use in the
 * pre-appointment checklist section. Exported because the wellness bundle
 * uses the same ordering.
 */
export function sortByPreventivePriority(
  items: PreventiveItemWithRule[],
): PreventiveItemWithRule[] {
  return [...items].sort((a, b) => {
    const order: Record<PreventiveStatus, number> = {
      due: 0,
      due_soon: 1,
      needs_review: 2,
      scheduled: 3,
      up_to_date: 4,
      completed: 4,
      deferred: 5,
      declined: 5,
    };
    const oa = order[a.status] ?? 6;
    const ob = order[b.status] ?? 6;
    if (oa !== ob) return oa - ob;
    const wa = a.hedis_measure_code ? HEDIS_WEIGHT[a.hedis_measure_code] ?? 0 : 0;
    const wb = b.hedis_measure_code ? HEDIS_WEIGHT[b.hedis_measure_code] ?? 0 : 0;
    return wb - wa;
  });
}
