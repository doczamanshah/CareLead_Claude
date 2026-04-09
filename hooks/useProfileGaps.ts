import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { analyzeProfileGaps, fillProfileGap, fillGeneralGap } from '@/services/profileGaps';
import { useAuth } from '@/hooks/useAuth';

/**
 * Fetch profile gaps (missing data that would improve functionality).
 */
export function useProfileGaps(profileId: string | undefined) {
  return useQuery({
    queryKey: ['profileGaps', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await analyzeProfileGaps(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Mutation to fill a gap on an existing profile fact.
 */
export function useFillProfileGap() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      factId,
      fieldKey,
      value,
    }: {
      factId: string;
      fieldKey: string;
      value: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await fillProfileGap(factId, fieldKey, value, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profileGaps'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/**
 * Mutation to fill a general gap (create new profile fact).
 */
export function useFillGeneralGap() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      profileId,
      category,
      fieldKey,
      value,
    }: {
      profileId: string;
      category: string;
      fieldKey: string;
      value: Record<string, unknown>;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await fillGeneralGap(profileId, category, fieldKey, value, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profileGaps'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
