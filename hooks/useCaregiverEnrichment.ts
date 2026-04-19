import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  dismissCaregiverPrompt,
  getCaregiverEnrichmentPrompts,
  isCaregiverForProfile,
  isCaregiverOnboarded,
  markCaregiverOnboarded,
} from '@/services/caregiverEnrichment';
import type { CaregiverEnrichmentKind } from '@/lib/types/caregivers';

/** True iff the current user is a caregiver (not the owner) for this profile. */
export function useIsCaregiverForProfile(profileId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['caregiverEnrichment', 'role', user?.id, profileId],
    queryFn: async () => {
      if (!user?.id || !profileId) return false;
      const result = await isCaregiverForProfile(user.id, profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!user?.id && !!profileId,
  });
}

/** Whether the caregiver has already seen the welcome/contribute screen. */
export function useCaregiverOnboarded(profileId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['caregiverEnrichment', 'onboarded', user?.id, profileId],
    queryFn: async () => {
      if (!user?.id || !profileId) return true;
      return isCaregiverOnboarded(user.id, profileId);
    },
    enabled: !!user?.id && !!profileId,
  });
}

export function useMarkCaregiverOnboarded() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      await markCaregiverOnboarded(user.id, profileId);
      return profileId;
    },
    onSuccess: (profileId) => {
      queryClient.invalidateQueries({
        queryKey: ['caregiverEnrichment', 'onboarded', user?.id, profileId],
      });
    },
  });
}

/** Enrichment prompts for the Home briefing (max 2, cooldown-filtered). */
export function useCaregiverEnrichmentPrompts(
  profileId: string | null,
  householdId: string | null,
  max: number = 2,
) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['caregiverEnrichment', 'prompts', user?.id, profileId, max],
    queryFn: async () => {
      if (!user?.id || !profileId || !householdId) return [];
      const result = await getCaregiverEnrichmentPrompts(
        { caregiverId: user.id, profileId, householdId },
        max,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!user?.id && !!profileId && !!householdId,
  });
}

export function useDismissCaregiverPrompt() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      kind: CaregiverEnrichmentKind;
      profileId: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      await dismissCaregiverPrompt(user.id, params.kind, params.profileId);
      return params;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['caregiverEnrichment', 'prompts', user?.id],
      });
    },
  });
}
