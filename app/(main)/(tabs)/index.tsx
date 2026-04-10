import { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { ProfileCard } from '@/components/modules/ProfileCard';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useTasks, useUpdateTaskStatus, useCreateTask } from '@/hooks/useTasks';
import { useAppointments } from '@/hooks/useAppointments';
import { useProactiveChecks } from '@/hooks/useProactiveChecks';
import { useWeeklyDigest } from '@/hooks/usePreferences';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { Task, ProactiveSuggestion } from '@/lib/types/tasks';
import { PRIORITY_ORDER } from '@/lib/types/tasks';
import {
  APPOINTMENT_TYPE_ICONS,
  APPOINTMENT_TYPE_LABELS,
  getPrepStatus,
} from '@/lib/types/appointments';
import type { VisitPrepStatus } from '@/lib/types/appointments';

const PREP_STATUS_LABELS: Record<VisitPrepStatus, string> = {
  not_started: 'Prep: Not started',
  draft: 'Prep: Draft',
  ready: 'Prep: Ready \u2713',
};

const PREP_STATUS_COLORS: Record<VisitPrepStatus, string> = {
  not_started: COLORS.text.tertiary,
  draft: COLORS.accent.dark,
  ready: COLORS.success.DEFAULT,
};

const NUDGE_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

const QUICK_ACTIONS = [
  { key: 'camera', icon: '\uD83D\uDCF7', label: 'Take\nPhoto', route: '/(main)/capture/camera' },
  { key: 'document', icon: '\uD83D\uDCC4', label: 'Add\nDocument', route: '/(main)/capture/upload' },
  { key: 'voice', icon: '\uD83C\uDFA4', label: 'Voice\nNote', route: '/(main)/capture/voice' },
  { key: 'task', icon: '\u2705', label: 'New\nTask', route: '/(main)/tasks/create' },
  { key: 'appointment', icon: '\uD83D\uDCC5', label: 'New\nAppointment', route: '/(main)/appointments/create' },
] as const;

const MAX_TODAY_ITEMS = 3;
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false;
  return new Date(task.due_date) < new Date();
}

function isDueWithinTwoWeeks(task: Task): boolean {
  if (!task.due_date) return true; // no due date = always relevant
  const dueTime = new Date(task.due_date).getTime();
  const cutoff = Date.now() + TWO_WEEKS_MS;
  return dueTime <= cutoff;
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays <= 7) return `In ${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: COLORS.error.DEFAULT,
  high: COLORS.tertiary.DEFAULT,
  medium: COLORS.accent.dark,
  low: COLORS.secondary.DEFAULT,
};

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(17, 0, 0, 0);
  return date.toISOString();
}

/** Group chained tasks by their parent_task_id or trigger_source prefix */
interface ChainGroup {
  id: string;
  chainName: string;
  tasks: Task[];
  completedCount: number;
  totalCount: number;
  nextStep: Task;
}

type TodayItem = { type: 'task'; task: Task } | { type: 'chain'; chain: ChainGroup };

function isMonday(): boolean {
  return new Date().getDay() === 1;
}

export default function HomeScreen() {
  const { activeProfile, activeProfileId, profiles, switchProfile } = useActiveProfile();
  const router = useRouter();

  const { data: openTasks } = useTasks(activeProfileId, {
    status: ['pending', 'in_progress'],
  });

  const { data: completedTasks } = useTasks(activeProfileId, {
    status: ['completed'],
  });

  const updateStatus = useUpdateTaskStatus();
  const createTaskMutation = useCreateTask();

  const nowIso = new Date().toISOString();

  // Show ALL non-cancelled appointments on the home screen so users always
  // see what's on file. We sort/split into upcoming vs. closeout below.
  const {
    data: allAppointments,
    isLoading: appointmentsLoading,
    error: appointmentsError,
  } = useAppointments(activeProfileId);

  // eslint-disable-next-line no-console
  console.log('[HomeScreen] appointments debug', {
    activeProfileId,
    enabled: !!activeProfileId,
    isLoading: appointmentsLoading,
    error: appointmentsError?.message,
    count: allAppointments?.length,
    appointments: allAppointments?.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      start_time: a.start_time,
    })),
  });

  const upcomingAppointments = (allAppointments ?? [])
    .filter(
      (a) =>
        (a.status === 'scheduled' ||
          a.status === 'preparing' ||
          a.status === 'ready') &&
        a.start_time >= nowIso,
    )
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  // Past appointments that still need a closeout decision (the visit time
  // has passed but status hasn't moved to completed/cancelled yet).
  const needsCloseoutAppointments = (allAppointments ?? [])
    .filter(
      (a) =>
        (a.status === 'scheduled' ||
          a.status === 'preparing' ||
          a.status === 'ready') &&
        a.start_time < nowIso,
    )
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const { suggestions, dismissSuggestion } = useProactiveChecks(activeProfileId);
  const { enabled: weeklyDigestEnabled } = useWeeklyDigest();

  // Build chain groups and individual tasks, filtered for "Today" view
  const { todayItems, chainGroups, overdueCount, totalOpen, remainingCount } = useMemo(() => {
    if (!openTasks) {
      return { todayItems: [] as TodayItem[], chainGroups: [] as ChainGroup[], overdueCount: 0, totalOpen: 0, remainingCount: 0 };
    }

    // Filter out blocked tasks and tasks due 2+ weeks from now
    const relevantTasks = openTasks.filter(
      (t) => t.dependency_status !== 'blocked' && isDueWithinTwoWeeks(t),
    );

    // Group chained tasks
    const chainMap = new Map<string, Task[]>();
    const individualTasks: Task[] = [];

    for (const task of relevantTasks) {
      if (task.parent_task_id) {
        const chainKey = task.parent_task_id;
        if (!chainMap.has(chainKey)) chainMap.set(chainKey, []);
        chainMap.get(chainKey)!.push(task);
      } else {
        // Check if this task IS a parent (has children in the list)
        const children = relevantTasks.filter((t) => t.parent_task_id === task.id);
        if (children.length > 0) {
          // This is a chain parent — it will be grouped with its children
          const chainKey = task.id;
          if (!chainMap.has(chainKey)) chainMap.set(chainKey, []);
          chainMap.get(chainKey)!.unshift(task);
        } else {
          individualTasks.push(task);
        }
      }
    }

    // Build chain groups
    const groups: ChainGroup[] = [];
    for (const [parentId, tasks] of chainMap) {
      const sorted = tasks.sort((a, b) => (a.chain_order ?? 0) - (b.chain_order ?? 0));
      const nextStep = sorted.find(
        (t) => t.status === 'pending' || t.status === 'in_progress',
      ) ?? sorted[0];
      const completedCount = sorted.filter((t) => t.status === 'completed').length;

      // Derive chain name from trigger_source
      const triggerSource = sorted[0]?.trigger_source ?? '';
      const chainName = triggerSource || `Action Plan`;

      groups.push({
        id: parentId,
        chainName,
        tasks: sorted,
        completedCount,
        totalCount: sorted.length,
        nextStep,
      });
    }

    // Sort: overdue first, then by priority
    const sortedIndividuals = [...individualTasks].sort((a, b) => {
      const aOverdue = isOverdue(a) ? 0 : 1;
      const bOverdue = isOverdue(b) ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    });

    const sortedChains = [...groups].sort((a, b) => {
      const aOverdue = isOverdue(a.nextStep) ? 0 : 1;
      const bOverdue = isOverdue(b.nextStep) ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      return PRIORITY_ORDER[a.nextStep.priority] - PRIORITY_ORDER[b.nextStep.priority];
    });

    // Merge into a combined list of "today items" (chains count as 1 item each)
    const combined: TodayItem[] = [];

    let iIdx = 0;
    let cIdx = 0;

    while (combined.length < MAX_TODAY_ITEMS && (iIdx < sortedIndividuals.length || cIdx < sortedChains.length)) {
      const nextIndividual = sortedIndividuals[iIdx];
      const nextChain = sortedChains[cIdx];

      if (!nextChain) {
        combined.push({ type: 'task', task: nextIndividual });
        iIdx++;
      } else if (!nextIndividual) {
        combined.push({ type: 'chain', chain: nextChain });
        cIdx++;
      } else {
        // Compare priority
        const iPri = PRIORITY_ORDER[nextIndividual.priority];
        const cPri = PRIORITY_ORDER[nextChain.nextStep.priority];
        const iOver = isOverdue(nextIndividual) ? 0 : 1;
        const cOver = isOverdue(nextChain.nextStep) ? 0 : 1;

        if (iOver < cOver || (iOver === cOver && iPri <= cPri)) {
          combined.push({ type: 'task', task: nextIndividual });
          iIdx++;
        } else {
          combined.push({ type: 'chain', chain: nextChain });
          cIdx++;
        }
      }
    }

    const totalRemaining =
      (sortedIndividuals.length - iIdx) + (sortedChains.length - cIdx);

    return {
      todayItems: combined,
      chainGroups: groups,
      overdueCount: openTasks.filter(isOverdue).length,
      totalOpen: openTasks.length,
      remainingCount: totalRemaining,
    };
  }, [openTasks]);

  // Weekly digest stats
  const weeklyStats = useMemo(() => {
    if (!completedTasks || !openTasks) return null;

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const completedThisWeek = completedTasks.filter(
      (t) => t.completed_at && new Date(t.completed_at) >= weekAgo,
    ).length;

    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
    const upcomingThisWeek = openTasks.filter(
      (t) => t.due_date && new Date(t.due_date) <= endOfWeek,
    ).length;

    return {
      completedThisWeek,
      upcomingThisWeek,
      overdueCount,
    };
  }, [completedTasks, openTasks, overdueCount]);

  const handleAddSuggestion = (suggestion: ProactiveSuggestion) => {
    if (!activeProfileId) return;

    createTaskMutation.mutate(
      {
        profile_id: activeProfileId,
        title: suggestion.title,
        description: suggestion.description,
        priority: suggestion.priority,
        due_date: suggestion.due_days !== undefined ? addDays(suggestion.due_days) : undefined,
        trigger_type: 'proactive',
        trigger_source: suggestion.trigger_source,
        context_json: suggestion.context_json,
      },
      {
        onSuccess: () => dismissSuggestion(suggestion.id),
      },
    );
  };

  function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  const todayCount = useMemo(() => {
    if (!openTasks) return 0;
    return openTasks.filter((t) => {
      if (t.dependency_status === 'blocked') return false;
      if (!t.due_date) return false;
      const due = new Date(t.due_date);
      const today = new Date();
      return (
        due.getDate() === today.getDate() &&
        due.getMonth() === today.getMonth() &&
        due.getFullYear() === today.getFullYear()
      ) || isOverdue({ ...t });
    }).length;
  }, [openTasks]);

  return (
    <ScreenLayout>
      {/* Header with greeting */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.profileName}>
          {activeProfile?.display_name ?? 'User'}
        </Text>
        <Text style={styles.tagline}>Your care. In your hands.</Text>
      </View>

      {/* Profile Switcher (horizontal scroll) */}
      {profiles.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Profiles</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.profileScroll}
          >
            {profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                isActive={profile.id === activeProfileId}
                onPress={() => switchProfile(profile.id)}
                compact
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Weekly Digest Card — shown on Mondays when enabled */}
      {isMonday() && weeklyDigestEnabled && weeklyStats && (
        <View style={styles.section}>
          <Card style={styles.digestCard}>
            <Text style={styles.digestTitle}>Weekly Summary</Text>
            <Text style={styles.digestBody}>
              {weeklyStats.completedThisWeek} tasks completed, {weeklyStats.upcomingThisWeek} upcoming this week
              {weeklyStats.overdueCount > 0
                ? `, ${weeklyStats.overdueCount} overdue`
                : ''}
            </Text>
          </Card>
        </View>
      )}

      {/* Today Section — calm summary + max 3 items */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>Today</Text>
          {totalOpen > 0 && (
            <TouchableOpacity onPress={() => router.push('/(main)/(tabs)/tasks')}>
              <Text style={styles.seeAll}>All tasks ({totalOpen})</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Calm summary line */}
        {todayCount === 0 && overdueCount === 0 ? (
          <View style={styles.calmBanner}>
            <Text style={styles.calmText}>All caught up! Nothing due today.</Text>
          </View>
        ) : (
          <View style={overdueCount > 0 ? styles.urgentBanner : styles.statusBanner}>
            <Text style={overdueCount > 0 ? styles.urgentText : styles.statusText}>
              {overdueCount > 0
                ? `${overdueCount} overdue. `
                : ''}
              {todayCount > 0
                ? `You have ${todayCount} ${todayCount === 1 ? 'item' : 'items'} for today.`
                : overdueCount > 0
                  ? 'Catch up on overdue items.'
                  : ''}
            </Text>
          </View>
        )}

        {/* Today items — max 3 */}
        {todayItems.map((item) => {
          if (item.type === 'chain') {
            const { chain } = item;
            const overdue = isOverdue(chain.nextStep);
            return (
              <Card
                key={`chain-${chain.id}`}
                onPress={() => router.push(`/(main)/tasks/${chain.nextStep.id}`)}
                style={styles.taskCard}
              >
                <View style={styles.taskRow}>
                  <TouchableOpacity
                    style={styles.taskCheck}
                    onPress={() =>
                      updateStatus.mutate({ taskId: chain.nextStep.id, status: 'completed' })
                    }
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <View style={styles.taskCheckCircle} />
                  </TouchableOpacity>
                  <View style={styles.taskContent}>
                    <Text style={styles.chainName} numberOfLines={1}>
                      {chain.chainName}
                    </Text>
                    <Text style={styles.taskTitle} numberOfLines={1}>
                      Step {chain.completedCount + 1} of {chain.totalCount}: {chain.nextStep.title}
                    </Text>
                    <View style={styles.taskMetaRow}>
                      {/* Progress bar */}
                      <View style={styles.progressBar}>
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${(chain.completedCount / chain.totalCount) * 100}%` },
                          ]}
                        />
                      </View>
                      {chain.nextStep.due_date && (
                        <Text
                          style={[styles.taskDue, overdue && styles.taskDueOverdue]}
                        >
                          {formatDueDate(chain.nextStep.due_date)}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              </Card>
            );
          }

          // Individual task
          const { task } = item;
          const overdue = isOverdue(task);
          return (
            <Card
              key={task.id}
              onPress={() => router.push(`/(main)/tasks/${task.id}`)}
              style={overdue ? { ...styles.taskCard, ...styles.taskCardOverdue } : styles.taskCard}
            >
              <View style={styles.taskRow}>
                <TouchableOpacity
                  style={styles.taskCheck}
                  onPress={() =>
                    updateStatus.mutate({ taskId: task.id, status: 'completed' })
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <View
                    style={[
                      styles.taskCheckCircle,
                      overdue && styles.taskCheckCircleOverdue,
                    ]}
                  />
                </TouchableOpacity>
                <View style={styles.taskContent}>
                  <Text style={styles.taskTitle} numberOfLines={1}>
                    {task.title}
                  </Text>
                  <View style={styles.taskMetaRow}>
                    {task.due_date && (
                      <Text
                        style={[styles.taskDue, overdue && styles.taskDueOverdue]}
                      >
                        {formatDueDate(task.due_date)}
                      </Text>
                    )}
                    {task.trigger_source && (
                      <Text style={styles.taskSource} numberOfLines={1}>
                        {task.trigger_source}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            </Card>
          );
        })}

        {/* "and X more" link */}
        {remainingCount > 0 && (
          <TouchableOpacity
            style={styles.moreLink}
            onPress={() => router.push('/(main)/(tabs)/tasks')}
          >
            <Text style={styles.moreLinkText}>
              and {remainingCount} more {remainingCount === 1 ? 'item' : 'items'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Upcoming Appointments — always rendered (loading / empty / list) */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>Upcoming Appointments</Text>
          <TouchableOpacity onPress={() => router.push('/(main)/appointments')}>
            <Text style={styles.seeAll}>See all</Text>
          </TouchableOpacity>
        </View>
        {appointmentsError ? (
          <Card>
            <Text style={styles.emptyApptText}>
              Couldn’t load appointments: {appointmentsError.message}
            </Text>
          </Card>
        ) : appointmentsLoading && !allAppointments ? (
          <Card>
            <Text style={styles.emptyApptText}>Loading appointments…</Text>
          </Card>
        ) : upcomingAppointments.length === 0 ? (
          <Card>
            <Text style={styles.emptyApptText}>No upcoming appointments</Text>
            <TouchableOpacity
              style={styles.emptyApptButton}
              onPress={() => router.push('/(main)/appointments/create')}
            >
              <Text style={styles.emptyApptButtonText}>Schedule one</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          upcomingAppointments.slice(0, 2).map((apt) => {
            const aptDate = new Date(apt.start_time);
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const target = new Date(aptDate.getFullYear(), aptDate.getMonth(), aptDate.getDate());
            const diffDays = Math.round(
              (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
            );
            const time = aptDate.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            });
            const dateLabel =
              diffDays === 0
                ? `Today, ${time}`
                : diffDays === 1
                  ? `Tomorrow, ${time}`
                  : diffDays > 0 && diffDays <= 7
                    ? `${aptDate.toLocaleDateString('en-US', { weekday: 'long' })}, ${time}`
                    : `${aptDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
            const aptPrepStatus = getPrepStatus(apt.prep_json);
            const aptPrepColor = PREP_STATUS_COLORS[aptPrepStatus];
            const visiblePrepQuestions = apt.prep_json
              ? apt.prep_json.questions.filter((q) => !q.dismissed).length
              : 0;
            const msUntilVisit = aptDate.getTime() - Date.now();
            const showNudge = msUntilVisit > 0 && msUntilVisit <= NUDGE_WINDOW_MS;

            const providerLabel =
              apt.provider_name ?? `your ${APPOINTMENT_TYPE_LABELS[apt.appointment_type].toLowerCase()}`;
            const daysUntil = Math.max(1, Math.ceil(msUntilVisit / (1000 * 60 * 60 * 24)));
            const daysLabel =
              daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;

            let nudgeText: string | null = null;
            let nudgeButtonLabel: string | null = null;
            if (showNudge && aptPrepStatus === 'not_started') {
              nudgeText = `Your visit with ${providerLabel} is ${daysLabel} — ready to prepare?`;
              nudgeButtonLabel = 'Start Prep';
            } else if (showNudge && aptPrepStatus === 'draft') {
              nudgeText = `Visit prep in progress — ${visiblePrepQuestions} question${visiblePrepQuestions === 1 ? '' : 's'} added`;
              nudgeButtonLabel = 'Continue';
            } else if (showNudge && aptPrepStatus === 'ready') {
              nudgeText = 'Visit prep ready \u2713';
              nudgeButtonLabel = 'Review';
            }

            return (
              <View key={apt.id}>
                <Card
                  onPress={() => router.push(`/(main)/appointments/${apt.id}`)}
                  style={styles.appointmentRow}
                >
                  <View style={styles.appointmentRowInner}>
                    <Text style={styles.appointmentRowIcon}>
                      {APPOINTMENT_TYPE_ICONS[apt.appointment_type]}
                    </Text>
                    <View style={styles.appointmentRowContent}>
                      <Text style={styles.appointmentRowTitle} numberOfLines={1}>
                        {apt.title}
                      </Text>
                      <Text style={styles.appointmentRowMeta} numberOfLines={1}>
                        {dateLabel}
                        {apt.provider_name ? ` \u2022 ${apt.provider_name}` : ''}
                      </Text>
                      <Text style={[styles.prepStatusInline, { color: aptPrepColor }]}>
                        {PREP_STATUS_LABELS[aptPrepStatus]}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>{'\u203A'}</Text>
                  </View>
                </Card>
                {nudgeText && (
                  <Card style={styles.nudgeCard}>
                    <Text style={styles.nudgeText}>{nudgeText}</Text>
                    <TouchableOpacity
                      style={styles.nudgeButton}
                      onPress={() =>
                        router.push(`/(main)/appointments/${apt.id}/plan`)
                      }
                    >
                      <Text style={styles.nudgeButtonText}>
                        {nudgeButtonLabel}
                      </Text>
                    </TouchableOpacity>
                  </Card>
                )}
              </View>
            );
          })
        )}
      </View>

      {/* Post-visit prompt — appears for any appointment whose start time has
          passed but which hasn't been closed out yet. */}
      {needsCloseoutAppointments.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>How did it go?</Text>
          {needsCloseoutAppointments.slice(0, 3).map((apt) => (
            <Card key={`closeout-${apt.id}`} style={styles.closeoutCard}>
              <Text style={styles.closeoutTitle}>
                How did your visit with {apt.provider_name ?? apt.title} go?
              </Text>
              <Text style={styles.closeoutMeta}>
                {new Date(apt.start_time).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
                {' \u2022 '}
                {APPOINTMENT_TYPE_LABELS[apt.appointment_type]}
              </Text>
              <View style={styles.closeoutActions}>
                <TouchableOpacity
                  style={styles.closeoutPrimary}
                  onPress={() => router.push(`/(main)/appointments/${apt.id}/closeout`)}
                >
                  <Text style={styles.closeoutPrimaryText}>Start Closeout</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.closeoutSecondary}
                  onPress={() => router.push(`/(main)/appointments/${apt.id}/closeout`)}
                >
                  <Text style={styles.closeoutSecondaryText}>
                    Didn’t happen / Reschedule
                  </Text>
                </TouchableOpacity>
              </View>
            </Card>
          ))}
        </View>
      )}

      {/* Suggested Actions — proactive suggestions */}
      {suggestions.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Suggested Actions</Text>
          </View>
          {suggestions.slice(0, 3).map((suggestion) => (
            <Card key={suggestion.id} style={styles.suggestionCard}>
              <View style={styles.suggestionContent}>
                <View style={styles.suggestionHeader}>
                  <View
                    style={[
                      styles.suggestionPriority,
                      { backgroundColor: (PRIORITY_COLORS[suggestion.priority] || COLORS.secondary.DEFAULT) + '1A' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.suggestionPriorityText,
                        { color: PRIORITY_COLORS[suggestion.priority] || COLORS.secondary.DEFAULT },
                      ]}
                    >
                      {suggestion.priority}
                    </Text>
                  </View>
                  <Text style={styles.suggestionTrigger}>{suggestion.trigger_source}</Text>
                </View>
                <Text style={styles.suggestionTitle}>{suggestion.title}</Text>
                <Text style={styles.suggestionDesc} numberOfLines={2}>
                  {suggestion.description}
                </Text>
                <View style={styles.suggestionActions}>
                  <TouchableOpacity
                    style={styles.suggestionAddButton}
                    onPress={() => handleAddSuggestion(suggestion)}
                  >
                    <Text style={styles.suggestionAddText}>Add to Tasks</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.suggestionDismissButton}
                    onPress={() => dismissSuggestion(suggestion.id)}
                  >
                    <Text style={styles.suggestionDismissText}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Card>
          ))}
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {QUICK_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.key}
              style={styles.actionButton}
              activeOpacity={0.7}
              onPress={() => {
                if (action.route) {
                  router.push(action.route as string);
                }
              }}
            >
              <View style={styles.actionIconWrap}>
                <Text style={styles.actionIcon}>{action.icon}</Text>
              </View>
              <Text style={styles.actionLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Profile Snapshot Card */}
      {activeProfile && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Health Profile</Text>
          <Card
            onPress={() => router.push(`/(main)/profile/${activeProfileId}`)}
          >
            <View style={styles.profileSnapshotRow}>
              <View style={styles.profileSnapshotAvatar}>
                <Text style={styles.profileSnapshotInitials}>
                  {activeProfile.display_name
                    .split(' ')
                    .map((p) => p[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)}
                </Text>
              </View>
              <View style={styles.profileSnapshotInfo}>
                <Text style={styles.profileSnapshotName}>
                  {activeProfile.display_name}
                </Text>
                <Text style={styles.profileSnapshotSub}>
                  Tap to view full health profile
                </Text>
              </View>
              <Text style={styles.chevron}>{'\u203A'}</Text>
            </View>
          </Card>
        </View>
      )}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 8,
    paddingBottom: 20,
  },
  greeting: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  profileName: {
    fontSize: FONT_SIZES['3xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
    marginTop: 2,
  },
  tagline: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  seeAll: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 12,
  },
  // Calm / status banners
  calmBanner: {
    backgroundColor: COLORS.success.light,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  calmText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.success.DEFAULT,
  },
  statusBanner: {
    backgroundColor: COLORS.primary.DEFAULT + '0D',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  statusText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.primary.DEFAULT,
  },
  urgentBanner: {
    backgroundColor: COLORS.error.light,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  urgentText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.error.DEFAULT,
  },
  // Digest card
  digestCard: {
    backgroundColor: COLORS.primary.DEFAULT + '0A',
    borderColor: COLORS.primary.DEFAULT + '20',
    borderWidth: 1,
  },
  digestTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 4,
  },
  digestBody: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  // Task cards
  taskCard: {
    marginBottom: 6,
    padding: 12,
  },
  taskCardOverdue: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.error.DEFAULT,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskCheck: {
    marginRight: 12,
  },
  taskCheckCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.border.dark,
  },
  taskCheckCircleOverdue: {
    borderColor: COLORS.error.DEFAULT,
  },
  taskContent: {
    flex: 1,
  },
  chainName: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.accent.dark,
    marginBottom: 2,
  },
  taskTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  taskMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  taskDue: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  taskDueOverdue: {
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  taskSource: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
    flex: 1,
  },
  // Progress bar for chains
  progressBar: {
    height: 4,
    width: 60,
    borderRadius: 2,
    backgroundColor: COLORS.border.DEFAULT,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.success.DEFAULT,
  },
  // More link
  moreLink: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  moreLinkText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.primary.DEFAULT,
  },
  // Suggestion cards
  suggestionCard: {
    marginBottom: 8,
  },
  suggestionContent: {},
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  suggestionPriority: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 8,
  },
  suggestionPriorityText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'capitalize',
  },
  suggestionTrigger: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
  },
  suggestionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  suggestionDesc: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
    marginBottom: 10,
  },
  suggestionActions: {
    flexDirection: 'row',
    gap: 10,
  },
  suggestionAddButton: {
    backgroundColor: COLORS.primary.DEFAULT + '15',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  suggestionAddText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  suggestionDismissButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  suggestionDismissText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.tertiary,
  },
  // Profile & quick actions
  profileScroll: {
    marginHorizontal: -4,
  },
  actionsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  actionIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionIcon: {
    fontSize: 24,
  },
  actionLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 16,
  },
  profileSnapshotRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileSnapshotAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileSnapshotInitials: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
  },
  profileSnapshotInfo: {
    flex: 1,
    marginLeft: 12,
  },
  profileSnapshotName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  profileSnapshotSub: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  chevron: {
    fontSize: FONT_SIZES['2xl'],
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  // Upcoming appointments
  emptyApptText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 8,
  },
  emptyApptButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  emptyApptButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  appointmentRow: {
    marginBottom: 8,
  },
  appointmentRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appointmentRowIcon: {
    fontSize: 26,
    marginRight: 12,
  },
  appointmentRowContent: {
    flex: 1,
  },
  appointmentRowTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  appointmentRowMeta: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  prepStatusInline: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  nudgeCard: {
    marginTop: 6,
    marginBottom: 12,
    backgroundColor: COLORS.primary.DEFAULT + '0F',
    borderColor: COLORS.primary.DEFAULT + '33',
    borderWidth: 1,
  },
  nudgeText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  nudgeButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.primary.DEFAULT,
    borderRadius: 8,
  },
  nudgeButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
  // Post-visit closeout prompt
  closeoutCard: {
    marginBottom: 10,
    backgroundColor: COLORS.accent.dark + '0F',
    borderColor: COLORS.accent.dark + '33',
    borderWidth: 1,
  },
  closeoutTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  closeoutMeta: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 4,
  },
  closeoutActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  closeoutPrimary: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeoutPrimaryText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
  closeoutSecondary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  closeoutSecondaryText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
});
