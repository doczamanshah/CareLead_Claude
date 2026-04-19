import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  extractPriorities,
  fetchPatientPriorities,
  markPrioritiesPrompted,
  updateImplicitSignals,
  upsertPatientPriorities,
} from '@/services/patientPriorities';
import type {
  ExtractedPriorities,
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
