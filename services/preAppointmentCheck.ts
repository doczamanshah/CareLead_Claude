/**
 * Pre-Appointment Profile Accuracy Check.
 *
 * Before an upcoming appointment, evaluates whether the patient's profile is
 * in good shape to share with a provider — medications, allergies, conditions,
 * insurance, questions prepared, and documents to bring. Surfaces as a
 * briefing prompt (1-3 days out) and a dedicated pre-check screen.
 *
 * The check is deterministic — it reads current profile facts, medications,
 * results, and the appointment's prep_json. No AI. No writes. Safe to run on
 * every briefing refresh.
 */

import { supabase } from '@/lib/supabase';
import type {
  PreAppointmentCheckItem,
  PreAppointmentCheckResult,
  VisitPrep,
} from '@/lib/types/appointments';
import type { Medication } from '@/lib/types/medications';
import type { ProfileFact } from '@/lib/types/profile';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

interface RunPreAppointmentCheckParams {
  profileId: string;
  householdId: string;
  appointmentDate: string;
  appointmentProvider?: string;
}

const MEDICATION_STALE_DAYS = 90;
const RESULT_RECENT_DAYS = 30;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY);
}

/**
 * Evaluate profile readiness for an upcoming appointment.
 *
 * Returns a fixed list of check items (one per category) with status +
 * optional action pointers. The UI is responsible for sorting and grouping;
 * the service just surfaces the raw signal.
 */
export async function runPreAppointmentCheck(
  params: RunPreAppointmentCheckParams,
): Promise<ServiceResult<PreAppointmentCheckResult>> {
  const { profileId } = params;

  const [medsRes, factsRes, resultsRes, appointmentRes] = await Promise.all([
    supabase
      .from('med_medications')
      .select('id, status, updated_at')
      .eq('profile_id', profileId)
      .is('deleted_at', null),
    supabase
      .from('profile_facts')
      .select('*')
      .eq('profile_id', profileId)
      .is('deleted_at', null),
    supabase
      .from('result_items')
      .select('id, created_at, status')
      .eq('profile_id', profileId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('apt_appointments')
      .select('id, prep_json, start_time')
      .eq('profile_id', profileId)
      .gte('start_time', new Date(Date.now() - MS_PER_DAY).toISOString())
      .lte('start_time', params.appointmentDate)
      .order('start_time', { ascending: false })
      .limit(1),
  ]);

  if (medsRes.error) {
    return { success: false, error: medsRes.error.message, code: medsRes.error.code };
  }
  if (factsRes.error) {
    return { success: false, error: factsRes.error.message, code: factsRes.error.code };
  }
  if (resultsRes.error) {
    return { success: false, error: resultsRes.error.message, code: resultsRes.error.code };
  }

  const meds = (medsRes.data ?? []) as Pick<Medication, 'id' | 'status' | 'updated_at'>[];
  const facts = (factsRes.data ?? []) as ProfileFact[];
  const recentResults = (resultsRes.data ?? []) as {
    id: string;
    created_at: string;
    status: string;
  }[];
  const currentAppointment = (appointmentRes.data ?? [])[0] as
    | { id: string; prep_json: VisitPrep | null; start_time: string }
    | undefined;

  const items: PreAppointmentCheckItem[] = [
    buildMedicationsItem(meds),
    buildAllergiesItem(facts),
    buildConditionsItem(facts),
    buildInsuranceItem(facts),
    buildCareTeamItem(facts, params.appointmentProvider),
    buildQuestionsItem(currentAppointment?.prep_json ?? null, currentAppointment?.id ?? null),
    buildDocumentsItem(recentResults),
  ];

  const completedCount = items.filter((i) => i.status === 'good').length;
  const totalCount = items.length;
  const isReady = items.every((i) => i.status === 'good');

  return {
    success: true,
    data: { isReady, items, completedCount, totalCount },
  };
}

// ── Individual check builders ─────────────────────────────────────────────

function buildMedicationsItem(
  meds: Pick<Medication, 'id' | 'status' | 'updated_at'>[],
): PreAppointmentCheckItem {
  const active = meds.filter((m) => m.status === 'active');

  if (active.length === 0) {
    return {
      id: 'medications',
      category: 'medications',
      title: 'No medications on file',
      detail: 'Make sure your doctor has a complete picture of what you take.',
      status: 'missing',
      actionLabel: 'Add your medications',
      actionRoute: '/(main)/medications',
    };
  }

  const mostRecentUpdate = active.reduce(
    (latest, m) => (m.updated_at > latest ? m.updated_at : latest),
    active[0].updated_at,
  );
  const daysStale = daysSince(mostRecentUpdate);

  if (daysStale >= MEDICATION_STALE_DAYS) {
    return {
      id: 'medications',
      category: 'medications',
      title: 'Your medication list may be outdated',
      detail: `Last updated ${daysStale} days ago — double-check before the visit.`,
      status: 'stale',
      actionLabel: 'Review medications',
      actionRoute: '/(main)/medications',
    };
  }

  return {
    id: 'medications',
    category: 'medications',
    title: 'Medications up to date',
    detail: `${active.length} active ${active.length === 1 ? 'medication' : 'medications'} on file.`,
    status: 'good',
  };
}

function buildAllergiesItem(facts: ProfileFact[]): PreAppointmentCheckItem {
  const allergies = facts.filter((f) => f.category === 'allergy');

  if (allergies.length === 0) {
    return {
      id: 'allergies',
      category: 'allergies',
      title: 'No allergies listed',
      detail: 'Make sure your doctor knows about any allergies — or confirm you have none.',
      status: 'missing',
      actionLabel: 'Add allergies',
      actionRoute: '/(main)/capture/voice',
    };
  }

  return {
    id: 'allergies',
    category: 'allergies',
    title: 'Allergies on file',
    detail: `${allergies.length} ${allergies.length === 1 ? 'allergy' : 'allergies'} documented.`,
    status: 'good',
  };
}

function buildConditionsItem(facts: ProfileFact[]): PreAppointmentCheckItem {
  const conditions = facts.filter((f) => f.category === 'condition');

  if (conditions.length === 0) {
    return {
      id: 'conditions',
      category: 'conditions',
      title: 'No conditions listed',
      detail: 'Add any ongoing conditions so your doctor has full context.',
      status: 'missing',
      actionLabel: 'Add conditions',
      actionRoute: '/(main)/capture/voice',
    };
  }

  return {
    id: 'conditions',
    category: 'conditions',
    title: 'Conditions on file',
    detail: `${conditions.length} ${conditions.length === 1 ? 'condition' : 'conditions'} documented.`,
    status: 'good',
  };
}

function buildInsuranceItem(facts: ProfileFact[]): PreAppointmentCheckItem {
  const insurance = facts.filter((f) => f.category === 'insurance');

  if (insurance.length === 0) {
    return {
      id: 'insurance',
      category: 'insurance',
      title: 'No insurance info',
      detail: 'Snap your insurance card before the visit so check-in goes smoothly.',
      status: 'missing',
      actionLabel: 'Add insurance',
      actionRoute: '/(main)/capture/camera',
    };
  }

  return {
    id: 'insurance',
    category: 'insurance',
    title: 'Insurance on file',
    detail: 'Insurance details are saved to your profile.',
    status: 'good',
  };
}

function buildCareTeamItem(
  facts: ProfileFact[],
  appointmentProvider: string | undefined,
): PreAppointmentCheckItem {
  const careTeam = facts.filter((f) => f.category === 'care_team');

  if (careTeam.length === 0) {
    return {
      id: 'care_team',
      category: 'care_team',
      title: 'No care team saved',
      detail: appointmentProvider
        ? `Add ${appointmentProvider} and any other providers to your care team.`
        : 'Track the providers you see so every record connects back to them.',
      status: 'action_needed',
      actionLabel: 'Add care team',
      actionRoute: '/(main)/capture/voice',
    };
  }

  return {
    id: 'care_team',
    category: 'care_team',
    title: 'Care team on file',
    detail: `${careTeam.length} ${careTeam.length === 1 ? 'provider' : 'providers'} saved.`,
    status: 'good',
  };
}

function buildQuestionsItem(
  prep: VisitPrep | null,
  appointmentId: string | null,
): PreAppointmentCheckItem {
  const visibleQuestions = (prep?.questions ?? []).filter((q) => !q.dismissed);

  if (visibleQuestions.length === 0) {
    return {
      id: 'questions',
      category: 'questions',
      title: 'Prepare your questions',
      detail: 'Write down what you want to ask — you get more out of the visit that way.',
      status: 'action_needed',
      actionLabel: 'Add questions',
      actionRoute: appointmentId ? `/(main)/appointments/${appointmentId}/plan` : undefined,
    };
  }

  return {
    id: 'questions',
    category: 'questions',
    title: 'Questions ready',
    detail: `${visibleQuestions.length} ${visibleQuestions.length === 1 ? 'question' : 'questions'} prepared for the visit.`,
    status: 'good',
  };
}

function buildDocumentsItem(
  recentResults: { id: string; created_at: string; status: string }[],
): PreAppointmentCheckItem {
  const withinWindow = recentResults.filter(
    (r) =>
      r.status !== 'archived' &&
      daysSince(r.created_at) <= RESULT_RECENT_DAYS,
  );

  if (withinWindow.length > 0) {
    return {
      id: 'documents',
      category: 'documents',
      title: 'Recent results available to share',
      detail: `${withinWindow.length} ${withinWindow.length === 1 ? 'result' : 'results'} from the last ${RESULT_RECENT_DAYS} days.`,
      status: 'good',
    };
  }

  return {
    id: 'documents',
    category: 'documents',
    title: 'Have documents to bring?',
    detail: 'Upload any recent results, paperwork, or reports the doctor should see.',
    status: 'action_needed',
    actionLabel: 'Upload document',
    actionRoute: '/(main)/capture/upload',
  };
}

// ── Briefing integration ──────────────────────────────────────────────────

export interface PreAppointmentBriefingItem {
  key: string;
  appointmentId: string;
  message: string;
  color: 'critical' | 'warning' | 'info';
  icon: string;
  sortRank: number;
  notReadyCount: number;
  totalCount: number;
}

/**
 * Produce pre-appointment briefing items for the Home screen. Surfaces any
 * appointment between now and +3 days where the profile isn't fully ready.
 *
 * Today → 'critical' (sort early); 1-3 days out → 'info' (sort later). Fully
 * ready appointments produce no briefing item — the check silently passes.
 */
export async function fetchPreAppointmentBriefingItems(
  profileId: string,
  householdId: string,
  max: number = 2,
): Promise<ServiceResult<PreAppointmentBriefingItem[]>> {
  const now = new Date();
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + 3);
  windowEnd.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from('apt_appointments')
    .select('id, title, provider_name, start_time, status')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .in('status', ['scheduled', 'preparing', 'ready'])
    .gte('start_time', now.toISOString())
    .lte('start_time', windowEnd.toISOString())
    .order('start_time', { ascending: true });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const upcoming = (data ?? []) as {
    id: string;
    title: string;
    provider_name: string | null;
    start_time: string;
  }[];

  const items: PreAppointmentBriefingItem[] = [];

  for (const apt of upcoming) {
    const checkResult = await runPreAppointmentCheck({
      profileId,
      householdId,
      appointmentDate: apt.start_time,
      appointmentProvider: apt.provider_name ?? undefined,
    });
    if (!checkResult.success) continue;
    if (checkResult.data.isReady) continue;

    const notReadyCount =
      checkResult.data.totalCount - checkResult.data.completedCount;
    const start = new Date(apt.start_time);
    const hoursUntil = (start.getTime() - Date.now()) / (1000 * 60 * 60);
    const isToday = hoursUntil <= 24 && start.getDate() === now.getDate();

    const providerLabel =
      apt.provider_name?.trim() || apt.title || 'your appointment';
    const whenLabel = isToday
      ? 'is today'
      : describeDaysUntil(apt.start_time);

    const message = isToday
      ? `Your appointment with ${providerLabel} ${whenLabel}. Quick profile check?`
      : `Appointment with ${providerLabel} ${whenLabel}. Is your profile ready?`;

    items.push({
      key: `pre_appt_${apt.id}`,
      appointmentId: apt.id,
      message,
      color: isToday ? 'critical' : 'info',
      icon: 'clipboard-outline',
      sortRank: isToday ? 2 : 10,
      notReadyCount,
      totalCount: checkResult.data.totalCount,
    });
  }

  items.sort((a, b) => a.sortRank - b.sortRank);
  return { success: true, data: items.slice(0, max) };
}

function describeDaysUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(ms / MS_PER_DAY);
  if (days <= 0) return 'is today';
  if (days === 1) return 'is tomorrow';
  return `in ${days} days`;
}
