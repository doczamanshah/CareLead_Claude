import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  addQuickPatientPriority,
  extractPriorities,
  fetchPatientPriorities,
  markPrioritiesPrompted,
  mergePatientPriorities,
  removePatientPriority,
  resetPatientPriorities,
  updateImplicitSignals,
  upsertPatientPriorities,
} from '@/services/patientPriorities';
import type {
  ExtractedPriorities,
  FrictionCategory,
  PatientPriorities,
} from '@/lib/types/priorities';

/**
 * Fetch the priorities row for a profile. Returns `null` when none exist.
 */
export function usePatientPriorities(profileId: string | null) {
  return useQuery<PatientPriorities | null>({
    queryKey: ['priorities', 'detail', profileId],
    queryFn: async () => {
      if (!profileId) return null;
      const result = await fetchPatientPriorities(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

/**
 * Run free-text through the Edge Function to produce structured priorities.
 * Does NOT persist — the caller shows a review card, then calls
 * useUpsertPatientPriorities.
 */
export function useExtractPriorities() {
  return useMutation({
    mutationFn: async ({
      text,
      profileName,
    }: {
      text: string;
      profileName: string | null;
    }) => {
      const result = await extractPriorities(text, profileName);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}

export function useUpsertPatientPriorities() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      profile_id: string;
      household_id: string;
      raw_input: string;
      extracted: ExtractedPriorities;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await upsertPatientPriorities(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['priorities', 'detail', data.profile_id],
      });
      // Personalized priority changed — re-fetch task list
      queryClient.invalidateQueries({
        queryKey: ['tasks', 'list', data.profile_id],
      });
      queryClient.invalidateQueries({ queryKey: ['taskBundles', data.profile_id] });
    },
  });
}

/**
 * Shared invalidation: priorities + task list + bundles must all refresh so
 * the task ordering updates immediately after a priority change.
 */
function invalidatePriorityAndTasks(
  queryClient: ReturnType<typeof useQueryClient>,
  profileId: string,
) {
  queryClient.invalidateQueries({
    queryKey: ['priorities', 'detail', profileId],
  });
  queryClient.invalidateQueries({ queryKey: ['tasks', 'list', profileId] });
  queryClient.invalidateQueries({ queryKey: ['taskBundles', profileId] });
}

export function useMergePriorities() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      profile_id: string;
      household_id: string;
      raw_input: string;
      extracted: ExtractedPriorities;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await mergePatientPriorities(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      invalidatePriorityAndTasks(queryClient, data.profile_id);
    },
  });
}

export function useAddQuickPriority() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      profile_id: string;
      household_id: string;
      topic: string;
      category: FrictionCategory;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await addQuickPatientPriority(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      invalidatePriorityAndTasks(queryClient, data.profile_id);
    },
  });
}

export function useRemovePriority() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      profile_id: string;
      household_id: string;
      kind: 'topic' | 'friction';
      value: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await removePatientPriority(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      invalidatePriorityAndTasks(queryClient, data.profile_id);
    },
  });
}

export function useResetPriorities() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: { profile_id: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await resetPatientPriorities(params.profile_id, user.id);
      if (!result.success) throw new Error(result.error);
      return params.profile_id;
    },
    onSuccess: (profileId) => {
      invalidatePriorityAndTasks(queryClient, profileId);
    },
  });
}

export function useMarkPrioritiesPrompted() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { profileId: string; householdId: string }) => {
      const result = await markPrioritiesPrompted(
        params.profileId,
        params.householdId,
      );
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['priorities', 'detail', vars.profileId],
      });
    },
  });
}

/**
 * Fire-and-forget implicit signal refresh. Safe to mount on the task list
 * screen — guarded by a 24-hour cooldown inside the service.
 */
export function useImplicitSignalRefresh(profileId: string | null) {
  useEffect(() => {
    if (!profileId) return;
    updateImplicitSignals(profileId).catch(() => {
      /* best-effort; no user-visible impact */
    });
  }, [profileId]);
}
