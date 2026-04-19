import type { Task, TaskTier, TaskSourceType, PersonalizedTask } from '@/lib/types/tasks';
import type {
  PatientPriorities,
  FrictionCategory,
} from '@/lib/types/priorities';
import { buildContextLine } from '@/services/taskBundling';

/**
 * Base score by task tier (stored in context_json.tier) or by priority when
 * no tier is present. The score is intentionally coarse; personalization
 * adjustments (below) matter more than the starting point.
 */
export function baseScore(task: Task): number {
  const tier = task.context_json?.tier as TaskTier | undefined;
  if (tier === 'critical') return 90;
  if (tier === 'important') return 60;
  if (tier === 'helpful') return 30;

  // Fallback — map legacy priority to a score
  switch (task.priority) {
    case 'urgent':
      return 90;
    case 'high':
      return 65;
    case 'medium':
      return 40;
    case 'low':
      return 20;
  }
}

/**
 * Map a task's source_type to the FrictionCategory the patient may have
 * flagged. "manual" and "intent_sheet" have no direct friction category.
 */
function sourceToFrictionCategory(
  sourceType: TaskSourceType,
): FrictionCategory | null {
  switch (sourceType) {
    case 'medication':
      return 'medications';
    case 'appointment':
      return 'appointments';
    case 'billing':
      return 'billing';
    case 'preventive':
      return 'preventive';
    default:
      return null;
  }
}

/**
 * Compute a personalized priority score 10..100 for a task, given the
 * patient's stated priorities + implicit behavioral signals.
 *
 * Invisible to the user — they just see their most important stuff first.
 */
export function calculatePersonalizedPriority(
  task: Task,
  priorities: PatientPriorities | null,
): number {
  let score = baseScore(task);

  if (!priorities) {
    return Math.min(100, Math.max(10, score));
  }

  const sourceCategory = sourceToFrictionCategory(task.source_type);

  // Friction-point boost
  if (sourceCategory) {
    const hasFriction = priorities.friction_points.some(
      (fp) => fp.category === sourceCategory,
    );
    if (hasFriction) score *= 1.5;
  }

  // High-importance health priority match (keyword match against topic)
  const searchable = `${task.title} ${task.description ?? ''} ${task.trigger_source ?? ''}`.toLowerCase();
  for (const hp of priorities.health_priorities) {
    const topic = hp.topic?.toLowerCase();
    if (!topic) continue;
    if (searchable.includes(topic)) {
      score *= hp.importance === 'high' ? 1.5 : 1.2;
      break;
    }
  }

  // Condition of focus — strongest signal
  for (const cond of priorities.conditions_of_focus) {
    const c = cond?.toLowerCase();
    if (!c) continue;
    if (searchable.includes(c)) {
      score *= 2.0;
      break;
    }
  }

  // Tracking difficulty match
  for (const td of priorities.tracking_difficulties) {
    const cat = td.category?.toLowerCase();
    if (!cat) continue;
    if (searchable.includes(cat) || (sourceCategory && cat.includes(sourceCategory))) {
      score *= 1.3;
      break;
    }
  }

  // Implicit signals — boost categories the user engages with, dampen
  // categories they frequently dismiss.
  if (sourceCategory) {
    const signals = priorities.implicit_signals ?? {};
    const completion = signals.completionRateByCategory?.[task.source_type];
    const dismissal = signals.dismissalRateByCategory?.[task.source_type];
    if (typeof completion === 'number' && completion >= 0.7) score *= 1.2;
    if (typeof dismissal === 'number' && dismissal >= 0.4) score *= 0.7;
  }

  return Math.min(100, Math.max(10, Math.round(score)));
}

/**
 * Decorate a list of tasks with personalized priority and a context line.
 * `entityNames` maps source_ref → display name.
 */
export function personalizeTasks(
  tasks: Task[],
  priorities: PatientPriorities | null,
  entityNames: Record<string, string> = {},
): PersonalizedTask[] {
  return tasks.map((t) => {
    const base = baseScore(t);
    const personalized = calculatePersonalizedPriority(t, priorities);
    return {
      ...t,
      basePriority: base,
      personalizedPriority: personalized,
      boostedByPriority: priorities !== null && personalized >= base * 1.3,
      contextLine: buildContextLine(
        t,
        t.source_ref ? entityNames[t.source_ref] ?? null : null,
      ),
    };
  });
}
