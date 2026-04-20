import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAuth } from '@/hooks/useAuth';
import { useUpdateTaskStatus } from '@/hooks/useTasks';
import {
  usePatientPriorities,
  useImplicitSignalRefresh,
} from '@/hooks/usePatientPriorities';
import {
  useTaskBundles,
  filterBundlesByCategory,
  filterTasksByCategory,
} from '@/hooks/useTaskBundles';
import {
  useTaskProgress,
  useStreakCelebration,
  useWeeklySummary,
  dismissStreakCelebration,
  dismissWeeklySummary,
} from '@/hooks/useTaskProgress';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { SmartSnoozeSheet } from '@/components/SmartSnoozeSheet';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { buildListEntries, filterToSourceTypes } from '@/services/taskBundling';
import { runExpiryScan } from '@/services/taskLifecycle';
import { snoozeTask } from '@/services/taskSnooze';
import type {
  Task,
  TaskCategoryFilter,
  TaskTimeGroup,
  TaskBundle,
  PersonalizedTask,
  TaskPriority,
  TaskSourceType,
  TaskStatus,
} from '@/lib/types/tasks';

type StatusTab = 'open' | 'completed' | 'all';

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

const CATEGORY_FILTERS: {
  key: TaskCategoryFilter;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: 'all', label: 'All', icon: 'apps-outline' },
  { key: 'medications', label: 'Medications', icon: 'medkit-outline' },
  { key: 'appointments', label: 'Appointments', icon: 'calendar-outline' },
  { key: 'billing', label: 'Bills', icon: 'receipt-outline' },
  { key: 'preventive', label: 'Preventive', icon: 'shield-checkmark-outline' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal' },
];

const TIME_GROUP_CONFIG: {
  key: TaskTimeGroup;
  label: string;
  description: string;
}[] = [
  { key: 'today', label: 'Today', description: 'Due today or overdue' },
  { key: 'this_week', label: 'This Week', description: 'Due in the next 7 days' },
  { key: 'when_ready', label: "When You're Ready", description: 'No rush' },
];

// PRIORITY_COLORS retained for reference but not currently consumed by render.
const _PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: COLORS.error.DEFAULT,
  high: COLORS.tertiary.DEFAULT,
  medium: COLORS.accent.dark,
  low: COLORS.secondary.DEFAULT,
};

const SOURCE_ICONS: Record<TaskSourceType, keyof typeof Ionicons.glyphMap> = {
  manual: 'create-outline',
  intent_sheet: 'document-text-outline',
  appointment: 'calendar-outline',
  medication: 'medkit-outline',
  billing: 'receipt-outline',
  preventive: 'shield-checkmark-outline',
};

const PRIORITIES_INVITE_DISMISS_KEY = 'tasks.priorities_invite_dismissed_until';
const DISMISSAL_DAYS = 7;

async function readDismissed(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return typeof localStorage !== 'undefined'
        ? localStorage.getItem(PRIORITIES_INVITE_DISMISS_KEY)
        : null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(PRIORITIES_INVITE_DISMISS_KEY);
  } catch {
    return null;
  }
}

async function writeDismissed(iso: string): Promise<void> {
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

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays < -1) return `Overdue by ${Math.abs(diffDays)}d`;
  if (diffDays <= 7) return `In ${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function ctaForTask(task: PersonalizedTask): string | null {
  if (task.status !== 'pending' && task.status !== 'in_progress') return null;
  const ctx = task.context_json;
  if (ctx?.call_script || ctx?.contact_info?.phone) return 'Call script ready';
  if (task.source_type === 'preventive') return 'Schedule now';
  if (task.source_type === 'billing') return 'Open bill';
  if (task.source_type === 'appointment') return 'View appointment';
  if (task.source_type === 'medication') return 'View medication';
  return null;
}

interface TasksContentProps {
  /** Show the per-screen FAB (defaults to true). Hide if the parent screen
   *  provides its own create entry-point. */
  showFab?: boolean;
}

export function TasksContent({ showFab = true }: TasksContentProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeProfileId, activeProfile } = useActiveProfile();
  const { user } = useAuth();
  const [statusTab, setStatusTab] = useState<StatusTab>('open');
  const [category, setCategory] = useState<TaskCategoryFilter>('all');
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());
  const [whenReadyExpanded, setWhenReadyExpanded] = useState(false);
  const [snoozeTarget, setSnoozeTarget] = useState<Task | null>(null);
  const [celebration, setCelebration] = useState<{
    taskId: string;
    bundleTitle: string | null;
  } | null>(null);
  const celebrationAnim = useRef(new Animated.Value(0)).current;

  useImplicitSignalRefresh(activeProfileId);

  const [inviteHiddenUntil, setInviteHiddenUntil] = useState<Date | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const stored = await readDismissed();
        if (cancelled) return;
        if (!stored) {
          setInviteHiddenUntil(null);
          return;
        }
        const d = new Date(stored);
        setInviteHiddenUntil(Number.isFinite(d.getTime()) ? d : null);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const handleDismissInvite = useCallback(async () => {
    const until = new Date(Date.now() + DISMISSAL_DAYS * 24 * 60 * 60 * 1000);
    setInviteHiddenUntil(until);
    await writeDismissed(until.toISOString());
  }, []);

  const expiryScanRanRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeProfileId || !user?.id) return;
    if (expiryScanRanRef.current === activeProfileId) return;
    expiryScanRanRef.current = activeProfileId;
    (async () => {
      const result = await runExpiryScan(activeProfileId, user.id);
      if (result.success && result.data > 0) {
        queryClient.invalidateQueries({ queryKey: ['tasks', 'list', activeProfileId] });
      }
    })();
  }, [activeProfileId, user?.id, queryClient]);

  const { data: priorities } = usePatientPriorities(activeProfileId);
  const { data: progress } = useTaskProgress(activeProfileId);
  const streakCelebration = useStreakCelebration(progress?.streakDays ?? 0);
  const weeklySummary = useWeeklySummary(activeProfileId);

  const statusFilter = useMemo<TaskStatus[] | undefined>(() => {
    if (statusTab === 'open') return ['pending', 'in_progress'];
    if (statusTab === 'completed') return ['completed', 'dismissed', 'expired'];
    return undefined;
  }, [statusTab]);

  const { bundles, individuals, fatigueNote, isLoading, error } = useTaskBundles(
    activeProfileId,
    statusFilter ? { status: statusFilter } : undefined,
  );

  const updateStatus = useUpdateTaskStatus();

  const { filteredBundles, filteredIndividuals } = useMemo(() => {
    const sourceTypes = filterToSourceTypes(category);
    return {
      filteredBundles: filterBundlesByCategory(bundles, sourceTypes),
      filteredIndividuals: filterTasksByCategory(individuals, sourceTypes),
    };
  }, [bundles, individuals, category]);

  const triggerCelebration = useCallback(
    (taskId: string, bundleTitle: string | null) => {
      setCelebration({ taskId, bundleTitle });
      celebrationAnim.setValue(0);
      Animated.sequence([
        Animated.spring(celebrationAnim, {
          toValue: 1,
          friction: 6,
          useNativeDriver: true,
        }),
        Animated.delay(bundleTitle ? 2000 : 900),
        Animated.timing(celebrationAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start(() => setCelebration(null));
    },
    [celebrationAnim],
  );

  const handleComplete = useCallback(
    (taskId: string) => {
      const containingBundle = bundles.find((b) =>
        b.tasks.some((t) => t.id === taskId),
      );
      const isFinalInBundle =
        !!containingBundle &&
        containingBundle.tasks.filter(
          (t) =>
            t.id !== taskId &&
            (t.status === 'pending' || t.status === 'in_progress'),
        ).length === 0;

      triggerCelebration(
        taskId,
        isFinalInBundle && containingBundle ? containingBundle.title : null,
      );
      updateStatus.mutate({ taskId, status: 'completed' });
    },
    [bundles, triggerCelebration, updateStatus],
  );

  const handleDismiss = useCallback(
    (taskId: string) => {
      Alert.alert('Dismiss Task', 'Are you sure you want to dismiss this task?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: () => updateStatus.mutate({ taskId, status: 'dismissed' }),
        },
      ]);
    },
    [updateStatus],
  );

  const handleSnooze = useCallback(
    async (isoTarget: string) => {
      if (!snoozeTarget || !user?.id) return;
      const id = snoozeTarget.id;
      setSnoozeTarget(null);
      const result = await snoozeTask(id, isoTarget, user.id);
      if (!result.success) {
        Alert.alert("Couldn't snooze", result.error);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['tasks', 'list', activeProfileId] });
    },
    [snoozeTarget, user?.id, queryClient, activeProfileId],
  );

  const handleMarkIrrelevant = useCallback(() => {
    if (!snoozeTarget) return;
    const id = snoozeTarget.id;
    setSnoozeTarget(null);
    updateStatus.mutate({ taskId: id, status: 'dismissed' });
  }, [snoozeTarget, updateStatus]);

  const toggleBundle = useCallback((id: string) => {
    setExpandedBundles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const renderTaskCard = useCallback(
    (task: PersonalizedTask, compact = false) => {
      const isOpen = task.status === 'pending' || task.status === 'in_progress';
      const isBlocked = task.dependency_status === 'blocked';
      const overdue = isOverdue(task.due_date) && isOpen;
      const cta = ctaForTask(task);

      const cardContent = (
        <Card
          onPress={() => router.push(`/(main)/tasks/${task.id}`)}
          style={
            compact
              ? { ...styles.taskCard, ...styles.taskCardCompact }
              : isBlocked
                ? { ...styles.taskCard, ...styles.taskCardBlocked }
                : styles.taskCard
          }
        >
          <View style={styles.taskRow}>
            <View style={styles.sourceIconWrap}>
              <Ionicons
                name={SOURCE_ICONS[task.source_type]}
                size={compact ? 14 : 18}
                color={COLORS.primary.DEFAULT}
              />
            </View>

            <View style={styles.taskContent}>
              <Text
                style={[
                  compact ? styles.taskTitleCompact : styles.taskTitle,
                  !isOpen && styles.taskTitleDone,
                  isBlocked && styles.taskTitleBlocked,
                ]}
                numberOfLines={compact ? 1 : 2}
              >
                {task.title}
              </Text>

              {!compact && task.contextLine && (
                <Text style={styles.contextLine} numberOfLines={1}>
                  {task.contextLine}
                </Text>
              )}

              <View style={styles.taskMeta}>
                {task.due_date && (
                  <Text
                    style={[styles.dueDate, overdue && styles.dueDateOverdue]}
                  >
                    {formatDueDate(task.due_date)}
                  </Text>
                )}
                {!compact && task.boostedByPriority && isOpen && (
                  <View style={styles.priorityBadge}>
                    <Ionicons
                      name="star"
                      size={10}
                      color={COLORS.primary.DEFAULT}
                    />
                    <Text style={styles.priorityBadgeText}>Priority</Text>
                  </View>
                )}
                {!compact && cta && (
                  <View style={styles.ctaChip}>
                    <Text style={styles.ctaChipText}>{cta}</Text>
                  </View>
                )}
                {isBlocked && (
                  <View style={styles.blockedBadge}>
                    <Text style={styles.blockedBadgeText}>Blocked</Text>
                  </View>
                )}
              </View>
            </View>

            {isOpen && !isBlocked && (
              <TouchableOpacity
                style={styles.checkButton}
                onPress={() => handleComplete(task.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <View style={styles.checkCircle} />
              </TouchableOpacity>
            )}

            {!isOpen && (
              <View style={styles.doneIndicator}>
                <Ionicons
                  name={task.status === 'completed' ? 'checkmark' : 'close'}
                  size={14}
                  color={
                    task.status === 'completed'
                      ? COLORS.success.DEFAULT
                      : COLORS.text.tertiary
                  }
                />
              </View>
            )}
          </View>
        </Card>
      );

      if (!isOpen || isBlocked) return <View key={task.id}>{cardContent}</View>;

      return (
        <Swipeable
          key={task.id}
          renderLeftActions={() => (
            <TouchableOpacity
              style={styles.swipeComplete}
              onPress={() => handleComplete(task.id)}
            >
              <Text style={styles.swipeText}>Complete</Text>
            </TouchableOpacity>
          )}
          renderRightActions={() => (
            <View style={styles.swipeRightRow}>
              <TouchableOpacity
                style={styles.swipeSnooze}
                onPress={() => setSnoozeTarget(task)}
              >
                <Ionicons name="time-outline" size={18} color={COLORS.text.inverse} />
                <Text style={styles.swipeText}>Snooze</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.swipeDismiss}
                onPress={() => handleDismiss(task.id)}
              >
                <Text style={styles.swipeText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}
          overshootLeft={false}
          overshootRight={false}
        >
          {cardContent}
        </Swipeable>
      );
    },
    [router, handleComplete, handleDismiss],
  );

  const renderBundleCard = useCallback(
    (bundle: TaskBundle, _group: TaskTimeGroup) => {
      const isExpanded = expandedBundles.has(bundle.id);
      const tasksForGroup = bundle.tasks.filter((t) => {
        const open = t.status === 'pending' || t.status === 'in_progress';
        return open;
      });
      const progress =
        bundle.totalCount > 0
          ? Math.round((bundle.completedCount / bundle.totalCount) * 100)
          : 0;

      return (
        <View key={bundle.id} style={styles.bundleContainer}>
          <TouchableOpacity
            style={styles.bundleHeader}
            onPress={() => toggleBundle(bundle.id)}
            activeOpacity={0.7}
          >
            <View style={styles.bundleIconWrap}>
              <Ionicons
                name={SOURCE_ICONS[bundle.sourceType]}
                size={18}
                color={COLORS.primary.DEFAULT}
              />
            </View>
            <View style={styles.bundleContent}>
              <View style={styles.bundleTitleRow}>
                <Text style={styles.bundleTitle} numberOfLines={1}>
                  {bundle.title}
                </Text>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={COLORS.text.tertiary}
                />
              </View>
              <View style={styles.bundleProgressRow}>
                <View style={styles.bundleProgressBar}>
                  <View
                    style={[
                      styles.bundleProgressFill,
                      { width: `${progress}%` },
                    ]}
                  />
                </View>
                <Text style={styles.bundleProgressText}>
                  {bundle.completedCount} of {bundle.totalCount}
                </Text>
              </View>
              {!isExpanded && bundle.nextDueDate && (
                <Text
                  style={[
                    styles.bundleNextDue,
                    isOverdue(bundle.nextDueDate) && styles.dueDateOverdue,
                  ]}
                >
                  Next: {formatDueDate(bundle.nextDueDate)}
                </Text>
              )}
            </View>
          </TouchableOpacity>

          {isExpanded && (
            <View style={styles.bundleTasks}>
              {tasksForGroup.map((t) => {
                const pt: PersonalizedTask = {
                  ...t,
                  basePriority: bundle.personalizedPriority,
                  personalizedPriority: bundle.personalizedPriority,
                  boostedByPriority: false,
                  contextLine: null,
                };
                return renderTaskCard(pt, true);
              })}
              <TouchableOpacity
                style={styles.bundleLink}
                onPress={() => router.push(bundle.sourceRoute as never)}
              >
                <Text style={styles.bundleLinkText}>
                  Open{' '}
                  {bundle.sourceType === 'appointment'
                    ? 'appointment'
                    : bundle.sourceType === 'billing'
                      ? 'bill'
                      : bundle.sourceType === 'preventive'
                        ? 'screening'
                        : bundle.sourceType === 'medication'
                          ? 'medication'
                          : 'source'}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={COLORS.primary.DEFAULT}
                />
              </TouchableOpacity>
            </View>
          )}
        </View>
      );
    },
    [expandedBundles, toggleBundle, renderTaskCard, router],
  );

  const sections = useMemo(() => {
    return TIME_GROUP_CONFIG.map((config) => {
      const entries = buildListEntries(
        filteredBundles,
        filteredIndividuals,
        config.key,
      );
      return { ...config, entries };
    });
  }, [filteredBundles, filteredIndividuals]);

  const hasAnyContent = sections.some((s) => s.entries.length > 0);

  if (!activeProfileId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Select a profile to view tasks.</Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Loading tasks...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load tasks</Text>
      </View>
    );
  }

  const weeklyCompleted = progress?.completedThisWeek ?? 0;
  const weeklyProgressPct = Math.min(100, weeklyCompleted * 10);

  return (
    <View style={styles.container}>
      {progress && weeklyCompleted > 0 && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View
              style={[styles.progressFill, { width: `${weeklyProgressPct}%` }]}
            />
          </View>
          <Text style={styles.progressText}>
            {weeklyCompleted} completed this week
            {progress.streakDays >= 3 ? ` · ${progress.streakDays}d streak` : ''}
          </Text>
        </View>
      )}

      {/* Weekly summary banner — Monday-first-visit, gated per user+week */}
      {weeklySummary && user?.id && (
        <View style={styles.summaryBanner}>
          <View style={styles.summaryHeader}>
            <Ionicons name="sparkles" size={16} color={COLORS.accent.dark} />
            <Text style={styles.summaryTitle}>
              Last week you completed {weeklySummary.totalCount} tasks
            </Text>
            <TouchableOpacity
              onPress={() => {
                void dismissWeeklySummary(user.id, weeklySummary.weekStartIso);
              }}
              hitSlop={8}
            >
              <Ionicons name="close" size={16} color={COLORS.text.tertiary} />
            </TouchableOpacity>
          </View>
          {weeklySummary.highlights.slice(0, 3).map((h) => (
            <View key={h.id} style={styles.summaryLine}>
              <Ionicons
                name="checkmark"
                size={12}
                color={COLORS.success.DEFAULT}
              />
              <Text style={styles.summaryLineText} numberOfLines={1}>
                {h.title}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Streak celebration banner — 3/7/30 day thresholds */}
      {streakCelebration && user?.id && (
        <TouchableOpacity
          style={styles.streakBanner}
          onPress={() => {
            void dismissStreakCelebration(user.id, streakCelebration);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="flame" size={18} color={COLORS.accent.dark} />
          <Text style={styles.streakText}>
            {streakCelebration === 30
              ? 'A full month staying on top of your health!'
              : streakCelebration === 7
                ? "7-day streak — you're on a roll."
                : '3-day streak — nice start!'}
          </Text>
          <Ionicons name="close" size={14} color={COLORS.text.tertiary} />
        </TouchableOpacity>
      )}

      <View style={styles.statusTabs}>
        {STATUS_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.statusTab,
              statusTab === tab.key && styles.statusTabActive,
            ]}
            onPress={() => setStatusTab(tab.key)}
          >
            <Text
              style={[
                styles.statusTabText,
                statusTab === tab.key && styles.statusTabTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {fatigueNote && statusTab === 'open' && (
        <View style={styles.fatigueBanner}>
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={COLORS.text.secondary}
          />
          <Text style={styles.fatigueBannerText}>{fatigueNote}</Text>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScroll}
        style={styles.chipBar}
      >
        {CATEGORY_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, category === f.key && styles.chipActive]}
            onPress={() => setCategory(f.key)}
          >
            <Ionicons
              name={f.icon}
              size={14}
              color={
                category === f.key
                  ? COLORS.primary.DEFAULT
                  : COLORS.text.secondary
              }
              style={styles.chipIcon}
            />
            <Text
              style={[
                styles.chipText,
                category === f.key && styles.chipTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {activeProfile && (() => {
        const hasPriorities =
          !!priorities &&
          (priorities.health_priorities.length > 0 ||
            priorities.friction_points.length > 0 ||
            priorities.conditions_of_focus.length > 0);
        const inviteDismissed =
          inviteHiddenUntil !== null && inviteHiddenUntil.getTime() > Date.now();
        const gotoPriorities = () =>
          router.push(
            `/(main)/profile/${activeProfile.id}/priorities` as never,
          );

        if (hasPriorities) {
          const topTopics = priorities!.health_priorities
            .slice(0, 3)
            .map((hp) => hp.topic);
          return (
            <TouchableOpacity
              style={styles.prioritiesCompact}
              activeOpacity={0.8}
              onPress={gotoPriorities}
            >
              <View style={styles.prioritiesCompactHeader}>
                <View style={styles.prioritiesCompactTitleRow}>
                  <Ionicons
                    name="heart"
                    size={14}
                    color={COLORS.primary.DEFAULT}
                  />
                  <Text style={styles.prioritiesCompactTitle}>
                    Your Priorities
                  </Text>
                </View>
                <Text style={styles.prioritiesCompactUpdate}>Update</Text>
              </View>
              <View style={styles.prioritiesCompactChips}>
                {topTopics.map((t) => (
                  <View key={t} style={styles.prioritiesCompactChip}>
                    <Text
                      style={styles.prioritiesCompactChipText}
                      numberOfLines={1}
                    >
                      {t}
                    </Text>
                  </View>
                ))}
                {priorities!.health_priorities.length > 3 && (
                  <Text style={styles.prioritiesCompactMore}>
                    +{priorities!.health_priorities.length - 3} more
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        }

        if (inviteDismissed) return null;

        return (
          <View style={styles.prioritiesCta}>
            <TouchableOpacity
              style={styles.prioritiesCtaBody}
              activeOpacity={0.8}
              onPress={gotoPriorities}
            >
              <View style={styles.prioritiesCtaIcon}>
                <Ionicons
                  name="heart-outline"
                  size={20}
                  color={COLORS.primary.DEFAULT}
                />
              </View>
              <View style={styles.prioritiesCtaContent}>
                <Text style={styles.prioritiesCtaTitle}>
                  What matters most to you?
                </Text>
                <Text style={styles.prioritiesCtaDesc}>
                  Tell CareLead your priorities and we'll focus on what you
                  care about.
                </Text>
                <View style={styles.prioritiesCtaBadge}>
                  <Text style={styles.prioritiesCtaBadgeText}>Customize</Text>
                  <Ionicons
                    name="chevron-forward"
                    size={12}
                    color={COLORS.primary.DEFAULT}
                  />
                </View>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.prioritiesCtaDismiss}
              onPress={handleDismissInvite}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={14} color={COLORS.text.tertiary} />
            </TouchableOpacity>
          </View>
        );
      })()}

      {!hasAnyContent ? (
        <EmptyState
          title={
            category !== 'all'
              ? 'No matching tasks'
              : statusTab === 'open'
                ? "You're all caught up"
                : 'No tasks yet'
          }
          description={
            category !== 'all'
              ? 'Try another category to see more tasks.'
              : statusTab === 'open'
                ? 'Nothing needs your attention right now.'
                : 'Tasks will appear here as you use CareLead.'
          }
          actionTitle={
            statusTab === 'open' && category === 'all' ? 'Create Task' : undefined
          }
          onAction={
            statusTab === 'open' && category === 'all'
              ? () => router.push('/(main)/tasks/create')
              : undefined
          }
        />
      ) : (
        <FlatList
          data={sections.filter((s) => s.entries.length > 0)}
          keyExtractor={(s) => s.key}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: section }) => {
            const isWhenReady = section.key === 'when_ready';
            const collapsed = isWhenReady && !whenReadyExpanded;

            return (
              <View style={styles.section}>
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={
                    isWhenReady
                      ? () => setWhenReadyExpanded((v) => !v)
                      : undefined
                  }
                  activeOpacity={isWhenReady ? 0.7 : 1}
                  disabled={!isWhenReady}
                >
                  <View>
                    <Text
                      style={[
                        styles.sectionTitle,
                        section.key === 'today' && styles.sectionTitleToday,
                      ]}
                    >
                      {section.label}
                    </Text>
                    <Text style={styles.sectionDescription}>
                      {collapsed
                        ? `${section.entries.length} ${
                            section.entries.length === 1 ? 'item' : 'items'
                          } when you're ready`
                        : section.description}
                    </Text>
                  </View>
                  <View style={styles.sectionCountWrap}>
                    <Text style={styles.sectionCount}>
                      {section.entries.length}
                    </Text>
                    {isWhenReady && (
                      <Ionicons
                        name={whenReadyExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={COLORS.text.tertiary}
                        style={styles.sectionChevron}
                      />
                    )}
                  </View>
                </TouchableOpacity>

                {!collapsed &&
                  section.entries.map((entry) =>
                    entry.kind === 'bundle'
                      ? renderBundleCard(entry.bundle, section.key)
                      : renderTaskCard(entry.task),
                  )}
              </View>
            );
          }}
        />
      )}

      {showFab && (
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.8}
          onPress={() => router.push('/(main)/tasks/create')}
        >
          <Ionicons name="add" size={28} color={COLORS.text.inverse} />
        </TouchableOpacity>
      )}

      {celebration && (
        <Animated.View
          style={[
            styles.celebration,
            {
              opacity: celebrationAnim,
              transform: [
                {
                  scale: celebrationAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <Ionicons
            name="checkmark-circle"
            size={48}
            color={COLORS.success.DEFAULT}
          />
          {celebration.bundleTitle && (
            <Text style={styles.celebrationText}>
              All done! {celebration.bundleTitle} is complete.
            </Text>
          )}
        </Animated.View>
      )}

      <SmartSnoozeSheet
        visible={!!snoozeTarget}
        task={snoozeTarget}
        onDismiss={() => setSnoozeTarget(null)}
        onSnooze={handleSnooze}
        onMarkIrrelevant={handleMarkIrrelevant}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.error.DEFAULT,
    marginBottom: 8,
  },
  progressContainer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 4,
  },
  // Weekly summary banner (moved from Home)
  summaryBanner: {
    marginHorizontal: 24,
    marginTop: 8,
    marginBottom: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.accent.DEFAULT + '14',
    borderWidth: 1,
    borderColor: COLORS.accent.DEFAULT + '33',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  summaryTitle: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  summaryLineText: {
    flex: 1,
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  // Streak celebration banner (moved from Home)
  streakBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 24,
    marginTop: 4,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: COLORS.accent.DEFAULT + '14',
    borderWidth: 1,
    borderColor: COLORS.accent.DEFAULT + '33',
  },
  streakText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  statusTabs: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginTop: 8,
    marginBottom: 8,
    gap: 8,
  },
  statusTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.surface.muted,
    alignItems: 'center',
  },
  statusTabActive: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  statusTabText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  statusTabTextActive: {
    color: COLORS.text.inverse,
  },
  chipBar: {
    flexGrow: 0,
    marginBottom: 12,
  },
  chipScroll: {
    paddingHorizontal: 24,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  chipActive: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
    borderColor: COLORS.primary.DEFAULT,
  },
  chipIcon: {
    marginRight: 6,
  },
  chipText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  chipTextActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  prioritiesCta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 24,
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.secondary.DEFAULT + '14',
    borderWidth: 1,
    borderColor: COLORS.secondary.DEFAULT + '33',
  },
  prioritiesCtaBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  prioritiesCtaIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  prioritiesCtaContent: {
    flex: 1,
  },
  prioritiesCtaTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  prioritiesCtaDesc: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    lineHeight: 16,
    marginBottom: 6,
  },
  prioritiesCtaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  prioritiesCtaBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  prioritiesCtaDismiss: {
    padding: 4,
    marginLeft: 4,
  },
  prioritiesCompact: {
    marginHorizontal: 24,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '33',
  },
  prioritiesCompactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  prioritiesCompactTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  prioritiesCompactTitle: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  prioritiesCompactUpdate: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  prioritiesCompactChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  prioritiesCompactChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    maxWidth: 180,
  },
  prioritiesCompactChipText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.primary.DEFAULT,
  },
  prioritiesCompactMore: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginLeft: 2,
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  priorityBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  sectionTitleToday: {
    color: COLORS.primary.DEFAULT,
  },
  sectionDescription: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  sectionCountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionCount: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    minWidth: 22,
    textAlign: 'right',
  },
  sectionChevron: {
    marginLeft: 4,
  },
  taskCard: {
    marginBottom: 8,
  },
  taskCardCompact: {
    padding: 10,
    marginBottom: 4,
  },
  taskCardBlocked: {
    opacity: 0.65,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  sourceIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  taskTitleCompact: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    color: COLORS.text.tertiary,
  },
  taskTitleBlocked: {
    color: COLORS.text.secondary,
  },
  contextLine: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginBottom: 6,
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  dueDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  dueDateOverdue: {
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  ctaChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: COLORS.accent.DEFAULT + '20',
  },
  ctaChipText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.accent.dark,
  },
  blockedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: COLORS.error.light,
  },
  blockedBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.error.DEFAULT,
  },
  checkButton: {
    padding: 4,
    marginLeft: 8,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.border.dark,
  },
  doneIndicator: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.success.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  bundleContainer: {
    marginBottom: 10,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  bundleHeader: {
    flexDirection: 'row',
    padding: 14,
  },
  bundleIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  bundleContent: {
    flex: 1,
  },
  bundleTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  bundleTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flex: 1,
    marginRight: 8,
  },
  bundleProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bundleProgressBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.border.DEFAULT,
    overflow: 'hidden',
  },
  bundleProgressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.success.DEFAULT,
  },
  bundleProgressText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  bundleNextDue: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary.DEFAULT,
    marginTop: 6,
    fontWeight: FONT_WEIGHTS.medium,
  },
  bundleTasks: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    paddingTop: 10,
  },
  bundleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginTop: 4,
  },
  bundleLinkText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    marginRight: 4,
  },
  swipeComplete: {
    backgroundColor: COLORS.success.DEFAULT,
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    borderRadius: 12,
    marginBottom: 8,
  },
  swipeDismiss: {
    backgroundColor: COLORS.error.DEFAULT,
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    borderRadius: 12,
    marginBottom: 8,
  },
  swipeRightRow: {
    flexDirection: 'row',
    gap: 4,
  },
  swipeSnooze: {
    backgroundColor: COLORS.accent.dark,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 12,
    marginBottom: 8,
    gap: 2,
  },
  swipeText: {
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
    fontSize: FONT_SIZES.sm,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border.light,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.success.DEFAULT,
  },
  progressText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  fatigueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: COLORS.surface.muted,
  },
  fatigueBannerText: {
    flex: 1,
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  celebration: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  celebrationText: {
    marginTop: 12,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.success.DEFAULT,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
});
