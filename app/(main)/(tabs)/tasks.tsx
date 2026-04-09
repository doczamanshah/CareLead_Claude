import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useTasks, useUpdateTaskStatus } from '@/hooks/useTasks';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { Task, TaskPriority, TaskStatus } from '@/lib/types/tasks';
import { PRIORITY_ORDER, PRIORITY_LABELS } from '@/lib/types/tasks';

// ── Types ──────────────────────────────────────────────────────────────────

type FilterTab = 'open' | 'completed' | 'all';
type ViewMode = 'priority' | 'action_plan';
type TimeFilter = 'all' | 'due_today' | 'overdue' | 'this_week';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

const TIME_FILTERS: { key: TimeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'due_today', label: 'Due Today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'this_week', label: 'This Week' },
];

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: COLORS.error.DEFAULT,
  high: COLORS.tertiary.DEFAULT,
  medium: COLORS.accent.dark,
  low: COLORS.secondary.DEFAULT,
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual',
  extraction: 'AI Suggested',
  proactive: 'Proactive',
  time_based: 'Recurring',
  chain: 'Action Plan',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getStatusFilter(tab: FilterTab): TaskStatus[] | undefined {
  switch (tab) {
    case 'open':
      return ['pending', 'in_progress'];
    case 'completed':
      return ['completed', 'dismissed'];
    case 'all':
      return undefined;
  }
}

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false;
  if (task.status === 'completed' || task.status === 'dismissed') return false;
  return new Date(task.due_date) < new Date();
}

function isDueToday(task: Task): boolean {
  if (!task.due_date) return false;
  const due = new Date(task.due_date);
  const now = new Date();
  return (
    due.getDate() === now.getDate() &&
    due.getMonth() === now.getMonth() &&
    due.getFullYear() === now.getFullYear()
  );
}

function isDueThisWeek(task: Task): boolean {
  if (!task.due_date) return false;
  const due = new Date(task.due_date);
  const now = new Date();
  const endOfWeek = new Date(now);
  endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
  endOfWeek.setHours(23, 59, 59, 999);
  return due <= endOfWeek;
}

function formatDueDate(dateStr: string, taskStatus?: TaskStatus): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays < -1) return `Overdue by ${Math.abs(diffDays)}d`;
  if (diffDays <= 7) return `In ${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getChainLabel(task: Task): string | null {
  if (!task.parent_task_id || !task.chain_order) return null;
  return `Step ${task.chain_order}`;
}

// ── Action Plan Group ──────────────────────────────────────────────────────

interface ActionPlanGroup {
  id: string;
  name: string;
  tasks: Task[];
  completedCount: number;
  totalCount: number;
  nextStep: Task | null;
  isExpanded: boolean;
}

// ── Priority Group ─────────────────────────────────────────────────────────

interface PriorityGroup {
  priority: TaskPriority;
  tasks: Task[];
}

function groupByPriority(tasks: Task[]): PriorityGroup[] {
  const groups: Partial<Record<TaskPriority, Task[]>> = {};

  for (const task of tasks) {
    if (!groups[task.priority]) groups[task.priority] = [];
    groups[task.priority]!.push(task);
  }

  return Object.entries(groups)
    .sort(([a], [b]) => PRIORITY_ORDER[a as TaskPriority] - PRIORITY_ORDER[b as TaskPriority])
    .map(([priority, groupTasks]) => ({
      priority: priority as TaskPriority,
      tasks: groupTasks!,
    }));
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function TasksScreen() {
  const [activeTab, setActiveTab] = useState<FilterTab>('open');
  const [viewMode, setViewMode] = useState<ViewMode>('priority');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());
  const { activeProfileId } = useActiveProfile();
  const router = useRouter();

  const statusFilter = getStatusFilter(activeTab);
  const filter = statusFilter ? { status: statusFilter } : undefined;

  const { data: tasks, isLoading, error, refetch } = useTasks(activeProfileId, filter);
  const updateStatus = useUpdateTaskStatus();

  // Apply time filter
  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    switch (timeFilter) {
      case 'due_today':
        return tasks.filter((t) => isDueToday(t) || isOverdue(t));
      case 'overdue':
        return tasks.filter(isOverdue);
      case 'this_week':
        return tasks.filter((t) => isDueThisWeek(t) || isOverdue(t));
      default:
        return tasks;
    }
  }, [tasks, timeFilter]);

  // Build action plan groups
  const { actionPlans, individualTasks } = useMemo(() => {
    const chainMap = new Map<string, Task[]>();
    const individuals: Task[] = [];

    for (const task of filteredTasks) {
      if (task.parent_task_id) {
        const key = task.parent_task_id;
        if (!chainMap.has(key)) chainMap.set(key, []);
        chainMap.get(key)!.push(task);
      } else {
        const children = filteredTasks.filter((t) => t.parent_task_id === task.id);
        if (children.length > 0) {
          const key = task.id;
          if (!chainMap.has(key)) chainMap.set(key, []);
          chainMap.get(key)!.unshift(task);
        } else {
          individuals.push(task);
        }
      }
    }

    const plans: ActionPlanGroup[] = [];
    for (const [parentId, chainTasks] of chainMap) {
      const sorted = chainTasks.sort((a, b) => (a.chain_order ?? 0) - (b.chain_order ?? 0));
      const completed = sorted.filter((t) => t.status === 'completed').length;
      const next = sorted.find(
        (t) => t.status === 'pending' || t.status === 'in_progress',
      ) ?? null;

      const triggerSource = sorted[0]?.trigger_source ?? '';
      plans.push({
        id: parentId,
        name: triggerSource || 'Action Plan',
        tasks: sorted,
        completedCount: completed,
        totalCount: sorted.length,
        nextStep: next,
        isExpanded: expandedChains.has(parentId),
      });
    }

    return { actionPlans: plans, individualTasks: individuals };
  }, [filteredTasks, expandedChains]);

  const groups = useMemo(() => groupByPriority(filteredTasks), [filteredTasks]);

  const toggleChainExpanded = useCallback((chainId: string) => {
    setExpandedChains((prev) => {
      const next = new Set(prev);
      if (next.has(chainId)) next.delete(chainId);
      else next.add(chainId);
      return next;
    });
  }, []);

  const handleComplete = useCallback(
    (taskId: string) => {
      updateStatus.mutate({ taskId, status: 'completed' });
    },
    [updateStatus],
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

  const renderRightActions = useCallback(
    (taskId: string) => (
      <TouchableOpacity
        style={styles.swipeDismiss}
        onPress={() => handleDismiss(taskId)}
      >
        <Text style={styles.swipeText}>Dismiss</Text>
      </TouchableOpacity>
    ),
    [handleDismiss],
  );

  const renderLeftActions = useCallback(
    (taskId: string) => (
      <TouchableOpacity
        style={styles.swipeComplete}
        onPress={() => handleComplete(taskId)}
      >
        <Text style={styles.swipeText}>Complete</Text>
      </TouchableOpacity>
    ),
    [handleComplete],
  );

  const renderTaskCard = useCallback(
    (task: Task) => {
      const overdue = isOverdue(task);
      const isOpen = task.status === 'pending' || task.status === 'in_progress';
      const isBlocked = task.dependency_status === 'blocked';
      const chainLabel = getChainLabel(task);
      const triggerLabel = task.trigger_type ? TRIGGER_LABELS[task.trigger_type] : null;

      const cardContent = (
        <Card
          onPress={() => router.push(`/(main)/tasks/${task.id}`)}
          style={isBlocked ? { ...styles.taskCard, ...styles.taskCardBlocked } : styles.taskCard}
        >
          <View style={styles.taskRow}>
            <View style={styles.taskContent}>
              <View style={styles.taskHeader}>
                <Text
                  style={[
                    styles.taskTitle,
                    (task.status === 'completed' || task.status === 'dismissed') &&
                      styles.taskTitleDone,
                    isBlocked && styles.taskTitleBlocked,
                  ]}
                  numberOfLines={1}
                >
                  {task.title}
                </Text>
              </View>

              {task.description && (
                <Text style={styles.taskDescription} numberOfLines={1}>
                  {task.description}
                </Text>
              )}

              <View style={styles.taskMeta}>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: PRIORITY_COLORS[task.priority] + '1A' },
                  ]}
                >
                  <Text
                    style={[styles.badgeText, { color: PRIORITY_COLORS[task.priority] }]}
                  >
                    {PRIORITY_LABELS[task.priority]}
                  </Text>
                </View>

                {triggerLabel && triggerLabel !== 'Manual' && (
                  <View style={[styles.badge, styles.triggerBadge]}>
                    <Text style={styles.triggerBadgeText}>{triggerLabel}</Text>
                  </View>
                )}

                {chainLabel && (
                  <View style={[styles.badge, styles.chainBadge]}>
                    <Text style={styles.chainBadgeText}>{chainLabel}</Text>
                  </View>
                )}

                {isBlocked && (
                  <View style={[styles.badge, styles.blockedBadge]}>
                    <Text style={styles.blockedBadgeText}>Blocked</Text>
                  </View>
                )}

                {task.due_date && (
                  <Text style={[styles.dueDate, overdue && styles.dueDateOverdue]}>
                    {formatDueDate(task.due_date, task.status)}
                  </Text>
                )}
              </View>

              {task.trigger_source && (
                <Text style={styles.triggerSource} numberOfLines={1}>
                  {task.trigger_source}
                </Text>
              )}
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

            {isOpen && isBlocked && (
              <View style={styles.blockedLock}>
                <Text style={styles.blockedLockText}>&#x1F512;</Text>
              </View>
            )}

            {!isOpen && (
              <View style={styles.doneIndicator}>
                <Text style={styles.doneCheck}>
                  {task.status === 'completed' ? '\u2713' : '\u2715'}
                </Text>
              </View>
            )}
          </View>
        </Card>
      );

      if (!isOpen || isBlocked) return <View key={task.id}>{cardContent}</View>;

      return (
        <Swipeable
          key={task.id}
          renderLeftActions={() => renderLeftActions(task.id)}
          renderRightActions={() => renderRightActions(task.id)}
          overshootLeft={false}
          overshootRight={false}
        >
          {cardContent}
        </Swipeable>
      );
    },
    [router, handleComplete, renderLeftActions, renderRightActions],
  );

  // ── Action Plan card renderer ──────────────────────────────────────────

  const renderActionPlan = useCallback(
    (plan: ActionPlanGroup) => {
      const progress = plan.totalCount > 0
        ? Math.round((plan.completedCount / plan.totalCount) * 100)
        : 0;

      return (
        <View key={plan.id} style={styles.actionPlanContainer}>
          <TouchableOpacity
            style={styles.actionPlanHeader}
            onPress={() => toggleChainExpanded(plan.id)}
            activeOpacity={0.7}
          >
            <View style={styles.actionPlanTitleRow}>
              <Text style={styles.actionPlanName} numberOfLines={1}>
                {plan.name}
              </Text>
              <Text style={styles.actionPlanChevron}>
                {plan.isExpanded ? '\u25B2' : '\u25BC'}
              </Text>
            </View>
            <View style={styles.actionPlanProgressRow}>
              <View style={styles.actionPlanProgressBar}>
                <View
                  style={[
                    styles.actionPlanProgressFill,
                    { width: `${progress}%` },
                  ]}
                />
              </View>
              <Text style={styles.actionPlanProgressText}>
                {plan.completedCount} of {plan.totalCount} complete
              </Text>
            </View>
            {plan.nextStep && !plan.isExpanded && (
              <Text style={styles.actionPlanNextStep} numberOfLines={1}>
                Next: {plan.nextStep.title}
              </Text>
            )}
          </TouchableOpacity>

          {plan.isExpanded && (
            <View style={styles.actionPlanTasks}>
              {plan.tasks.map((task) => renderTaskCard(task))}
            </View>
          )}
        </View>
      );
    },
    [toggleChainExpanded, renderTaskCard],
  );

  // ── Build list data ────────────────────────────────────────────────────

  type ListItem =
    | { type: 'header'; priority: TaskPriority }
    | { type: 'action_plan'; plan: ActionPlanGroup }
    | { type: 'individual_header' }
    | { type: 'task'; task: Task };

  const listData = useMemo((): ListItem[] => {
    if (viewMode === 'action_plan') {
      const items: ListItem[] = [];

      for (const plan of actionPlans) {
        items.push({ type: 'action_plan', plan });
      }

      if (individualTasks.length > 0) {
        if (actionPlans.length > 0) {
          items.push({ type: 'individual_header' });
        }
        for (const task of individualTasks) {
          items.push({ type: 'task', task });
        }
      }

      return items;
    }

    // Priority view
    const items: ListItem[] = [];

    for (const group of groups) {
      items.push({ type: 'header', priority: group.priority });
      for (const task of group.tasks) {
        items.push({ type: 'task', task });
      }
    }

    return items;
  }, [viewMode, groups, actionPlans, individualTasks]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.titleContainer}>
          <Text style={styles.screenTitle}>Tasks & Reminders</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading tasks...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.titleContainer}>
          <Text style={styles.screenTitle}>Tasks & Reminders</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Failed to load tasks</Text>
          <TouchableOpacity onPress={() => refetch()} style={styles.retryButton}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.titleContainer}>
        <Text style={styles.screenTitle}>Tasks & Reminders</Text>
      </View>

      {/* Status filter tabs */}
      <View style={styles.filterBar}>
        {FILTER_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.filterTab, activeTab === tab.key && styles.filterTabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text
              style={[
                styles.filterTabText,
                activeTab === tab.key && styles.filterTabTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Time filter chips */}
      <View style={styles.chipBar}>
        {TIME_FILTERS.map((chip) => (
          <TouchableOpacity
            key={chip.key}
            style={[styles.chip, timeFilter === chip.key && styles.chipActive]}
            onPress={() => setTimeFilter(chip.key)}
          >
            <Text
              style={[
                styles.chipText,
                timeFilter === chip.key && styles.chipTextActive,
              ]}
            >
              {chip.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* View toggle */}
      <View style={styles.viewToggleBar}>
        <TouchableOpacity
          style={[styles.viewToggle, viewMode === 'priority' && styles.viewToggleActive]}
          onPress={() => setViewMode('priority')}
        >
          <Text
            style={[
              styles.viewToggleText,
              viewMode === 'priority' && styles.viewToggleTextActive,
            ]}
          >
            By Priority
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.viewToggle, viewMode === 'action_plan' && styles.viewToggleActive]}
          onPress={() => setViewMode('action_plan')}
        >
          <Text
            style={[
              styles.viewToggleText,
              viewMode === 'action_plan' && styles.viewToggleTextActive,
            ]}
          >
            By Action Plan
          </Text>
        </TouchableOpacity>
      </View>

      {/* Task list */}
      {listData.length === 0 ? (
        <EmptyState
          title={
            timeFilter !== 'all'
              ? 'No matching tasks'
              : activeTab === 'open'
                ? 'No open tasks'
                : 'No tasks yet'
          }
          description={
            timeFilter !== 'all'
              ? 'Try changing your filter to see more tasks.'
              : activeTab === 'open'
                ? 'Create a task or process a document to generate action items.'
                : 'Tasks will appear here as you capture and process health documents.'
          }
          actionTitle={activeTab === 'open' && timeFilter === 'all' ? 'Create Task' : undefined}
          onAction={
            activeTab === 'open' && timeFilter === 'all'
              ? () => router.push('/(main)/tasks/create')
              : undefined
          }
        />
      ) : (
        <FlatList<ListItem>
          data={listData}
          keyExtractor={(item) => {
            if (item.type === 'header') return `header-${item.priority}`;
            if (item.type === 'action_plan') return `plan-${item.plan.id}`;
            if (item.type === 'individual_header') return 'individual-header';
            return item.task.id;
          }}
          renderItem={({ item }) => {
            switch (item.type) {
              case 'header':
                return (
                  <View style={styles.sectionHeader}>
                    <View
                      style={[
                        styles.sectionDot,
                        { backgroundColor: PRIORITY_COLORS[item.priority] },
                      ]}
                    />
                    <Text style={styles.sectionTitle}>
                      {PRIORITY_LABELS[item.priority]} Priority
                    </Text>
                  </View>
                );
              case 'action_plan':
                return renderActionPlan(item.plan);
              case 'individual_header':
                return (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Individual Tasks</Text>
                  </View>
                );
              case 'task':
                return renderTaskCard(item.task);
            }
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Floating action button */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => router.push('/(main)/tasks/create')}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  titleContainer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  screenTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  retryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  // Filter bar
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 8,
    gap: 8,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.surface.muted,
    alignItems: 'center',
  },
  filterTabActive: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  filterTabText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  filterTabTextActive: {
    color: COLORS.text.inverse,
  },
  // Time filter chips
  chipBar: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 8,
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  chipActive: {
    backgroundColor: COLORS.primary.DEFAULT + '15',
    borderColor: COLORS.primary.DEFAULT,
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
  // View toggle
  viewToggleBar: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 16,
    gap: 0,
  },
  viewToggle: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: COLORS.border.light,
  },
  viewToggleActive: {
    borderBottomColor: COLORS.primary.DEFAULT,
  },
  viewToggleText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.tertiary,
  },
  viewToggleTextActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  // List content
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Task cards
  taskCard: {
    marginBottom: 8,
  },
  taskCardBlocked: {
    opacity: 0.65,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskContent: {
    flex: 1,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  taskTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    color: COLORS.text.tertiary,
  },
  taskTitleBlocked: {
    color: COLORS.text.secondary,
  },
  taskDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 6,
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  triggerBadge: {
    backgroundColor: COLORS.primary.DEFAULT + '15',
  },
  triggerBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  chainBadge: {
    backgroundColor: COLORS.accent.DEFAULT + '20',
  },
  chainBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.accent.dark,
  },
  blockedBadge: {
    backgroundColor: COLORS.error.light,
  },
  blockedBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.error.DEFAULT,
  },
  dueDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  dueDateOverdue: {
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  triggerSource: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 3,
    fontStyle: 'italic',
  },
  checkButton: {
    padding: 4,
    marginLeft: 12,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border.dark,
  },
  blockedLock: {
    marginLeft: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockedLockText: {
    fontSize: 16,
  },
  doneIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.success.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  doneCheck: {
    fontSize: 14,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.bold,
  },
  swipeComplete: {
    backgroundColor: COLORS.success.DEFAULT,
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    borderRadius: 16,
    marginBottom: 8,
  },
  swipeDismiss: {
    backgroundColor: COLORS.error.DEFAULT,
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    borderRadius: 16,
    marginBottom: 8,
  },
  swipeText: {
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
    fontSize: FONT_SIZES.sm,
  },
  // Action plan cards
  actionPlanContainer: {
    marginBottom: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    overflow: 'hidden',
  },
  actionPlanHeader: {
    padding: 14,
  },
  actionPlanTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionPlanName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
  actionPlanChevron: {
    fontSize: 10,
    color: COLORS.text.tertiary,
    marginLeft: 8,
  },
  actionPlanProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionPlanProgressBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.border.DEFAULT,
    overflow: 'hidden',
  },
  actionPlanProgressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.success.DEFAULT,
  },
  actionPlanProgressText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  actionPlanNextStep: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    marginTop: 6,
    fontWeight: FONT_WEIGHTS.medium,
  },
  actionPlanTasks: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  // FAB
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
  fabIcon: {
    fontSize: 28,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.medium,
    marginTop: -2,
  },
});
