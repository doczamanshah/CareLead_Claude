import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  fetchAccessGrants,
  fetchMyAccessGrants,
  createInvite,
  fetchPendingInvites,
  acceptInvite,
  revokeInvite,
  cancelInvite,
  resendInvite,
  lookupInviteByToken,
  checkPendingInvitesForUser,
  revokeAccess,
  updatePermissions,
  fetchConsentHistory,
  fetchGrantConsentHistory,
  checkAccess,
} from '@/services/caregivers';
import type { PermissionTemplateId, PermissionScope } from '@/lib/constants/permissionTemplates';
import type { CreateInviteParams } from '@/lib/types/caregivers';
import { supabase } from '@/lib/supabase';
import { useLifeEventStore } from '@/stores/lifeEventStore';
import { detectLifeEventTriggers } from '@/services/lifeEventTriggers';
import type { ProfileFact } from '@/lib/types/profile';

// ── Queries ──────────────────────────────────────────────────────────

export function useAccessGrants(profileId: string | null) {
  return useQuery({
    queryKey: ['caregivers', 'grants', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchAccessGrants(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useMyAccessGrants() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['caregivers', 'my-grants', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const result = await fetchMyAccessGrants(user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!user?.id,
  });
}

export function usePendingInvites(householdId: string | null) {
  return useQuery({
    queryKey: ['caregivers', 'invites', householdId],
    queryFn: async () => {
      if (!householdId) return [];
      const result = await fetchPendingInvites(householdId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!householdId,
  });
}

export function useConsentHistory(profileId: string | null) {
  return useQuery({
    queryKey: ['caregivers', 'consent', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchConsentHistory(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useGrantConsentHistory(grantId: string | null) {
  return useQuery({
    queryKey: ['caregivers', 'grant-consent', grantId],
    queryFn: async () => {
      if (!grantId) return [];
      const result = await fetchGrantConsentHistory(grantId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!grantId,
  });
}

export function useCheckAccess(profileId: string | null, scope: PermissionScope) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['caregivers', 'check', user?.id, profileId, scope],
    queryFn: async () => {
      if (!user?.id || !profileId) return false;
      const result = await checkAccess(user.id, profileId, scope);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!user?.id && !!profileId,
  });
}

// ── Mutations ────────────────────────────────────────────────────────

export function useCreateInvite() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      householdId,
      params,
    }: {
      householdId: string;
      params: CreateInviteParams;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createInvite(householdId, params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['caregivers', 'invites', data.household_id] });

      // Fire "caregiver_added" life-event for each profile the invite shares —
      // best effort. A single prompt per profile on the inviter's Home.
      try {
        const caregiverName =
          data.invited_name?.trim() ||
          data.invited_email?.trim() ||
          data.invited_phone?.trim() ||
          'your caregiver';
        for (const sharedProfileId of data.profile_ids) {
          const { data: factsData } = await supabase
            .from('profile_facts')
            .select('*')
            .eq('profile_id', sharedProfileId)
            .is('deleted_at', null);
          const facts = (factsData ?? []) as ProfileFact[];
          const prompts = detectLifeEventTriggers({
            eventType: 'caregiver_added',
            eventData: {
              caregiverName,
              inviteId: data.id,
            },
            profileId: sharedProfileId,
            householdId: data.household_id,
            existingProfileFacts: facts,
          });
          if (prompts.length > 0) {
            useLifeEventStore.getState().addPrompts(prompts);
          }
        }
      } catch {
        // silent
      }
    },
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (token: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await acceptInvite(token, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregivers'] });
      queryClient.invalidateQueries({ queryKey: ['household'] });
    },
  });
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (inviteId: string) => {
      const result = await revokeInvite(inviteId, user?.id ?? '');
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['caregivers', 'invites', data.household_id] });
    },
  });
}

export function useCancelInvite() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (inviteId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await cancelInvite(inviteId, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['caregivers', 'invites', data.household_id] });
    },
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const result = await resendInvite(inviteId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}

export function useInviteLookup(token: string | null) {
  return useQuery({
    queryKey: ['caregivers', 'lookup', token],
    queryFn: async () => {
      if (!token) return null;
      const result = await lookupInviteByToken(token);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!token,
    retry: false,
  });
}

export function usePendingInvitesForMe(email: string | null, phone: string | null) {
  return useQuery({
    queryKey: ['caregivers', 'pending-for-me', email, phone],
    queryFn: async () => {
      if (!email && !phone) return [];
      const result = await checkPendingInvitesForUser(email, phone);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!(email || phone),
  });
}

export function useRevokeAccess() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (grantId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await revokeAccess(grantId, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['caregivers', 'grants', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['caregivers', 'consent', data.profile_id] });
    },
  });
}

export function useUpdatePermissions() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      grantId,
      newTemplate,
    }: {
      grantId: string;
      newTemplate: PermissionTemplateId;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updatePermissions(grantId, newTemplate, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['caregivers', 'grants', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['caregivers', 'consent', data.profile_id] });
      queryClient.invalidateQueries({
        queryKey: ['caregivers', 'grant-consent', data.id],
      });
    },
  });
}
