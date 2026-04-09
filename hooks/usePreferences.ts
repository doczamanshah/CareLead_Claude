import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  getCareGuidanceLevel,
  setCareGuidanceLevel,
  getWeeklyDigestEnabled,
  setWeeklyDigestEnabled,
} from '@/services/preferences';
import type { CareGuidanceLevel } from '@/services/commit';

export function useCareGuidanceLevel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['preferences', 'care_guidance_level', user?.id],
    queryFn: async () => {
      if (!user?.id) return 'balanced' as CareGuidanceLevel;
      const result = await getCareGuidanceLevel(user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!user?.id,
  });

  const mutation = useMutation({
    mutationFn: async (level: CareGuidanceLevel) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await setCareGuidanceLevel(user.id, level);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['preferences', 'care_guidance_level'],
      });
    },
  });

  return {
    level: query.data ?? 'balanced' as CareGuidanceLevel,
    isLoading: query.isLoading,
    setLevel: mutation.mutate,
    isUpdating: mutation.isPending,
  };
}

export function useWeeklyDigest() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['preferences', 'weekly_digest_enabled', user?.id],
    queryFn: async () => {
      if (!user?.id) return true;
      const result = await getWeeklyDigestEnabled(user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!user?.id,
  });

  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await setWeeklyDigestEnabled(user.id, enabled);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['preferences', 'weekly_digest_enabled'],
      });
    },
  });

  return {
    enabled: query.data ?? true,
    isLoading: query.isLoading,
    setEnabled: mutation.mutate,
    isUpdating: mutation.isPending,
  };
}
