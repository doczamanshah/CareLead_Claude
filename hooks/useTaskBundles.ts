import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTasks } from './useTasks';
import { usePatientPriorities } from './usePatientPriorities';
import { useCareGuidanceLevel } from './usePreferences';
import { resolveTaskEntityNames } from '@/services/taskEntityResolver';
import { bundleTasks } from '@/services/taskBundling';
import { personalizeTasks } from '@/services/taskPrioritization';
import {
  applyDismissalDampening,
  applyVolumeControl,
  applyVolumeControlToBundles,
  detectDismissalFatigue,
} from '@/services/taskVolumeControl';
import { PRIORITY_ORDER } from '@/lib/types/tasks';
import type {
  TaskBundle,
  PersonalizedTask,
  TaskFilter,
  TaskSourceType,
} from '@/lib/types/tasks';

interface UseTaskBundlesResult {
  bundles: TaskBundle[];
  individuals: PersonalizedTask[];
  personalizedAll: PersonalizedTask[];
  /** Notice string when a category is being auto-suppressed due to fatigue. */
  fatigueNote: string | null;
  isLoading: boolean;
  error: unknown;
}

/**
 * Load tasks + priorities + entity names and return bundled, personalized
 * output ready for rendering.
 */
export function useTaskBundles(
  profileId: string | null,
  filter?: TaskFilter,
): UseTaskBundlesResult {
  const { data: tasks, isLoading: tasksLoading, error: tasksError } = useTasks(
    profileId,
    filter,
  );
  const { data: priorities, isLoading: prioritiesLoading } =
    usePatientPriorities(profileId);
  const { level: careGuidance } = useCareGuidanceLevel();
  // Only apply volume control to the active/open view — completed & all
  // bypass suppression so users can audit their full history.
  const applyVolumeRules =
    !filter?.status ||
    (Array.isArray(filter.status)
      ? filter.status.includes('pending') || filter.status.includes('in_progress')
      : filter.status === 'pending' || filter.status === 'in_progress');

  const refKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const t of tasks ?? []) {
      if (t.source_ref) keys.add(`${t.source_type}:${t.source_ref}`);
    }
    return Array.from(keys).sort();
  }, [tasks]);

  const { data: entityNames, isLoading: namesLoading } = useQuery<Record<string, string>>({
    queryKey: ['taskEntityNames', profileId, refKeys],
    queryFn: async () => {
      if (!tasks || tasks.length === 0) return {};
      const result = await resolveTaskEntityNames(tasks);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!tasks && tasks.length > 0,
  });

  const result = useMemo((): Omit<UseTaskBundlesResult, 'isLoading' | 'error'> => {
    if (!tasks || tasks.length === 0) {
      return {
        bundles: [],
        individuals: [],
        personalizedAll: [],
        fatigueNote: null,
      };
    }

    const names = entityNames ?? {};
    const { bundles, individuals } = bundleTasks(tasks, names);

    let personalizedAll = personalizeTasks(tasks, priorities ?? null, names);
    let personalizedIndividuals = personalizeTasks(
      individuals,
      priorities ?? null,
      names,
    );

    // Dampen categories the user frequently dismisses
    personalizedAll = applyDismissalDampening(personalizedAll, priorities ?? null);
    personalizedIndividuals = applyDismissalDampening(
      personalizedIndividuals,
      priorities ?? null,
    );

    // Compute bundle-level personalized priority = max of open task scores
    const personalizedById = new Map<string, number>();
    for (const pt of personalizedAll) personalizedById.set(pt.id, pt.personalizedPriority);

    let decoratedBundles: TaskBundle[] = bundles.map((b) => {
      let best = 0;
      let bestTierPriority: TaskBundle['priority'] = b.priority;
      for (const t of b.tasks) {
        if (t.status !== 'pending' && t.status !== 'in_progress') continue;
        const s = personalizedById.get(t.id) ?? 0;
        if (s > best) best = s;
        if (PRIORITY_ORDER[t.priority] < PRIORITY_ORDER[bestTierPriority]) {
          bestTierPriority = t.priority;
        }
      }
      return { ...b, personalizedPriority: best, priority: bestTierPriority };
    });

    // Apply volume control only to open views
    if (applyVolumeRules) {
      personalizedIndividuals = applyVolumeControl(
        personalizedIndividuals,
        careGuidance,
      );
      decoratedBundles = applyVolumeControlToBundles(
        decoratedBundles,
        careGuidance,
      );
    }

    const fatigue = applyVolumeRules
      ? detectDismissalFatigue(priorities ?? null)
      : null;

    return {
      bundles: decoratedBundles,
      individuals: personalizedIndividuals,
      personalizedAll,
      fatigueNote: fatigue?.note ?? null,
    };
  }, [tasks, priorities, entityNames, careGuidance, applyVolumeRules]);

  return {
    ...result,
    isLoading: tasksLoading || prioritiesLoading || namesLoading,
    error: tasksError,
  };
}

/** Filter bundles to only those whose sourceType is in the allowed set. */
export function filterBundlesByCategory(
  bundles: TaskBundle[],
  sourceTypes: TaskSourceType[] | null,
): TaskBundle[] {
  if (!sourceTypes) return bundles;
  const allowed = new Set(sourceTypes);
  return bundles.filter((b) => allowed.has(b.sourceType));
}

/** Filter individual tasks to only those whose source_type is in the allowed set. */
export function filterTasksByCategory(
  tasks: PersonalizedTask[],
  sourceTypes: TaskSourceType[] | null,
): PersonalizedTask[] {
  if (!sourceTypes) return tasks;
  const allowed = new Set(sourceTypes);
  return tasks.filter((t) => allowed.has(t.source_type));
}
