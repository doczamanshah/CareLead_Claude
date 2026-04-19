import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';
import { runDataQualityCheck } from '@/services/dataQuality';
import {
  confirmStillCurrent,
  confirmStillCurrentBatch,
} from '@/services/dataQualityActions';
import {
  deriveDataQualityBriefingItem,
  markDataQualityBriefingDismissed,
  shouldShowDataQualityBriefing,
} from '@/services/dataQualityBriefing';
import type { ProfileFact } from '@/lib/types/profile';
import type { Medication } from '@/lib/types/medications';
import type { ResultLabObservation } from '@/lib/types/results';
import type {
  ConfirmCurrentParams,
  DataQualityReport,
  DataQualitySourceType,
} from '@/lib/types/dataQuality';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Fetch every slice the analyzer needs in parallel and run the synchronous
 * `runDataQualityCheck`. Cached for 1 hour because the analyzer is expensive
 * relative to other queries (multiple parallel fetches) and the underlying
 * data doesn't typically change minute-to-minute.
 */
export function useDataQualityCheck(
  profileId: string | null,
  householdId: string | null,
) {
  return useQuery<DataQualityReport>({
    queryKey: ['dataQuality', 'report', profileId],
    queryFn: async () => {
      if (!profileId || !householdId) {
        throw new Error('profileId and householdId are required');
      }

      const [factsRes, medsRes, labsRes] = await Promise.all([
        supabase
          .from('profile_facts')
          .select('*')
          .eq('profile_id', profileId)
          .is('deleted_at', null),
        supabase
          .from('med_medications')
          .select('*')
          .eq('profile_id', profileId)
          .is('deleted_at', null),
        supabase
          .from('result_lab_observations')
          .select('*')
          .eq('profile_id', profileId)
          .order('observed_at', { ascending: false, nullsFirst: false })
          .limit(200),
      ]);

      if (factsRes.error) throw new Error(factsRes.error.message);
      if (medsRes.error) throw new Error(medsRes.error.message);
      if (labsRes.error) throw new Error(labsRes.error.message);

      const profileFacts = (factsRes.data ?? []) as ProfileFact[];
      const medications = (medsRes.data ?? []) as Medication[];
      const labObservations = (labsRes.data ?? []) as ResultLabObservation[];

      return runDataQualityCheck({
        profileId,
        householdId,
        profileFacts,
        medications,
        labObservations,
      });
    },
    enabled: !!profileId && !!householdId,
    staleTime: ONE_HOUR_MS,
    gcTime: ONE_HOUR_MS,
  });
}

interface ConfirmCurrentMutationVars {
  sourceType: DataQualitySourceType;
  sourceId: string;
}

export function useConfirmCurrent(profileId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: ConfirmCurrentMutationVars) => {
      const params: ConfirmCurrentParams = {
        sourceType: vars.sourceType,
        sourceId: vars.sourceId,
        userId: user?.id ?? null,
      };
      const result = await confirmStillCurrent(params);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataQuality', 'report', profileId] });
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail', profileId] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'list', profileId] });
    },
  });
}

/**
 * Briefing item derived from the data quality report + cooldown gate. Returns
 * null when nothing should surface (no very_stale items OR cooldown active).
 */
export function useDataQualityBriefing(profileId: string | null, householdId: string | null) {
  const reportQuery = useDataQualityCheck(profileId, householdId);
  const cooldownQuery = useQuery({
    queryKey: ['dataQuality', 'briefingCooldown', profileId],
    queryFn: async () => {
      if (!profileId) return false;
      return shouldShowDataQualityBriefing(profileId);
    },
    enabled: !!profileId,
    staleTime: 60 * 60 * 1000,
  });

  const showCooldown = cooldownQuery.data ?? false;
  const item = deriveDataQualityBriefingItem(reportQuery.data ?? null);
  return showCooldown ? item : null;
}

export function useDismissDataQualityBriefing(profileId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!profileId) throw new Error('No profile');
      await markDataQualityBriefingDismissed(profileId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['dataQuality', 'briefingCooldown', profileId],
      });
    },
  });
}

export function useConfirmCurrentBatch(profileId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      items: Array<{ sourceType: DataQualitySourceType; sourceId: string }>,
    ) => {
      const result = await confirmStillCurrentBatch(items, user?.id ?? null);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataQuality', 'report', profileId] });
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail', profileId] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'list', profileId] });
    },
  });
}
