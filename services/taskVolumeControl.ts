import type {
  PersonalizedTask,
  TaskBundle,
  TaskTier,
} from '@/lib/types/tasks';
import type { CareGuidanceLevel } from '@/services/commit';
import type { PatientPriorities } from '@/lib/types/priorities';
import { getTaskTimeGroup } from '@/services/taskBundling';

/**
 * Resolve a task's tier, falling back to priority when `context_json.tier`
 * is absent (legacy tasks).
 */
function getTier(task: PersonalizedTask): TaskTier {
  const t = task.context_json?.tier;
  if (t === 'critical' || t === 'important' || t === 'helpful') return t;
  if (task.priority === 'urgent') return 'critical';
  if (task.priority === 'high') return 'important';
  if (task.priority === 'medium') return 'helpful';
  return 'helpful';
}

function isOverdue(task: PersonalizedTask, now = new Date()): boolean {
  if (!task.due_date) return false;
  return new Date(task.due_date) < now;
}

/**
 * Apply volume control to a personalized task list. Volume caps prevent
 * overload for users who prefer less guidance, and hide low-tier tasks
 * entirely in "essentials" mode.
 *
 * Rules:
 *  - essentials: only critical + overdue-important. Max 5 in Today. No
 *    helpful tasks at all.
 *  - balanced: critical + important everywhere. Helpful only in "When
 *    You're Ready". Max 10 combined in Today + This Week.
 *  - comprehensive: unfiltered.
 */
export function applyVolumeControl(
  tasks: PersonalizedTask[],
  preference: CareGuidanceLevel,
): PersonalizedTask[] {
  if (preference === 'comprehensive') return tasks;

  const now = new Date();
  const filtered: PersonalizedTask[] = [];

  for (const task of tasks) {
    const tier = getTier(task);
    const group = getTaskTimeGroup(task);

    if (preference === 'essentials') {
      // Hide helpful tasks entirely.
      if (tier === 'helpful') continue;
      // Important tasks only show if overdue.
      if (tier === 'important' && !isOverdue(task, now)) continue;
      filtered.push(task);
      continue;
    }

    // Balanced: hide helpful unless it's in "When You're Ready" group
    if (preference === 'balanced') {
      if (tier === 'helpful' && group !== 'when_ready') continue;
      filtered.push(task);
    }
  }

  if (preference === 'essentials') {
    // Cap "today" at 5 (keep the highest personalized-priority ones)
    const today = filtered
      .filter((t) => getTaskTimeGroup(t) === 'today')
      .sort((a, b) => b.personalizedPriority - a.personalizedPriority);
    const rest = filtered.filter((t) => getTaskTimeGroup(t) !== 'today');
    const keptToday = today.slice(0, 5);
    return [...keptToday, ...rest];
  }

  if (preference === 'balanced') {
    // Cap Today + This Week combined at 10
    const active = filtered
      .filter((t) => {
        const g = getTaskTimeGroup(t);
        return g === 'today' || g === 'this_week';
      })
      .sort((a, b) => b.personalizedPriority - a.personalizedPriority);
    const whenReady = filtered.filter(
      (t) => getTaskTimeGroup(t) === 'when_ready',
    );
    const keptActive = active.slice(0, 10);
    return [...keptActive, ...whenReady];
  }

  return filtered;
}

/**
 * Apply the same volume-control rules to bundles. A bundle survives the
 * filter if any of its open tasks would survive.
 */
export function applyVolumeControlToBundles(
  bundles: TaskBundle[],
  preference: CareGuidanceLevel,
): TaskBundle[] {
  if (preference === 'comprehensive') return bundles;

  const now = new Date();

  const ok = (bundle: TaskBundle): boolean => {
    const openTasks = bundle.tasks.filter(
      (t) => t.status === 'pending' || t.status === 'in_progress',
    );
    return openTasks.some((t) => {
      const tier =
        (t.context_json?.tier as TaskTier | undefined) ??
        (t.priority === 'urgent'
          ? 'critical'
          : t.priority === 'high'
            ? 'important'
            : 'helpful');

      if (preference === 'essentials') {
        if (tier === 'critical') return true;
        if (tier === 'important' && t.due_date && new Date(t.due_date) < now) {
          return true;
        }
        return false;
      }
      // balanced
      if (tier === 'helpful') return false;
      return true;
    });
  };

  return bundles.filter(ok);
}

/**
 * Detect whether a source category has a dismissal rate >50%, signalling
 * fatigue. Returns a notice string if the user should be told the system
 * has noticed and is showing fewer of that type.
 */
export function detectDismissalFatigue(
  priorities: PatientPriorities | null,
): { category: string; note: string } | null {
  if (!priorities) return null;
  const rates = priorities.implicit_signals?.dismissalRateByCategory ?? {};
  for (const [cat, rate] of Object.entries(rates)) {
    if (rate > 0.5) {
      return {
        category: cat,
        note: `We noticed you often skip ${labelFor(cat)}. We'll show fewer of these.`,
      };
    }
  }
  return null;
}

function labelFor(sourceType: string): string {
  switch (sourceType) {
    case 'medication':
      return 'medication tasks';
    case 'appointment':
      return 'appointment tasks';
    case 'billing':
      return 'billing tasks';
    case 'preventive':
      return 'preventive-care tasks';
    default:
      return `${sourceType} tasks`;
  }
}

/**
 * Dampen personalized priority for categories with a high dismissal rate.
 * Runs AFTER calculatePersonalizedPriority and BEFORE volume control.
 */
export function applyDismissalDampening(
  tasks: PersonalizedTask[],
  priorities: PatientPriorities | null,
): PersonalizedTask[] {
  const rates = priorities?.implicit_signals?.dismissalRateByCategory ?? {};
  return tasks.map((t) => {
    const r = rates[t.source_type];
    if (typeof r === 'number' && r > 0.5) {
      return {
        ...t,
        personalizedPriority: Math.max(
          10,
          Math.round(t.personalizedPriority * 0.6),
        ),
      };
    }
    return t;
  });
}
