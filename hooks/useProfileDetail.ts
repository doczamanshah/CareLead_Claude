import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  fetchProfileDetail,
  updateProfile,
  addProfileFact,
  deleteProfileFact,
  fetchUserProfiles,
} from '@/services/profiles';
import { runAndPersistScan } from '@/services/preventive';
import { useProfileStore } from '@/stores/profileStore';
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
  const setProfiles = useProfileStore((s) => s.setProfiles);

  return useMutation({
    mutationFn: async (data: {
      display_name?: string;
      date_of_birth?: string | null;
      gender?: string | null;
    }) => {
      const result = await updateProfile(profileId, data);
      if (!result.success) throw new Error(result.error);
      return { profile: result.data, changed: data };
    },
    onSuccess: async ({ profile, changed }) => {
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail', profileId] });
      queryClient.invalidateQueries({ queryKey: ['profiles', 'list', user?.id] });

      // Refresh the Zustand profile store so activeProfile picks up the
      // new demographics immediately (gender/DOB drive preventive eligibility).
      if (user?.id) {
        const refreshed = await fetchUserProfiles(user.id);
        if (refreshed.success) setProfiles(refreshed.data);
      }

      // If gender or DOB changed, the engine needs to re-evaluate eligibility
      // (sex-specific and age-specific rules archive or re-emerge).
      const demographicsChanged =
        'gender' in changed || 'date_of_birth' in changed;
      if (demographicsChanged && profile.household_id) {
        try {
          await runAndPersistScan(profile.id, profile.household_id);
        } catch {
          // Non-fatal — user can manually rescan.
        }
        queryClient.invalidateQueries({ queryKey: ['preventive', 'items', profile.id] });
        queryClient.invalidateQueries({ queryKey: ['preventive', 'briefing', profile.id] });
        queryClient.invalidateQueries({ queryKey: ['preventive', 'metrics', profile.id] });
      }
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
