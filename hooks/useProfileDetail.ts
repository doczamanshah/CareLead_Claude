import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  fetchProfileDetail,
  updateProfile,
  addProfileFact,
  deleteProfileFact,
} from '@/services/profiles';
import type { ProfileFact } from '@/lib/types/profile';

export function useProfileDetail(profileId: string | null) {
  return useQuery({
    queryKey: ['profile', 'detail', profileId],
    queryFn: async () => {
      if (!profileId) throw new Error('No profile ID');
      const result = await fetchProfileDetail(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useUpdateProfile(profileId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (data: {
      display_name?: string;
      date_of_birth?: string | null;
      gender?: string | null;
    }) => {
      const result = await updateProfile(profileId, data);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail', profileId] });
      queryClient.invalidateQueries({ queryKey: ['profiles', 'list', user?.id] });
    },
  });
}

export function useAddProfileFact(profileId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (fact: {
      category: ProfileFact['category'];
      field_key: string;
      value_json: Record<string, unknown>;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await addProfileFact(profileId, user.id, fact);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail', profileId] });
    },
  });
}

export function useDeleteProfileFact(profileId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (factId: string) => {
      const result = await deleteProfileFact(factId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail', profileId] });
    },
  });
}
