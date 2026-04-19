import { supabase } from '@/lib/supabase';
import type { Task } from '@/lib/types/tasks';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export type SnoozePreset =
  | 'tomorrow_morning'
  | 'this_weekend'
  | 'monday'
  | 'after_appointment'
  | 'in_1_week'
  | 'in_1_month'
  | 'custom';

export interface SnoozeOption {
  key: SnoozePreset;
  label: string;
  detail?: string;
  /** The resolved target ISO date, or null for 'custom' (picker). */
  isoTarget: string | null;
  /** Source entity id for the "after_appointment" option. */
  relatedId?: string;
}

/**
 * Build the list of smart snooze options for a given "now" moment and an
 * optional upcoming appointment. Pure function — safe to test.
 */
export function buildSnoozeOptions(
  now: Date,
  nextAppointment: {
    id: string;
    title: string | null;
    provider_name: string | null;
    start_time: string;
  } | null,
): SnoozeOption[] {
  const options: SnoozeOption[] = [];

  // Tomorrow morning (9am local)
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  options.push({
    key: 'tomorrow_morning',
    label: 'Tomorrow morning',
    detail: formatShortDate(tomorrow),
    isoTarget: tomorrow.toISOString(),
  });

  const dow = now.getDay(); // 0 = Sunday, 6 = Saturday
  // Monday — offered Thu–Sun
  if (dow >= 4 || dow === 0) {
    const monday = new Date(now);
    const daysToMonday = dow === 0 ? 1 : 8 - dow; // Thu→4, Fri→3, Sat→2, Sun→1
    monday.setDate(monday.getDate() + daysToMonday);
    monday.setHours(9, 0, 0, 0);
    options.push({
      key: 'monday',
      label: 'Monday',
      detail: formatShortDate(monday),
      isoTarget: monday.toISOString(),
    });
  } else {
    // This weekend (Saturday) — offered Mon–Wed
    const saturday = new Date(now);
    const daysToSat = 6 - dow;
    saturday.setDate(saturday.getDate() + daysToSat);
    saturday.setHours(9, 0, 0, 0);
    options.push({
      key: 'this_weekend',
      label: 'This weekend',
      detail: formatShortDate(saturday),
      isoTarget: saturday.toISOString(),
    });
  }

  if (nextAppointment) {
    const apptDay = new Date(nextAppointment.start_time);
    apptDay.setDate(apptDay.getDate() + 1);
    apptDay.setHours(9, 0, 0, 0);
    const entityName =
      nextAppointment.provider_name ?? nextAppointment.title ?? 'your appointment';
    options.push({
      key: 'after_appointment',
      label: `After ${entityName}`,
      detail: formatShortDate(new Date(nextAppointment.start_time)),
      isoTarget: apptDay.toISOString(),
      relatedId: nextAppointment.id,
    });
  }

  const inWeek = new Date(now);
  inWeek.setDate(inWeek.getDate() + 7);
  inWeek.setHours(9, 0, 0, 0);
  options.push({
    key: 'in_1_week',
    label: 'In 1 week',
    detail: formatShortDate(inWeek),
    isoTarget: inWeek.toISOString(),
  });

  const inMonth = new Date(now);
  inMonth.setMonth(inMonth.getMonth() + 1);
  inMonth.setHours(9, 0, 0, 0);
  options.push({
    key: 'in_1_month',
    label: 'In 1 month',
    detail: formatShortDate(inMonth),
    isoTarget: inMonth.toISOString(),
  });

  options.push({
    key: 'custom',
    label: 'Pick a date',
    isoTarget: null,
  });

  return options;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Fetch the next upcoming appointment for a profile (if any). Used by the
 * snooze sheet to surface the "After my appointment" option.
 */
export async function fetchNextAppointment(
  profileId: string,
): Promise<
  ServiceResult<{
    id: string;
    title: string | null;
    provider_name: string | null;
    start_time: string;
  } | null>
> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('apt_appointments')
    .select('id, title, provider_name, start_time')
    .eq('profile_id', profileId)
    .in('status', ['scheduled', 'preparing', 'ready'])
    .gt('start_time', nowIso)
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) return { success: false, error: error.message, code: error.code };
  return {
    success: true,
    data: (data as {
      id: string;
      title: string | null;
      provider_name: string | null;
      start_time: string;
    } | null) ?? null,
  };
}

/**
 * Snooze a task — updates due_date + reminder_at + increments snoozed_count.
 * Creates a `task.snoozed` audit event (no PHI, just ids + count).
 */
export async function snoozeTask(
  taskId: string,
  isoTarget: string,
  userId: string,
): Promise<ServiceResult<Task>> {
  // Need current snoozed_count for increment
  const { data: existing, error: fetchError } = await supabase
    .from('tasks')
    .select('snoozed_count, profile_id')
    .eq('id', taskId)
    .single();
  if (fetchError) {
    return { success: false, error: fetchError.message, code: fetchError.code };
  }

  const newCount = ((existing?.snoozed_count as number | null) ?? 0) + 1;
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('tasks')
    .update({
      due_date: isoTarget,
      reminder_at: isoTarget,
      snoozed_count: newCount,
      snoozed_at: nowIso,
    })
    .eq('id', taskId)
    .select()
    .single();

  if (error) return { success: false, error: error.message, code: error.code };

  await supabase.from('audit_events').insert({
    profile_id: (existing as { profile_id: string }).profile_id,
    actor_id: userId,
    event_type: 'task.snoozed',
    metadata: {
      task_id: taskId,
      snoozed_count: newCount,
      target: isoTarget,
    },
  });

  return { success: true, data: data as Task };
}
