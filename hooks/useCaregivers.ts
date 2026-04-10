import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  fetchAccessGrants,
  fetchMyAccessGrants,
  createInvite,
  fetchPendingInvites,
  acceptInvite,
  revokeInvite,
  revokeAccess,
  updatePermissions,
  fetchConsentHistory,
  fetchGrantConsentHistory,
  checkAccess,
} from '@/services/caregivers';
import type { PermissionTemplateId, PermissionScope } from '@/lib/constants/permissionTemplates';
import type { CreateInviteParams } from '@/lib/types/caregivers';

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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['caregivers', 'invites', data.household_id] });
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

  return useMutation({
    mutationFn: async (inviteId: string) => {
      const result = await revokeInvite(inviteId, '');
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['caregivers', 'invites', data.household_id] });
    },
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
