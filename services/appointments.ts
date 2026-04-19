/**
 * Appointments service. CRUD for appointments + Visit Prep generation,
 * saving, and the small set of related tasks that fall out of saving prep.
 *
 * Visit Prep replaces the older `apt_plan_items` checklist flow. The prep
 * lives on `apt_appointments.prep_json` as a single structured object.
 */

import { supabase } from '@/lib/supabase';
import { createTask } from '@/services/tasks';
import { generateVisitPrep } from '@/services/appointmentPlanGenerator';
import type {
  Appointment,
  AppointmentFilter,
  CaregiverSuggestion,
  CaregiverSuggestionStatus,
  CreateAppointmentParams,
  UpdateAppointmentParams,
  VisitPrep,
} from '@/lib/types/appointments';
import type { ProfileFact } from '@/lib/types/profile';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

const PREP_REVIEW_LEAD_DAYS = 2;

// ── Appointments ────────────────────────────────────────────────────────────

export async function fetchAppointments(
  profileId: string,
  filters?: AppointmentFilter,
): Promise<ServiceResult<Appointment[]>> {
  let query = supabase
    .from('apt_appointments')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null);

  if (filters?.status) {
    if (Array.isArray(filters.status)) {
      query = query.in('status', filters.status);
    } else {
      query = query.eq('status', filters.status);
    }
  }

  if (filters?.appointmentType) {
    query = query.eq('appointment_type', filters.appointmentType);
  }

  if (filters?.startBefore) {
    query = query.lte('start_time', filters.startBefore);
  }

  if (filters?.startAfter) {
    query = query.gte('start_time', filters.startAfter);
  }

  const { data, error } = await query.order('start_time', { ascending: true });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as Appointment[] };
}

export async function fetchAppointmentDetail(
  appointmentId: string,
): Promise<ServiceResult<Appointment>> {
  const { data, error } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', appointmentId)
    .is('deleted_at', null)
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: data as Appointment };
}

export async function createAppointment(
  params: CreateAppointmentParams,
  userId: string,
): Promise<ServiceResult<Appointment>> {
  const { data, error } = await supabase
    .from('apt_appointments')
    .insert({
      profile_id: params.profile_id,
      title: params.title,
      appointment_type: params.appointment_type,
      provider_name: params.provider_name ?? null,
      facility_name: params.facility_name ?? null,
      location_text: params.location_text ?? null,
      purpose: params.purpose ?? null,
      notes: params.notes ?? null,
      start_time: params.start_time,
      end_time: params.end_time ?? null,
      timezone: params.timezone ?? 'America/Chicago',
      status: params.status ?? 'scheduled',
      plan_status: 'none',
      context_json: params.context_json ?? null,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: params.profile_id,
    actor_id: userId,
    event_type: 'appointment.created',
    metadata: {
      appointment_id: data.id,
      appointment_type: params.appointment_type,
    },
  });

  return { success: true, data: data as Appointment };
}

export async function updateAppointment(
  appointmentId: string,
  params: UpdateAppointmentParams,
  userId: string,
): Promise<ServiceResult<Appointment>> {
  const { data, error } = await supabase
    .from('apt_appointments')
    .update(params)
    .eq('id', appointmentId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: data.profile_id,
    actor_id: userId,
    event_type: 'appointment.updated',
    metadata: {
      appointment_id: appointmentId,
      updated_fields: Object.keys(params),
    },
  });

  return { success: true, data: data as Appointment };
}

export async function cancelAppointment(
  appointmentId: string,
  userId: string,
): Promise<ServiceResult<Appointment>> {
  const { data, error } = await supabase
    .from('apt_appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointmentId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: data.profile_id,
    actor_id: userId,
    event_type: 'appointment.cancelled',
    metadata: { appointment_id: appointmentId },
  });

  return { success: true, data: data as Appointment };
}

/**
 * Reschedule: create a new appointment linked to the original, and mark the
 * original as rescheduled.
 */
export async function rescheduleAppointment(
  appointmentId: string,
  newData: CreateAppointmentParams,
  userId: string,
): Promise<ServiceResult<Appointment>> {
  const { data: created, error: createError } = await supabase
    .from('apt_appointments')
    .insert({
      profile_id: newData.profile_id,
      title: newData.title,
      appointment_type: newData.appointment_type,
      provider_name: newData.provider_name ?? null,
      facility_name: newData.facility_name ?? null,
      location_text: newData.location_text ?? null,
      purpose: newData.purpose ?? null,
      notes: newData.notes ?? null,
      start_time: newData.start_time,
      end_time: newData.end_time ?? null,
      timezone: newData.timezone ?? 'America/Chicago',
      status: 'scheduled',
      plan_status: 'none',
      linked_appointment_id: appointmentId,
      created_by: userId,
    })
    .select()
    .single();

  if (createError) {
    return { success: false, error: createError.message, code: createError.code };
  }

  const { error: updateError } = await supabase
    .from('apt_appointments')
    .update({ status: 'rescheduled' })
    .eq('id', appointmentId);

  if (updateError) {
    return { success: false, error: updateError.message, code: updateError.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: newData.profile_id,
    actor_id: userId,
    event_type: 'appointment.rescheduled',
    metadata: {
      original_appointment_id: appointmentId,
      new_appointment_id: created.id,
    },
  });

  return { success: true, data: created as Appointment };
}

// ── Visit Prep ──────────────────────────────────────────────────────────────

interface CaregiverOption {
  user_id: string | null;
  display_name: string;
  role: string;
}

async function fetchCaregiverOptions(profileId: string): Promise<CaregiverOption[]> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('household_id')
    .eq('id', profileId)
    .single();

  if (!profile?.household_id) return [];

  const { data: members } = await supabase
    .from('household_members')
    .select('user_id, role, profiles!inner(display_name)')
    .eq('household_id', profile.household_id)
    .eq('status', 'active')
    .not('user_id', 'is', null);

  return ((members ?? []) as Record<string, unknown>[]).map((m) => {
    const profiles = m.profiles as Record<string, unknown> | Record<string, unknown>[];
    const p = Array.isArray(profiles) ? profiles[0] : profiles;
    return {
      user_id: (m.user_id as string) ?? null,
      display_name: (p?.display_name as string) ?? 'Caregiver',
      role: (m.role as string) ?? 'caregiver',
    };
  });
}

/**
 * Generate a Visit Prep object for an appointment and persist it onto
 * `prep_json`. If prep already exists this returns the existing prep
 * unchanged — call `saveVisitPrep` to overwrite with edits.
 */
export async function generateAppointmentVisitPrep(
  appointmentId: string,
  userId: string,
): Promise<ServiceResult<Appointment>> {
  const { data: appointment, error: aptError } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (aptError) {
    return { success: false, error: aptError.message, code: aptError.code };
  }

  if (appointment.prep_json) {
    return { success: true, data: appointment as Appointment };
  }

  const { data: facts } = await supabase
    .from('profile_facts')
    .select('*')
    .eq('profile_id', appointment.profile_id)
    .is('deleted_at', null);

  const caregivers = await fetchCaregiverOptions(appointment.profile_id);

  const prep = generateVisitPrep({
    appointment: {
      appointment_type: appointment.appointment_type,
      purpose: appointment.purpose,
      provider_name: appointment.provider_name,
      start_time: appointment.start_time,
    },
    facts: (facts ?? []) as ProfileFact[],
    caregivers,
    context: appointment.context_json ?? null,
  });

  const { data: updated, error: updateError } = await supabase
    .from('apt_appointments')
    .update({
      prep_json: prep,
      plan_status: 'draft',
      status: 'preparing',
    })
    .eq('id', appointmentId)
    .select()
    .single();

  if (updateError) {
    return { success: false, error: updateError.message, code: updateError.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: appointment.profile_id,
    actor_id: userId,
    event_type: 'appointment.prep_generated',
    metadata: {
      appointment_id: appointmentId,
      question_count: prep.questions.length,
      refill_count: prep.refills_needed.length,
    },
  });

  return { success: true, data: updated as Appointment };
}

/**
 * Persist edited Visit Prep and (re)create the small set of related tasks.
 *
 * Tasks are bounded to a maximum of THREE per appointment:
 *   1. "Review visit prep for [Provider] — [Date]"  (always)
 *   2. "Confirm ride with [Driver name]"            (only if a driver is set)
 *   3. "Appointment reminder for [Title]"           (always — reminder_at = day before)
 *
 * Existing visit-prep tasks for this appointment are soft-deleted before
 * the new set is created so the operation is idempotent.
 */
export async function saveVisitPrep(
  appointmentId: string,
  prep: VisitPrep,
  userId: string,
  options?: { markReady?: boolean },
): Promise<ServiceResult<{ appointment: Appointment; tasksCreated: number }>> {
  const { data: appointment, error: aptError } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (aptError) {
    return { success: false, error: aptError.message, code: aptError.code };
  }

  // Stamp the prep with its lifecycle status. Default to 'draft' on every
  // save; only switch to 'ready' when the patient explicitly marks it ready.
  const stampedPrep: VisitPrep = {
    ...prep,
    prep_status: options?.markReady ? 'ready' : 'draft',
  };

  // Persist the edited prep. Bump appointment.status to 'ready' only when
  // the patient marks the prep ready, otherwise stay in 'preparing'.
  const { data: updated, error: updateError } = await supabase
    .from('apt_appointments')
    .update({
      prep_json: stampedPrep,
      plan_status: options?.markReady ? 'committed' : 'draft',
      status: options?.markReady ? 'ready' : 'preparing',
    })
    .eq('id', appointmentId)
    .select()
    .single();

  if (updateError) {
    return { success: false, error: updateError.message, code: updateError.code };
  }

  // Tasks (review-prep, ride, reminder) are tied to a *ready* prep — they
  // would just churn if we regenerated them on every draft save. Only
  // (re)create them when the patient marks the prep ready.
  if (!options?.markReady) {
    await supabase.from('audit_events').insert({
      profile_id: appointment.profile_id,
      actor_id: userId,
      event_type: 'appointment.prep_saved',
      metadata: {
        appointment_id: appointmentId,
        tasks_created: 0,
        has_driver: !!prep.logistics.driver,
        prep_status: 'draft',
      },
    });
    return {
      success: true,
      data: { appointment: updated as Appointment, tasksCreated: 0 },
    };
  }

  // Soft-delete any existing visit-prep tasks tied to this appointment.
  await supabase
    .from('tasks')
    .update({ deleted_at: new Date().toISOString() })
    .eq('source_type', 'appointment')
    .eq('source_ref', appointmentId)
    .is('deleted_at', null);

  const start = new Date(appointment.start_time);
  const reviewDue = new Date(start);
  reviewDue.setDate(reviewDue.getDate() - PREP_REVIEW_LEAD_DAYS);
  const reminderAt = new Date(start);
  reminderAt.setDate(reminderAt.getDate() - 1);
  reminderAt.setHours(8, 0, 0, 0);

  const providerLabel = appointment.provider_name ?? appointment.title;
  const dateLabel = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  let tasksCreated = 0;

  // 1. Review prep task
  const reviewResult = await createTask(
    {
      profile_id: appointment.profile_id,
      title: `Review visit prep for ${providerLabel} — ${dateLabel}`,
      description: 'Open your Visit Prep to confirm questions, logistics, and packet.',
      priority: 'medium',
      due_date: reviewDue.toISOString(),
      source_type: 'appointment',
      source_ref: appointmentId,
      trigger_type: 'time_based',
      trigger_source: 'Visit Prep',
      context_json: {
        instructions: [
          `Open the Visit Prep screen for "${appointment.title}".`,
        ],
      },
    },
    userId,
  );
  if (reviewResult.success) tasksCreated++;

  // 2. Confirm ride task — only when a driver is set on the prep
  if (prep.logistics.driver) {
    const driverName = prep.logistics.driver.name;
    const rideResult = await createTask(
      {
        profile_id: appointment.profile_id,
        title: `Confirm ride with ${driverName}`,
        description: `Confirm transportation with ${driverName} for your visit on ${dateLabel}.`,
        priority: 'high',
        due_date: reviewDue.toISOString(),
        source_type: 'appointment',
        source_ref: appointmentId,
        trigger_type: 'time_based',
        trigger_source: 'Visit Prep',
        assigned_to_user_id: prep.logistics.driver.user_id ?? undefined,
      },
      userId,
    );
    if (rideResult.success) tasksCreated++;
  }

  // 3. Appointment reminder
  const reminderResult = await createTask(
    {
      profile_id: appointment.profile_id,
      title: `Appointment reminder: ${appointment.title}`,
      description: `Tomorrow at ${start.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })}.`,
      priority: 'medium',
      due_date: start.toISOString(),
      reminder_at: reminderAt.toISOString(),
      source_type: 'appointment',
      source_ref: appointmentId,
      trigger_type: 'time_based',
      trigger_source: 'Visit Prep',
    },
    userId,
  );
  if (reminderResult.success) tasksCreated++;

  await supabase.from('audit_events').insert({
    profile_id: appointment.profile_id,
    actor_id: userId,
    event_type: 'appointment.prep_saved',
    metadata: {
      appointment_id: appointmentId,
      tasks_created: tasksCreated,
      has_driver: !!prep.logistics.driver,
      prep_status: stampedPrep.prep_status,
    },
  });

  return {
    success: true,
    data: { appointment: updated as Appointment, tasksCreated },
  };
}

// ── Caregiver Suggestions ───────────────────────────────────────────────────

export interface NewCaregiverSuggestion {
  from_user_id: string;
  from_name: string;
  text: string;
}

/**
 * Append a caregiver suggestion to an appointment's prep_json. The
 * suggestion is created with status 'pending' and appears on the patient's
 * Visit Prep screen for accept/dismiss.
 */
export async function addCaregiverSuggestion(
  appointmentId: string,
  suggestion: NewCaregiverSuggestion,
): Promise<ServiceResult<{ appointment: Appointment; suggestion: CaregiverSuggestion }>> {
  const { data: appointment, error: aptError } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (aptError) {
    return { success: false, error: aptError.message, code: aptError.code };
  }

  const existingPrep = (appointment.prep_json ?? null) as VisitPrep | null;
  if (!existingPrep) {
    return {
      success: false,
      error: 'Visit prep has not been created yet for this appointment.',
    };
  }

  const newSuggestion: CaregiverSuggestion = {
    id: `cs-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    from_user_id: suggestion.from_user_id,
    from_name: suggestion.from_name,
    text: suggestion.text.trim(),
    status: 'pending',
    created_at: new Date().toISOString(),
  };

  const updatedPrep: VisitPrep = {
    ...existingPrep,
    caregiver_suggestions: [
      ...(existingPrep.caregiver_suggestions ?? []),
      newSuggestion,
    ],
  };

  const { data: updated, error: updateError } = await supabase
    .from('apt_appointments')
    .update({ prep_json: updatedPrep })
    .eq('id', appointmentId)
    .select()
    .single();

  if (updateError) {
    return { success: false, error: updateError.message, code: updateError.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: appointment.profile_id,
    actor_id: suggestion.from_user_id,
    event_type: 'appointment.caregiver_suggestion_added',
    metadata: {
      appointment_id: appointmentId,
      suggestion_id: newSuggestion.id,
    },
  });

  return {
    success: true,
    data: { appointment: updated as Appointment, suggestion: newSuggestion },
  };
}

/**
 * Update a caregiver suggestion's status (accepted | dismissed). Used when
 * the patient acts on a suggestion from their Visit Prep screen.
 */
export async function updateCaregiverSuggestionStatus(
  appointmentId: string,
  suggestionId: string,
  status: CaregiverSuggestionStatus,
  userId: string,
): Promise<ServiceResult<Appointment>> {
  const { data: appointment, error: aptError } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (aptError) {
    return { success: false, error: aptError.message, code: aptError.code };
  }

  const existingPrep = (appointment.prep_json ?? null) as VisitPrep | null;
  if (!existingPrep) {
    return { success: false, error: 'Visit prep not found.' };
  }

  const updatedPrep: VisitPrep = {
    ...existingPrep,
    caregiver_suggestions: (existingPrep.caregiver_suggestions ?? []).map((s) =>
      s.id === suggestionId ? { ...s, status } : s,
    ),
  };

  const { data: updated, error: updateError } = await supabase
    .from('apt_appointments')
    .update({ prep_json: updatedPrep })
    .eq('id', appointmentId)
    .select()
    .single();

  if (updateError) {
    return { success: false, error: updateError.message, code: updateError.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: appointment.profile_id,
    actor_id: userId,
    event_type: 'appointment.caregiver_suggestion_updated',
    metadata: {
      appointment_id: appointmentId,
      suggestion_id: suggestionId,
      status,
    },
  });

  return { success: true, data: updated as Appointment };
}
