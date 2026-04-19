import type { Appointment } from '@/lib/types/appointments';
import type { TodaysDose } from '@/lib/types/medications';
import type { Task } from '@/lib/types/tasks';
import type { PatientPriorities } from '@/lib/types/priorities';

export type BriefingLineTone = 'default' | 'warning' | 'critical' | 'success';

export interface BriefingLine {
  key: string;
  icon: string;
  tone: BriefingLineTone;
  text: string;
}

export interface DailyBriefing {
  greeting: string;
  /** Optional lead-in referencing the patient's stated priority. */
  leadIn: string | null;
  /** 1-3 lines of things happening today. */
  immediate: BriefingLine[];
  /** Optional single line describing the most important upcoming week item. */
  outlook: BriefingLine | null;
  /** Optional priority-area insight (one line). */
  priorityUpdate: BriefingLine | null;
  /** Optional encouragement (one line — only when earned). */
  encouragement: BriefingLine | null;
  /**
   * Optional low-priority prompt to refresh stale priorities. Surfaces when
   * patient_priorities has not been updated in 6+ months.
   */
  priorityStalePrompt: BriefingLine | null;
  /** True if nothing meaningful is in any bucket. */
  isQuiet: boolean;
}

const STALE_PRIORITY_DAYS = 180;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function isDueToday(due: string): boolean {
  const d = new Date(due);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isOverdue(due: string | null): boolean {
  if (!due) return false;
  return new Date(due) < new Date();
}

function daysUntil(iso: string): number {
  const now = Date.now();
  const then = new Date(iso).getTime();
  return Math.ceil((then - now) / MS_PER_DAY);
}

function formatAppointmentTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Synthesize a conversational daily briefing. Input is the same data used
 * by the existing bullet list on Home — the difference is this function
 * condenses it into narrative sections.
 */
export function buildDailyBriefing(input: {
  firstName: string | null;
  priorities: PatientPriorities | null;
  todaysDoses: TodaysDose[];
  upcomingAppointments: Appointment[];
  openTasks: Task[];
  completedThisWeek: number;
  streakDays: number;
  newMilestone: { title: string } | null;
}): DailyBriefing {
  const {
    firstName,
    priorities,
    todaysDoses,
    upcomingAppointments,
    openTasks,
    completedThisWeek,
    streakDays,
    newMilestone,
  } = input;

  const greeting = firstName
    ? `${getGreeting()}, ${firstName}`
    : getGreeting();

  // ── Lead-in from priorities ───────────────────────────────────────
  const leadIn = (() => {
    if (!priorities) return null;
    const topPriority = priorities.health_priorities.find(
      (p) => p.importance === 'high',
    );
    if (topPriority) {
      return `Here's your ${topPriority.topic} update:`;
    }
    const topCondition = priorities.conditions_of_focus[0];
    if (topCondition) {
      return `Keeping an eye on your ${topCondition}:`;
    }
    return null;
  })();

  // ── Immediate (today) ─────────────────────────────────────────────
  const immediate: BriefingLine[] = [];

  const scheduledDoses = todaysDoses.filter((d) => !d.medication.prn_flag);
  if (scheduledDoses.length > 0) {
    const taken = scheduledDoses.filter(
      (d) => d.adherenceToday === 'taken',
    ).length;
    const remaining = scheduledDoses.length - taken;
    if (remaining > 0) {
      immediate.push({
        key: 'meds-today',
        icon: 'medical',
        tone: 'default',
        text:
          remaining === 1
            ? 'You have 1 medication to take today'
            : `You have ${remaining} medications to take today`,
      });
    }
  }

  const apptsToday = upcomingAppointments.filter(
    (a) => isDueToday(a.start_time) && a.status !== 'completed',
  );
  if (apptsToday.length > 0) {
    const a = apptsToday[0];
    const provider = a.provider_name ?? a.title ?? 'your appointment';
    immediate.push({
      key: `appt-today-${a.id}`,
      icon: 'calendar',
      tone: 'default',
      text: `Your appointment with ${provider} is at ${formatAppointmentTime(a.start_time)}`,
    });
  }

  const activeTasks = openTasks.filter((t) => t.dependency_status !== 'blocked');
  const overdueCount = activeTasks.filter((t) => isOverdue(t.due_date)).length;
  const dueTodayCount = activeTasks.filter(
    (t) => t.due_date && isDueToday(t.due_date) && !isOverdue(t.due_date),
  ).length;
  if (overdueCount > 0) {
    immediate.push({
      key: 'tasks-overdue',
      icon: 'warning',
      tone: 'critical',
      text:
        overdueCount === 1
          ? '1 task is overdue'
          : `${overdueCount} tasks are overdue`,
    });
  } else if (dueTodayCount > 0) {
    immediate.push({
      key: 'tasks-today',
      icon: 'checkmark-circle',
      tone: 'default',
      text:
        dueTodayCount === 1
          ? '1 task needs attention today'
          : `${dueTodayCount} tasks need attention today`,
    });
  }

  // Cap at 3 lines — the briefing should feel scannable
  immediate.splice(3);

  // ── Outlook (this week) ────────────────────────────────────────────
  const outlook = (() => {
    const apptsThisWeek = upcomingAppointments.filter((a) => {
      const d = daysUntil(a.start_time);
      return d > 0 && d <= 7;
    });
    if (apptsThisWeek.length > 0 && apptsToday.length === 0) {
      const a = apptsThisWeek[0];
      const days = daysUntil(a.start_time);
      const provider = a.provider_name ?? a.title ?? 'appointment';
      return {
        key: `outlook-appt-${a.id}`,
        icon: 'calendar-outline',
        tone: 'default' as BriefingLineTone,
        text:
          days === 1
            ? `This week: ${provider} tomorrow`
            : `This week: ${provider} in ${days} days`,
      };
    }
    const upcomingTasks = activeTasks
      .filter((t) => {
        if (!t.due_date) return false;
        const d = daysUntil(t.due_date);
        return d > 0 && d <= 7;
      })
      .sort((a, b) => {
        const ad = a.due_date ? new Date(a.due_date).getTime() : 0;
        const bd = b.due_date ? new Date(b.due_date).getTime() : 0;
        return ad - bd;
      });
    if (upcomingTasks.length > 0) {
      return {
        key: `outlook-task-${upcomingTasks[0].id}`,
        icon: 'list-outline',
        tone: 'default' as BriefingLineTone,
        text: `This week: ${upcomingTasks[0].title}`,
      };
    }
    return null;
  })();

  // ── Priority-area update ──────────────────────────────────────────
  const priorityUpdate = (() => {
    if (!priorities) return null;
    const frictionCategories = new Set(
      priorities.friction_points.map((fp) => fp.category),
    );

    if (frictionCategories.has('medications')) {
      if (scheduledDoses.length === 0) {
        return null;
      }
      const allTaken = scheduledDoses.every(
        (d) => d.adherenceToday === 'taken',
      );
      return {
        key: 'priority-meds',
        icon: 'medical-outline',
        tone: 'default' as BriefingLineTone,
        text: allTaken
          ? 'All medications on track today'
          : `${scheduledDoses.length - scheduledDoses.filter((d) => d.adherenceToday === 'taken').length} medication doses still to take`,
      };
    }
    if (frictionCategories.has('appointments')) {
      const next = upcomingAppointments
        .filter((a) => a.start_time > new Date().toISOString())
        .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
      if (next) {
        return {
          key: 'priority-appt',
          icon: 'calendar-outline',
          tone: 'default' as BriefingLineTone,
          text: `Next appointment: ${new Date(next.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        };
      }
    }
    return null;
  })();

  // ── Stale priorities prompt ───────────────────────────────────────
  const priorityStalePrompt = (() => {
    if (!priorities) return null;
    const updatedMs = new Date(priorities.updated_at).getTime();
    if (!Number.isFinite(updatedMs)) return null;
    const daysStale = Math.floor((Date.now() - updatedMs) / MS_PER_DAY);
    if (daysStale < STALE_PRIORITY_DAYS) return null;
    const months = Math.floor(daysStale / 30);
    return {
      key: 'priority-stale',
      icon: 'refresh-outline',
      tone: 'default' as BriefingLineTone,
      text: `Your priorities were last updated ${months} months ago. Still accurate?`,
    };
  })();

  // ── Encouragement ──────────────────────────────────────────────────
  const encouragement = (() => {
    if (newMilestone) {
      return {
        key: 'enc-milestone',
        icon: 'trophy-outline',
        tone: 'success' as BriefingLineTone,
        text: `Milestone: ${newMilestone.title}`,
      };
    }
    if (streakDays >= 3) {
      return {
        key: 'enc-streak',
        icon: 'flame-outline',
        tone: 'success' as BriefingLineTone,
        text: `${streakDays}-day streak — you're on a roll`,
      };
    }
    if (completedThisWeek >= 4) {
      return {
        key: 'enc-week',
        icon: 'checkmark-done-outline',
        tone: 'success' as BriefingLineTone,
        text: `You completed ${completedThisWeek} tasks this week — nice work`,
      };
    }
    return null;
  })();

  const isQuiet =
    immediate.length === 0 &&
    !outlook &&
    !priorityUpdate &&
    !encouragement &&
    !priorityStalePrompt;

  return {
    greeting,
    leadIn,
    immediate,
    outlook,
    priorityUpdate,
    encouragement,
    priorityStalePrompt,
    isQuiet,
  };
}
