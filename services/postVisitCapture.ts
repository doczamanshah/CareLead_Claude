/**
 * Post-visit structured quick-capture orchestrator.
 *
 * The structured capture flow lets a patient debrief a visit in ~2 minutes
 * by tapping through cards (new med, condition, lab order, referral,
 * follow-up) instead of writing a freeform summary. Each captured row
 * becomes a real domain record with `source_type='appointment'` and
 * `source_ref=<appointmentId>` so provenance survives.
 *
 * The existing closeout wizard (`services/closeout.ts`) still exists for
 * the deeper "upload after-visit summary, run AI extraction, review
 * outcomes" path. Both flows flip the same `apt_appointments.post_visit_captured`
 * flag so Today's Briefing stops nagging once either one finishes.
 */

import { supabase } from '@/lib/supabase';
import { createMedication, updateMedication, updateSig, updateMedicationStatus } from '@/services/medications';
import { createTask } from '@/services/tasks';
import type {
  Appointment,
  CreateAppointmentParams,
} from '@/lib/types/appointments';
import type {
  MedicationFrequency,
  MedicationStatus,
} from '@/lib/types/medications';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// ── Capture input shapes ──────────────────────────────────────────────────

/** A new medication captured during the visit debrief. */
export interface CaptureNewMedication {
  drug_name: string;
  dose_text?: string;
  frequency?: MedicationFrequency;
  frequency_text?: string;
}

/** A change to an existing medication (dose, frequency, stop). */
export type MedicationChangeType =
  | 'new_dose'
  | 'frequency_changed'
  | 'stopped'
  | 'other';

export interface CaptureMedicationChange {
  medication_id: string;
  drug_name: string;
  change_type: MedicationChangeType;
  new_dose_text?: string;
  new_frequency?: MedicationFrequency;
  new_frequency_text?: string;
  notes?: string;
}

export interface CaptureCondition {
  condition_name: string;
  notes?: string;
}

export interface CaptureLabOrder {
  test_name: string;
  /** ISO date (YYYY-MM-DD) when the test should happen. Null = TBD. */
  due_date: string | null;
  facility?: string;
}

export interface CaptureReferral {
  doctor_name: string;
  specialty?: string;
  /** When true, also persist the doctor as a care-team profile fact. */
  add_to_care_team: boolean;
}

export interface CaptureFollowUp {
  /** ISO date for the suggested follow-up. */
  due_date: string;
  provider_name: string;
}

export interface CapturePostVisitParams {
  appointmentId: string;
  profileId: string;
  householdId: string;
  newMeds?: CaptureNewMedication[];
  changedMeds?: CaptureMedicationChange[];
  newConditions?: CaptureCondition[];
  labOrders?: CaptureLabOrder[];
  referrals?: CaptureReferral[];
  followUps?: CaptureFollowUp[];
  /** Optional free-text note rolled into closeout.quick_summary. */
  notes?: string;
  userId: string;
}

export interface CaptureSummaryEntry {
  kind:
    | 'medication'
    | 'medication_change'
    | 'condition'
    | 'lab_order'
    | 'referral'
    | 'follow_up';
  label: string;
}

export interface CaptureResult {
  appointmentId: string;
  medicationsCreated: number;
  medicationsChanged: number;
  conditionsCreated: number;
  tasksCreated: number;
  referralsCaptured: number;
  followUpsScheduled: number;
  /** Display lines for the summary card at the end of the wizard. */
  summary: CaptureSummaryEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

function frequencyLabel(
  freq?: MedicationFrequency,
  freqText?: string,
): string | undefined {
  if (freqText) return freqText;
  if (!freq) return undefined;
  switch (freq) {
    case 'once_daily':
      return 'once daily';
    case 'twice_daily':
      return 'twice daily';
    case 'three_times_daily':
      return 'three times daily';
    case 'four_times_daily':
      return 'four times daily';
    case 'every_morning':
      return 'every morning';
    case 'every_evening':
      return 'every evening';
    case 'at_bedtime':
      return 'at bedtime';
    case 'as_needed':
      return 'as needed';
    case 'other':
      return undefined;
  }
}

function describeMedication(m: CaptureNewMedication): string {
  const freq = frequencyLabel(m.frequency, m.frequency_text);
  return [m.drug_name, m.dose_text, freq].filter(Boolean).join(' ');
}

function changeLabel(c: CaptureMedicationChange): string {
  switch (c.change_type) {
    case 'new_dose':
      return `${c.drug_name}: dose changed${c.new_dose_text ? ` to ${c.new_dose_text}` : ''}`;
    case 'frequency_changed': {
      const freq = frequencyLabel(c.new_frequency, c.new_frequency_text);
      return `${c.drug_name}: frequency changed${freq ? ` to ${freq}` : ''}`;
    }
    case 'stopped':
      return `${c.drug_name}: stopped`;
    case 'other':
      return `${c.drug_name}: updated${c.notes ? ` — ${c.notes}` : ''}`;
  }
}

function visitDateLabel(appointment: Appointment): string {
  return new Date(appointment.start_time).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// ── Captured-flag helpers ─────────────────────────────────────────────────

/**
 * Flip apt_appointments.post_visit_captured to true. Idempotent. The flag
 * is the source of truth for "no need to nag" — once either capture flow
 * sets it, Today's Briefing stops surfacing the appointment.
 */
export async function markPostVisitCaptured(
  appointmentId: string,
): Promise<ServiceResult<void>> {
  const { error } = await supabase
    .from('apt_appointments')
    .update({ post_visit_captured: true })
    .eq('id', appointmentId);
  if (error) return { success: false, error: error.message, code: error.code };
  return { success: true, data: undefined };
}

const UNCAPTURED_LOOKBACK_HOURS = 48;

/**
 * Fetch past appointments within the look-back window that haven't been
 * captured yet — these are the prompts surfaced in Today's Briefing.
 *
 * Filters out cancelled / rescheduled (no debrief makes sense for those)
 * and draft (never confirmed in the first place).
 */
export async function fetchUncapturedPastAppointments(
  profileId: string,
  lookbackHours: number = UNCAPTURED_LOOKBACK_HOURS,
): Promise<ServiceResult<Appointment[]>> {
  const now = new Date();
  const lookback = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('profile_id', profileId)
    .eq('post_visit_captured', false)
    .gte('start_time', lookback.toISOString())
    .lte('start_time', now.toISOString())
    .not('status', 'in', '(cancelled,rescheduled,draft)')
    .is('deleted_at', null)
    .order('start_time', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }
  return { success: true, data: (data ?? []) as Appointment[] };
}

// ── Orchestrator ──────────────────────────────────────────────────────────

/**
 * Run the structured post-visit capture: create real medications, profile
 * facts, and tasks for everything the user marked, set the captured flag,
 * mark the appointment completed, and return a summary the wizard renders
 * on its final step.
 *
 * Each sub-step is best-effort: a failure on one capture row doesn't abort
 * the rest. The summary only includes entries that were successfully
 * persisted, so the user sees exactly what's now on file.
 */
export async function capturePostVisitData(
  params: CapturePostVisitParams,
): Promise<ServiceResult<CaptureResult>> {
  const {
    appointmentId,
    profileId,
    householdId: _householdId,
    newMeds = [],
    changedMeds = [],
    newConditions = [],
    labOrders = [],
    referrals = [],
    followUps = [],
    notes,
    userId,
  } = params;

  // Need the appointment to enrich descriptions and provider name fallbacks.
  const { data: aptRow, error: aptError } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();
  if (aptError || !aptRow) {
    return { success: false, error: aptError?.message ?? 'Appointment not found' };
  }
  const appointment = aptRow as Appointment;
  const visitDate = visitDateLabel(appointment);
  const providerSuffix = appointment.provider_name ? ` (${appointment.provider_name})` : '';

  const summary: CaptureSummaryEntry[] = [];
  let medicationsCreated = 0;
  let medicationsChanged = 0;
  let conditionsCreated = 0;
  let tasksCreated = 0;
  let referralsCaptured = 0;
  let followUpsScheduled = 0;

  // ── New medications ──────────────────────────────────────────────────
  for (const med of newMeds) {
    if (!med.drug_name?.trim()) continue;
    const result = await createMedication(
      {
        profile_id: profileId,
        drug_name: med.drug_name.trim(),
        dose_text: med.dose_text?.trim() || undefined,
        frequency_text: frequencyLabel(med.frequency, med.frequency_text),
        prn_flag: med.frequency === 'as_needed',
      },
      userId,
    );
    if (result.success) {
      // Stamp provenance on the freshly created med so reports can trace it
      // back to this appointment.
      await supabase
        .from('med_medications')
        .update({ source_type: 'appointment', source_ref: appointmentId })
        .eq('id', result.data.id);
      medicationsCreated++;
      summary.push({ kind: 'medication', label: `Added medication: ${describeMedication(med)}` });
    }
  }

  // ── Medication changes ───────────────────────────────────────────────
  for (const change of changedMeds) {
    if (!change.medication_id) continue;
    let success = false;
    if (change.change_type === 'stopped') {
      const result = await updateMedicationStatus(change.medication_id, 'stopped' as MedicationStatus, userId);
      success = result.success;
    } else if (change.change_type === 'new_dose' && change.new_dose_text) {
      const result = await updateSig(
        change.medication_id,
        { dose_text: change.new_dose_text.trim() },
        userId,
      );
      success = result.success;
    } else if (change.change_type === 'frequency_changed') {
      const freq = frequencyLabel(change.new_frequency, change.new_frequency_text);
      if (freq) {
        const result = await updateSig(
          change.medication_id,
          { frequency_text: freq },
          userId,
        );
        success = result.success;
      }
    } else if (change.change_type === 'other' && change.notes) {
      const result = await updateMedication(
        change.medication_id,
        { notes: change.notes.trim() },
        userId,
      );
      success = result.success;
    }
    if (success) {
      medicationsChanged++;
      summary.push({ kind: 'medication_change', label: changeLabel(change) });
    }
  }

  // ── New conditions ───────────────────────────────────────────────────
  // Conditions go straight to profile_facts (verified, since the user is
  // confirming the diagnosis rather than guessing).
  const now = new Date().toISOString();
  for (const cond of newConditions) {
    const name = cond.condition_name?.trim();
    if (!name) continue;
    const value: Record<string, unknown> = {
      condition_name: name,
      status: 'active',
    };
    if (cond.notes) value.notes = cond.notes.trim();
    const { error } = await supabase
      .from('profile_facts')
      .insert({
        profile_id: profileId,
        category: 'condition',
        field_key: 'condition.entry',
        value_json: value,
        source_type: 'document',
        source_ref: appointmentId,
        verification_status: 'verified',
        verified_at: now,
        verified_by: userId,
        actor_id: userId,
      });
    if (!error) {
      conditionsCreated++;
      summary.push({ kind: 'condition', label: `New condition: ${name}` });
    }
  }

  // ── Lab orders → tasks ───────────────────────────────────────────────
  for (const lab of labOrders) {
    const test = lab.test_name?.trim();
    if (!test) continue;
    const dueIso = lab.due_date ? new Date(lab.due_date + 'T17:00:00').toISOString() : undefined;
    const facilitySuffix = lab.facility ? ` at ${lab.facility.trim()}` : '';
    const result = await createTask(
      {
        profile_id: profileId,
        title: `Complete ${test}${facilitySuffix}`,
        description: `Ordered at your visit on ${visitDate}${providerSuffix}.`,
        priority: 'high',
        due_date: dueIso,
        source_type: 'appointment',
        source_ref: appointmentId,
        trigger_type: 'extraction',
        trigger_source: 'Post-visit capture',
      },
      userId,
    );
    if (result.success) {
      tasksCreated++;
      const whenLabel = lab.due_date
        ? `due ${new Date(lab.due_date + 'T00:00:00').toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}`
        : 'TBD';
      summary.push({
        kind: 'lab_order',
        label: `Lab ordered: ${test} (${whenLabel})`,
      });
    }
  }

  // ── Referrals → care_team fact (optional) + scheduling task ──────────
  for (const ref of referrals) {
    const name = ref.doctor_name?.trim();
    if (!name) continue;

    if (ref.add_to_care_team) {
      const value: Record<string, unknown> = { name };
      if (ref.specialty) value.specialty = ref.specialty.trim();
      // Best-effort — care team add doesn't block referral task creation.
      await supabase.from('profile_facts').insert({
        profile_id: profileId,
        category: 'care_team',
        field_key: 'care_team.entry',
        value_json: value,
        source_type: 'document',
        source_ref: appointmentId,
        verification_status: 'verified',
        verified_at: now,
        verified_by: userId,
        actor_id: userId,
      });
    }

    const taskTitle = ref.specialty
      ? `Schedule appointment with ${name} (${ref.specialty.trim()})`
      : `Schedule appointment with ${name}`;
    const result = await createTask(
      {
        profile_id: profileId,
        title: taskTitle,
        description: `Referral from your visit on ${visitDate}${providerSuffix}.`,
        priority: 'high',
        source_type: 'appointment',
        source_ref: appointmentId,
        trigger_type: 'extraction',
        trigger_source: 'Post-visit capture',
      },
      userId,
    );
    if (result.success) {
      tasksCreated++;
      referralsCaptured++;
      summary.push({
        kind: 'referral',
        label: `Referral: ${name}${ref.specialty ? `, ${ref.specialty}` : ''}`,
      });
    }
  }

  // ── Follow-ups → scheduling task ─────────────────────────────────────
  for (const fu of followUps) {
    if (!fu.due_date) continue;
    const dueIso = new Date(fu.due_date + 'T17:00:00').toISOString();
    const provider = fu.provider_name?.trim() || appointment.provider_name || 'your doctor';
    const result = await createTask(
      {
        profile_id: profileId,
        title: `Schedule follow-up with ${provider}`,
        description: `Suggested at your visit on ${visitDate}.`,
        priority: 'high',
        due_date: dueIso,
        source_type: 'appointment',
        source_ref: appointmentId,
        trigger_type: 'extraction',
        trigger_source: 'Post-visit capture',
      },
      userId,
    );
    if (result.success) {
      tasksCreated++;
      followUpsScheduled++;
      const whenLabel = new Date(fu.due_date + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      summary.push({
        kind: 'follow_up',
        label: `Follow-up: ${whenLabel} with ${provider}`,
      });
    }
  }

  // ── Persist optional free-text notes via the existing closeout row ──
  if (notes && notes.trim()) {
    // Reuse the closeout row so the appointment detail's "Visit Summary"
    // surface continues to work. Create a minimal one if none exists.
    const { data: existingCo } = await supabase
      .from('apt_closeouts')
      .select('id')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingCo) {
      await supabase
        .from('apt_closeouts')
        .update({ quick_summary: notes.trim(), visit_happened: true, status: 'finalized' })
        .eq('id', existingCo.id);
    } else {
      await supabase.from('apt_closeouts').insert({
        appointment_id: appointmentId,
        profile_id: profileId,
        status: 'finalized',
        visit_happened: true,
        quick_summary: notes.trim(),
      });
    }
  }

  // ── Mark captured + appointment completed ────────────────────────────
  await supabase
    .from('apt_appointments')
    .update({ post_visit_captured: true, status: 'completed' })
    .eq('id', appointmentId);

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'appointment.post_visit_captured',
    metadata: {
      appointment_id: appointmentId,
      medications_created: medicationsCreated,
      medications_changed: medicationsChanged,
      conditions_created: conditionsCreated,
      tasks_created: tasksCreated,
      referrals_captured: referralsCaptured,
      follow_ups_scheduled: followUpsScheduled,
    },
  });

  return {
    success: true,
    data: {
      appointmentId,
      medicationsCreated,
      medicationsChanged,
      conditionsCreated,
      tasksCreated,
      referralsCaptured,
      followUpsScheduled,
      summary,
    },
  };
}

// ── Reschedule / cancel quick paths (used by Card 1 of the wizard) ────────

export async function recordRescheduledAppointment(
  appointmentId: string,
  newStartTime: string,
  userId: string,
): Promise<ServiceResult<void>> {
  // Mark the original as rescheduled + captured (no further nag) and create
  // a fresh draft appointment for the new date carrying forward provider/title.
  const { data: original, error: fetchError } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();
  if (fetchError || !original) {
    return { success: false, error: fetchError?.message ?? 'Appointment not found' };
  }
  const apt = original as Appointment;

  const newApt: CreateAppointmentParams = {
    profile_id: apt.profile_id,
    title: apt.title,
    appointment_type: apt.appointment_type,
    provider_name: apt.provider_name ?? undefined,
    facility_name: apt.facility_name ?? undefined,
    location_text: apt.location_text ?? undefined,
    purpose: apt.purpose ?? undefined,
    start_time: newStartTime,
    timezone: apt.timezone,
    status: 'scheduled',
  };

  const { error: insertError } = await supabase.from('apt_appointments').insert({
    ...newApt,
    linked_appointment_id: appointmentId,
    created_by: userId,
  });
  if (insertError) {
    return { success: false, error: insertError.message };
  }

  const { error: updateError } = await supabase
    .from('apt_appointments')
    .update({ status: 'rescheduled', post_visit_captured: true })
    .eq('id', appointmentId);
  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await supabase.from('audit_events').insert({
    profile_id: apt.profile_id,
    actor_id: userId,
    event_type: 'appointment.rescheduled',
    metadata: { original_appointment_id: appointmentId, new_start_time: newStartTime },
  });
  return { success: true, data: undefined };
}

export async function recordCancelledAppointment(
  appointmentId: string,
  userId: string,
): Promise<ServiceResult<void>> {
  const { data, error } = await supabase
    .from('apt_appointments')
    .update({ status: 'cancelled', post_visit_captured: true })
    .eq('id', appointmentId)
    .select('profile_id')
    .single();
  if (error) return { success: false, error: error.message };

  await supabase.from('audit_events').insert({
    profile_id: data.profile_id,
    actor_id: userId,
    event_type: 'appointment.cancelled',
    metadata: { appointment_id: appointmentId, source: 'post_visit_capture' },
  });
  return { success: true, data: undefined };
}
