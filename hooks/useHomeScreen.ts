/**
 * Home screen hooks — power the redesigned 4-zone Home.
 *
 * useTodayCard()        → the single most-important "what now?" item
 * useNeedsAttention()   → top-N attention items via the aggregator service
 *
 * Both refresh when the Home tab regains focus so the data feels live.
 */

import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { useActiveProfile } from './useActiveProfile';
import { useTasks } from './useTasks';
import { useAppointments } from './useAppointments';
import { useTodaysDoses, useRefillStatus } from './useMedications';
import { usePostVisitBriefing } from './usePostVisitCapture';
import { usePreAppointmentBriefing } from './usePreAppointmentCheck';
import { usePreventiveBriefing, usePreventiveItems } from './usePreventive';
import { useDataQualityBriefing } from './useDataQuality';
import { useCaregiverEnrichmentPrompts, useIsCaregiverForProfile } from './useCaregiverEnrichment';
import { useSmartEnrichment } from './useSmartEnrichment';
import { usePatientPriorities } from './usePatientPriorities';
import { useLifeEventStore } from '@/stores/lifeEventStore';
import { useWellnessVisitStore } from '@/stores/wellnessVisitStore';
import { WELLNESS_STEPS } from '@/lib/types/wellnessVisit';
import {
  buildNeedsAttention,
  countNeedsAttention,
  type NeedsAttentionItem,
} from '@/services/needsAttention';
import { COLORS } from '@/lib/constants/colors';
import type { Appointment } from '@/lib/types/appointments';
import type { Task } from '@/lib/types/tasks';

// ── TodayCard ──────────────────────────────────────────────────────────────

export type TodayCardKind =
  | 'appointment'
  | 'medications'
  | 'tasks'
  | 'wellness_prep'
  | 'all_clear';

export interface TodayCardData {
  kind: TodayCardKind;
  title: string;
  detail: string | null;
  icon: string;
  /** Left accent bar color. */
  accentColor: string;
  actionLabel: string | null;
  /** Navigation route — undefined if no action. */
  route?: string;
  routeParams?: Record<string, string>;
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

function isOverdueIso(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso) < new Date();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  const time = formatTime(iso);
  if (diff === 0) return `at ${time} today`;
  if (diff === 1) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'long' })} at ${time}`;
}

function pickTodayAppointment(
  appointments: Appointment[] | undefined,
): Appointment | null {
  const nowIso = new Date().toISOString();
  return (
    (appointments ?? [])
      .filter(
        (a) =>
          (a.status === 'scheduled' ||
            a.status === 'preparing' ||
            a.status === 'ready') &&
          isToday(a.start_time) &&
          a.start_time >= nowIso,
      )
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() -
          new Date(b.start_time).getTime(),
      )[0] ?? null
  );
}

export function useTodayCard(): TodayCardData {
  const { activeProfileId } = useActiveProfile();
  const { data: appointments } = useAppointments(activeProfileId);
  const { data: todaysDoses } = useTodaysDoses(activeProfileId);
  const { data: openTasks } = useTasks(activeProfileId, {
    status: ['pending', 'in_progress'],
  });

  const wellnessHydrated = useWellnessVisitStore((s) => s.hydrated);
  const wellnessHydrate = useWellnessVisitStore((s) => s.hydrate);
  const wellnessStepsCompleted = useWellnessVisitStore((s) => s.stepsCompleted);
  const wellnessPacketGenerated = useWellnessVisitStore(
    (s) => s.packetGenerated,
  );
  const wellnessFreeformLen = useWellnessVisitStore(
    (s) => s.freeformInput.length,
  );
  const wellnessSelectedCount = useWellnessVisitStore(
    (s) => s.selectedScreenings.length,
  );
  const wellnessQuestionCount = useWellnessVisitStore((s) => s.questions.length);

  // Hydrate the wellness store on focus so step state is fresh.
  useFocusEffect(
    useCallback(() => {
      if (!wellnessHydrated) void wellnessHydrate();
    }, [wellnessHydrated, wellnessHydrate]),
  );

  return useMemo<TodayCardData>(() => {
    // 1) Today's appointment beats everything else.
    const todayAppt = pickTodayAppointment(appointments);
    if (todayAppt) {
      const provider = todayAppt.provider_name?.trim() || 'your provider';
      return {
        kind: 'appointment',
        title: `Appointment with ${provider}`,
        detail: formatRelative(todayAppt.start_time),
        icon: 'calendar',
        accentColor: COLORS.primary.DEFAULT,
        actionLabel: 'View',
        route: `/(main)/appointments/${todayAppt.id}`,
      };
    }

    // 2) Untaken scheduled doses.
    const scheduled = (todaysDoses ?? []).filter((d) => !d.medication.prn_flag);
    const remaining = scheduled.filter((d) => d.adherenceToday !== 'taken');
    if (scheduled.length > 0 && remaining.length > 0) {
      return {
        kind: 'medications',
        title:
          remaining.length === 1
            ? '1 medication to take'
            : `${remaining.length} medications to take`,
        detail:
          scheduled.length > remaining.length
            ? `${scheduled.length - remaining.length} of ${scheduled.length} taken`
            : 'Tap to log doses',
        icon: 'medical',
        accentColor: COLORS.accent.dark,
        actionLabel: 'Take',
        route: '/(main)/today',
      };
    }

    // 3) Critical/overdue tasks for today.
    const activeTasks = (openTasks ?? []).filter(
      (t: Task) => t.dependency_status !== 'blocked',
    );
    const overdue = activeTasks.filter((t) => isOverdueIso(t.due_date));
    const dueToday = activeTasks.filter(
      (t) => isToday(t.due_date) && !isOverdueIso(t.due_date),
    );
    const attention = overdue.length + dueToday.length;
    if (attention > 0) {
      return {
        kind: 'tasks',
        title:
          attention === 1
            ? '1 task needs attention today'
            : `${attention} tasks need attention today`,
        detail:
          overdue.length > 0
            ? `${overdue.length} overdue`
            : `${dueToday.length} due today`,
        icon: 'checkmark-circle',
        accentColor:
          overdue.length > 0 ? COLORS.error.DEFAULT : COLORS.accent.dark,
        actionLabel: 'View',
        route: '/(main)/(tabs)/activity',
      };
    }

    // 4) Wellness prep in progress (not yet packetized).
    const wellnessCompletedCount = Object.values(wellnessStepsCompleted).filter(
      Boolean,
    ).length;
    const wellnessStarted =
      wellnessCompletedCount > 0 ||
      wellnessFreeformLen > 0 ||
      wellnessSelectedCount > 0 ||
      wellnessQuestionCount > 0;
    if (wellnessStarted && !wellnessPacketGenerated) {
      return {
        kind: 'wellness_prep',
        title: 'Continue your wellness visit prep',
        detail: `${wellnessCompletedCount} of ${WELLNESS_STEPS.length} steps complete`,
        icon: 'clipboard',
        accentColor: COLORS.primary.DEFAULT,
        actionLabel: 'Continue',
        route: '/(main)/preventive/wellness-visit',
      };
    }

    // 5) All clear.
    return {
      kind: 'all_clear',
      title: 'All clear today',
      detail: 'Nothing urgent. Enjoy your day.',
      icon: 'checkmark-circle',
      accentColor: COLORS.success.DEFAULT,
      actionLabel: null,
    };
  }, [
    appointments,
    todaysDoses,
    openTasks,
    wellnessStepsCompleted,
    wellnessPacketGenerated,
    wellnessFreeformLen,
    wellnessSelectedCount,
    wellnessQuestionCount,
  ]);
}

// ── NeedsAttention ─────────────────────────────────────────────────────────

const PRIORITIES_INVITE_DISMISS_KEY =
  'home.priorities_invite_dismissed_until';
const PRIORITIES_DISMISS_DAYS = 7;

async function readPrioritiesDismissed(): Promise<Date | null> {
  if (Platform.OS === 'web') {
    try {
      const stored =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(PRIORITIES_INVITE_DISMISS_KEY)
          : null;
      if (!stored) return null;
      const d = new Date(stored);
      return Number.isFinite(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  try {
    const stored = await SecureStore.getItemAsync(
      PRIORITIES_INVITE_DISMISS_KEY,
    );
    if (!stored) return null;
    const d = new Date(stored);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

async function writePrioritiesDismissed(iso: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PRIORITIES_INVITE_DISMISS_KEY, iso);
      }
    } catch {
      /* best-effort */
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(PRIORITIES_INVITE_DISMISS_KEY, iso);
  } catch {
    /* best-effort */
  }
}

interface UseNeedsAttentionResult {
  items: NeedsAttentionItem[];
  totalCount: number;
  dismissPriorities: () => Promise<void>;
}

export function useNeedsAttention(maxItems: number = 3): UseNeedsAttentionResult {
  const queryClient = useQueryClient();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const householdId = activeProfile?.household_id ?? null;

  const { data: postVisit } = usePostVisitBriefing(activeProfileId, 3);
  const { data: preAppointment } = usePreAppointmentBriefing(
    activeProfileId,
    householdId,
    2,
  );
  const { data: preventive } = usePreventiveBriefing(activeProfileId, 3);
  const { data: refills } = useRefillStatus(activeProfileId);
  const { data: priorities } = usePatientPriorities(activeProfileId);
  const { data: openTasks } = useTasks(activeProfileId, {
    status: ['pending', 'in_progress'],
  });
  // Fired so the wellness/preventive lookups stay warm; not consumed here.
  void usePreventiveItems(activeProfileId);

  const dataQuality = useDataQualityBriefing(activeProfileId, householdId);

  const { data: isCaregiver } = useIsCaregiverForProfile(activeProfileId);
  const { data: caregiverPrompts } = useCaregiverEnrichmentPrompts(
    isCaregiver ? activeProfileId : null,
    householdId,
    2,
  );

  const { topNudge } = useSmartEnrichment(activeProfileId, householdId);

  const lifeEventPrompts = useLifeEventStore((s) => s.pendingPrompts);
  const profileLifeEvents = useMemo(
    () =>
      activeProfileId
        ? lifeEventPrompts.filter((p) => p.profileId === activeProfileId)
        : [],
    [lifeEventPrompts, activeProfileId],
  );

  const [prioritiesDismissed, setPrioritiesDismissed] = useState<boolean>(false);

  // Refresh dismissal state + briefings whenever Home regains focus.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const until = await readPrioritiesDismissed();
        if (cancelled) return;
        setPrioritiesDismissed(until !== null && until.getTime() > Date.now());
      })();

      // Best-effort re-fetch — keeps post-visit / pre-appointment fresh
      // when the user returns from another screen.
      if (activeProfileId) {
        queryClient.invalidateQueries({
          queryKey: ['appointments', 'postVisitBriefing', activeProfileId],
        });
        queryClient.invalidateQueries({
          queryKey: ['preAppointmentBriefing', activeProfileId],
        });
      }
      return () => {
        cancelled = true;
      };
    }, [activeProfileId, queryClient]),
  );

  const dismissPriorities = useCallback(async () => {
    const until = new Date(
      Date.now() + PRIORITIES_DISMISS_DAYS * 24 * 60 * 60 * 1000,
    );
    setPrioritiesDismissed(true);
    await writePrioritiesDismissed(until.toISOString());
  }, []);

  const buildParams = useMemo(
    () => ({
      postVisit: postVisit ?? null,
      preAppointment: preAppointment ?? null,
      preventive: preventive ?? null,
      topNudge,
      dataQuality,
      caregiverPrompts: caregiverPrompts ?? null,
      refills: refills ?? null,
      lifeEventPrompts: profileLifeEvents,
      profileId: activeProfileId ?? '',
      patientPriorities: priorities ?? null,
      openTaskCount: openTasks?.length ?? 0,
      prioritiesDismissed,
    }),
    [
      postVisit,
      preAppointment,
      preventive,
      topNudge,
      dataQuality,
      caregiverPrompts,
      refills,
      profileLifeEvents,
      activeProfileId,
      priorities,
      openTasks,
      prioritiesDismissed,
    ],
  );

  const items = useMemo(
    () => (activeProfileId ? buildNeedsAttention(buildParams, maxItems) : []),
    [activeProfileId, buildParams, maxItems],
  );

  const totalCount = useMemo(
    () => (activeProfileId ? countNeedsAttention(buildParams) : 0),
    [activeProfileId, buildParams],
  );

  return { items, totalCount, dismissPriorities };
}
