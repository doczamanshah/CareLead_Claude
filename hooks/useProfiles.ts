import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useProfileStore } from '@/stores/profileStore';
import { fetchUserProfiles, createDependentProfile } from '@/services/profiles';
import type { Profile } from '@/lib/types/profile';

export function useProfiles() {
  const { user } = useAuth();
  const setProfiles = useProfileStore((s) => s.setProfiles);

  return useQuery({
    queryKey: ['profiles', 'list', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const result = await fetchUserProfiles(user.id);
      if (!result.success) throw new Error(result.error);
      setProfiles(result.data);
      return result.data;
    },
    enabled: !!user?.id,
  });
}

export function useCreateDependentProfile() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const profiles = useProfileStore((s) => s.profiles);

  // Get household from the first profile
  const householdId = profiles[0]?.household_id;

  return useMutation({
    mutationFn: async (data: {
      display_name: string;
      date_of_birth?: string;
      gender?: string;
    }) => {
      if (!householdId) throw new Error('No household found');
      const result = await createDependentProfile(householdId, data);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles', 'list', user?.id] });
    },
  });
}
