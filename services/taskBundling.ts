import type {
  Task,
  TaskBundle,
  TaskCategoryFilter,
  TaskSourceType,
  TaskListEntry,
  TaskTimeGroup,
  PersonalizedTask,
} from '@/lib/types/tasks';
import { PRIORITY_ORDER } from '@/lib/types/tasks';

/** Readable bundle title by source_type, when we don't yet know the entity name. */
const SOURCE_TITLES: Record<TaskSourceType, string> = {
  manual: 'Personal tasks',
  intent_sheet: 'Document review follow-up',
  appointment: 'Appointment',
  medication: 'Medication',
  billing: 'Bill',
  preventive: 'Preventive screening',
};

const SOURCE_ROUTES: Record<TaskSourceType, (id: string) => string> = {
  manual: () => '/(main)/(tabs)/activity',
  intent_sheet: (id) => `/(main)/intent-sheet/${id}`,
  appointment: (id) => `/(main)/appointments/${id}`,
  medication: (id) => `/(main)/medications/${id}`,
  billing: (id) => `/(main)/billing/${id}`,
  preventive: (id) => `/(main)/preventive/${id}`,
};

/** Category filter → source_type set. */
export function filterToSourceTypes(
  filter: TaskCategoryFilter,
): TaskSourceType[] | null {
  switch (filter) {
    case 'all':
      return null;
    case 'medications':
      return ['medication'];
    case 'appointments':
      return ['appointment'];
    case 'billing':
      return ['billing'];
    case 'preventive':
      return ['preventive'];
    case 'other':
      return ['manual', 'intent_sheet'];
  }
}

/**
 * Maps a task to its time group.
 *  - `today`: due today or overdue (or urgent with a near due date)
 *  - `this_week`: due within 7 days
 *  - `when_ready`: due >7 days out, or no due date
 */
export function getTaskTimeGroup(task: Task): TaskTimeGroup {
  if (!task.due_date) {
    // Urgent tasks without a due date still float to "today"
    if (task.priority === 'urgent') return 'today';
    return 'when_ready';
  }
  const due = new Date(task.due_date);
  if (Number.isNaN(due.getTime())) return 'when_ready';

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  if (due < endOfToday) return 'today'; // includes overdue
  const inSevenDays = new Date(startOfToday);
  inSevenDays.setDate(inSevenDays.getDate() + 8); // end of day 7
  if (due < inSevenDays) return 'this_week';
  return 'when_ready';
}

/** Extracts the best due date across a bundle's open tasks. */
function earliestOpenDueDate(tasks: Task[]): string | null {
  let best: string | null = null;
  for (const t of tasks) {
    if (t.status !== 'pending' && t.status !== 'in_progress') continue;
    if (!t.due_date) continue;
    if (!best || new Date(t.due_date) < new Date(best)) best = t.due_date;
  }
  return best;
}

function highestPriority(tasks: Task[]): Task['priority'] {
  return tasks.reduce<Task['priority']>((best, t) => {
    return PRIORITY_ORDER[t.priority] < PRIORITY_ORDER[best] ? t.priority : best;
  }, 'low');
}

/**
 * Build a display title for a bundle given its source type and a resolved
 * entity name (when available).
 */
function bundleTitle(
  sourceType: TaskSourceType,
  entityName: string | null,
): string {
  switch (sourceType) {
    case 'appointment':
      return entityName ? `Prepare for ${entityName}` : 'Appointment follow-ups';
    case 'billing':
      return entityName ? `${entityName} bill` : 'Bill follow-ups';
    case 'preventive':
      return entityName ?? 'Preventive screening';
    case 'medication':
      return entityName ?? 'Medication';
    case 'intent_sheet':
      return 'Document review follow-up';
    default:
      return SOURCE_TITLES[sourceType];
  }
}

/**
 * A short context line describing where a task came from. Used on task
 * cards and in the task detail header.
 */
export function buildContextLine(
  task: Task,
  entityName: string | null,
): string | null {
  switch (task.source_type) {
    case 'appointment':
      return entityName
        ? `From your appointment with ${entityName}`
        : 'From an appointment';
    case 'billing':
      return entityName ? `From your ${entityName} bill` : 'From a bill';
    case 'preventive':
      return entityName
        ? `Based on your ${entityName} screening`
        : 'Based on preventive care';
    case 'medication':
      return entityName ? `For ${entityName}` : 'Medication task';
    case 'intent_sheet':
      return 'From a document you reviewed';
    case 'manual':
      return null;
  }
}

/**
 * Group tasks by (source_type, source_ref). Bundles with a single task are
 * returned as individual tasks instead of a bundle.
 *
 * `entityNames` maps source_ref → display name (e.g. appointment title,
 * billing provider, medication drug_name). When missing, falls back to a
 * generic title.
 */
export function bundleTasks(
  tasks: Task[],
  entityNames: Record<string, string> = {},
): { bundles: TaskBundle[]; individuals: Task[] } {
  const groups = new Map<string, { sourceType: TaskSourceType; sourceRef: string; tasks: Task[] }>();
  const orphans: Task[] = [];

  for (const task of tasks) {
    if (!task.source_ref || task.source_type === 'manual') {
      orphans.push(task);
      continue;
    }
    const key = `${task.source_type}:${task.source_ref}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.tasks.push(task);
    } else {
      groups.set(key, {
        sourceType: task.source_type,
        sourceRef: task.source_ref,
        tasks: [task],
      });
    }
  }

  const bundles: TaskBundle[] = [];
  const individuals: Task[] = [...orphans];

  for (const group of groups.values()) {
    if (group.tasks.length < 2) {
      individuals.push(...group.tasks);
      continue;
    }
    const entityName = entityNames[group.sourceRef] ?? null;
    const completedCount = group.tasks.filter(
      (t) => t.status === 'completed',
    ).length;

    bundles.push({
      id: `${group.sourceType}:${group.sourceRef}`,
      title: bundleTitle(group.sourceType, entityName),
      sourceType: group.sourceType,
      sourceId: group.sourceRef,
      sourceRoute: SOURCE_ROUTES[group.sourceType](group.sourceRef),
      tasks: group.tasks,
      completedCount,
      totalCount: group.tasks.length,
      priority: highestPriority(group.tasks),
      personalizedPriority: 0,
      nextDueDate: earliestOpenDueDate(group.tasks),
      contextLine: buildContextLine(group.tasks[0], entityName) ?? '',
    });
  }

  return { bundles, individuals };
}

const GROUP_RANK: Record<TaskTimeGroup, number> = {
  today: 0,
  this_week: 1,
  when_ready: 2,
};

/**
 * Picks the most-urgent time group among a bundle's open tasks so the
 * bundle appears exactly once in the list.
 */
function bundleTimeGroup(bundle: TaskBundle): TaskTimeGroup {
  let best: TaskTimeGroup = 'when_ready';
  for (const t of bundle.tasks) {
    if (t.status !== 'pending' && t.status !== 'in_progress') continue;
    const g = getTaskTimeGroup(t);
    if (GROUP_RANK[g] < GROUP_RANK[best]) best = g;
  }
  return best;
}

/**
 * Given pre-built bundles and individuals, decorate them into a flat
 * TaskListEntry array for the specified time group, sorted by personalized
 * priority (highest first), then due date.
 */
export function buildListEntries(
  bundles: TaskBundle[],
  personalized: PersonalizedTask[],
  group: TaskTimeGroup,
): TaskListEntry[] {
  const bundleEntries: TaskListEntry[] = bundles
    .filter((b) => bundleTimeGroup(b) === group)
    .map((b) => ({ kind: 'bundle' as const, bundle: b }));

  const taskEntries: TaskListEntry[] = personalized
    .filter((t) => getTaskTimeGroup(t) === group)
    .map((t) => ({ kind: 'task' as const, task: t }));

  const all = [...bundleEntries, ...taskEntries];
  all.sort((a, b) => {
    const ap =
      a.kind === 'bundle' ? a.bundle.personalizedPriority : a.task.personalizedPriority;
    const bp =
      b.kind === 'bundle' ? b.bundle.personalizedPriority : b.task.personalizedPriority;
    if (bp !== ap) return bp - ap;
    const aDue =
      a.kind === 'bundle' ? a.bundle.nextDueDate : a.task.due_date;
    const bDue =
      b.kind === 'bundle' ? b.bundle.nextDueDate : b.task.due_date;
    if (aDue && bDue) return new Date(aDue).getTime() - new Date(bDue).getTime();
    if (aDue) return -1;
    if (bDue) return 1;
    return 0;
  });

  return all;
}
