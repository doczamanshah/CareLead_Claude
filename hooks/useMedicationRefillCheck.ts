/**
 * Hooks for the refill change-detection flow and skip-reason logging.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  logSkipReason,
  markMedicationRefilled,
  recordRefillChangeCheck,
  shouldPromptChangeCheck,
  stopMedication,
  switchMedication,
  type RefillChangeDetails,
  type RefillChangeType,
  type SkipReason,
} from '@/services/medicationRefillCheck';
import type { MedicationFrequency } from '@/lib/types/medications';
import { supabase } from '@/lib/supabase';
import { useLifeEventStore } from '@/stores/lifeEventStore';
import { detectLifeEventTriggers } from '@/services/lifeEventTriggers';
import type { ProfileFact } from '@/lib/types/profile';

/** Re-export the cooldown predicate so screens can decide whether to show the sheet. */
export { shouldPromptChangeCheck };

function invalidateMedQueries(queryClient: ReturnType<typeof useQueryClient>, profileId: string | null) {
  if (!profileId) return;
  queryClient.invalidateQueries({ queryKey: ['medications', 'list', profileId] });
  queryClient.invalidateQueries({ queryKey: ['medications', 'today', profileId] });
  queryClient.invalidateQueries({ queryKey: ['medications', 'refills', profileId] });
}

export function useMarkRefilled() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: { medicationId: string; profileId: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await markMedicationRefilled(params.medicationId, user.id);
      if (!result.success) throw new Error(result.error);
      return { ...result.data, medicationId: params.medicationId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['medications', 'detail', data.medicationId],
      });
      invalidateMedQueries(queryClient, data.profile_id);
    },
  });
}

export function useRecordRefillChangeCheck() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      medicationId: string;
      profileId: string;
      changeType: RefillChangeType;
      details?: RefillChangeDetails;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await recordRefillChangeCheck(
        {
          medicationId: params.medicationId,
          profileId: params.profileId,
          changeType: params.changeType,
          details: params.details,
        },
        user.id,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['medications', 'detail', variables.medicationId],
      });
      invalidateMedQueries(queryClient, variables.profileId);
    },
  });
}

export function useStopMedication() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      medicationId: string;
      profileId: string;
      reason?: string;
      source?: 'refill_check' | 'manual';
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await stopMedication(
        params.medicationId,
        params.reason,
        user.id,
        params.source ?? 'manual',
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({
        queryKey: ['medications', 'detail', data.id],
      });
      invalidateMedQueries(queryClient, data.profile_id);

      // Dispatch "medication_stopped" life-event prompts. Fire-and-forget.
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('household_id')
          .eq('id', data.profile_id)
          .maybeSingle();
        if (!profile?.household_id) return;

        const { data: factsData } = await supabase
          .from('profile_facts')
          .select('*')
          .eq('profile_id', data.profile_id)
          .is('deleted_at', null);
        const facts = (factsData ?? []) as ProfileFact[];

        const prompts = detectLifeEventTriggers({
          eventType: 'medication_stopped',
          eventData: {
            medicationId: data.id,
            drugName: data.drug_name,
          },
          profileId: data.profile_id,
          householdId: profile.household_id,
          existingProfileFacts: facts,
        });
        if (prompts.length > 0) {
          useLifeEventStore.getState().addPrompts(prompts);
        }
      } catch {
        // silent
      }
    },
  });
}

export function useSwitchMedication() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      oldMedicationId: string;
      profileId: string;
      newMed: {
        drug_name: string;
        dose_text?: string;
        frequency?: MedicationFrequency;
        frequency_text?: string;
      };
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await switchMedication(
        params.oldMedicationId,
        params.newMed,
        params.profileId,
        user.id,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['medications', 'detail', data.stopped.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['medications', 'detail', data.created.id],
      });
      invalidateMedQueries(queryClient, variables.profileId);
    },
  });
}

export function useLogSkipReason() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      medicationId: string;
      reason: SkipReason;
      freeformNote?: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await logSkipReason(
        params.medicationId,
        params.reason,
        user.id,
        params.freeformNote,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['medications', 'detail', variables.medicationId],
      });
    },
  });
}
