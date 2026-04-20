import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useProfileStore } from '@/stores/profileStore';
import {
  fetchUserProfiles,
  createDependentProfile,
  addFamilyMember,
  softDeleteProfile,
} from '@/services/profiles';
import type { RelationshipLabel } from '@/lib/types/profile';

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

export function useAddFamilyMember() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const profiles = useProfileStore((s) => s.profiles);

  const householdId = profiles[0]?.household_id;

  return useMutation({
    mutationFn: async (data: {
      name: string;
      relationship: Exclude<RelationshipLabel, 'self'>;
      dateOfBirth?: string;
      gender?: string;
    }) => {
      if (!householdId) throw new Error('No household found');
      const result = await addFamilyMember({
        householdId,
        ...data,
      });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles', 'list', user?.id] });
    },
  });
}

export function useRemoveFamilyMember() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (profileId: string) => {
      const result = await softDeleteProfile(profileId);
      if (!result.success) throw new Error(result.error);
      return profileId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles', 'list', user?.id] });
    },
  });
}
