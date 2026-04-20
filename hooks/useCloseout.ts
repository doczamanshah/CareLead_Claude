/**
 * TanStack Query wrappers for the post-visit closeout flow.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  startCloseout,
  updateCloseout,
  fetchCloseoutForAppointment,
  fetchCloseoutWithOutcomes,
  processCloseoutSummary,
  processCloseoutDocument,
  updateOutcomeStatus,
  finalizeCloseout,
  generateVisitSummary,
  type UpdateCloseoutParams,
} from '@/services/closeout';
import type { OutcomeStatus } from '@/lib/types/appointments';
import { invalidateAskForProfile } from '@/services/askInvalidation';

export function useCloseoutForAppointment(appointmentId: string | null) {
  return useQuery({
    queryKey: ['closeouts', 'forAppointment', appointmentId],
    queryFn: async () => {
      if (!appointmentId) return null;
      const result = await fetchCloseoutForAppointment(appointmentId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!appointmentId,
  });
}

export function useCloseoutWithOutcomes(closeoutId: string | null) {
  return useQuery({
    queryKey: ['closeouts', 'detail', closeoutId],
    queryFn: async () => {
      if (!closeoutId) throw new Error('No closeout ID');
      const result = await fetchCloseoutWithOutcomes(closeoutId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!closeoutId,
  });
}

export function useStartCloseout() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (appointmentId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await startCloseout(appointmentId, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['closeouts', 'forAppointment', data.appointment_id],
      });
      queryClient.invalidateQueries({ queryKey: ['closeouts', 'detail', data.id] });
    },
  });
}

export function useUpdateCloseout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      closeoutId,
      params,
    }: {
      closeoutId: string;
      params: UpdateCloseoutParams;
    }) => {
      const result = await updateCloseout(closeoutId, params);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['closeouts', 'detail', data.id] });
      queryClient.invalidateQueries({
        queryKey: ['closeouts', 'forAppointment', data.appointment_id],
      });
    },
  });
}

export function useProcessCloseoutSummary() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      closeoutId,
      summaryText,
      profileId,
    }: {
      closeoutId: string;
      summaryText: string;
      profileId: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await processCloseoutSummary(
        closeoutId,
        summaryText,
        profileId,
        user.id,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['closeouts', 'detail', variables.closeoutId],
      });
    },
  });
}

export function useProcessCloseoutDocument() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      closeoutId,
      artifactId,
      profileId,
    }: {
      closeoutId: string;
      artifactId: string;
      profileId: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await processCloseoutDocument(
        closeoutId,
        artifactId,
        profileId,
        user.id,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['closeouts', 'detail', variables.closeoutId],
      });
    },
  });
}

export function useUpdateOutcomeStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      outcomeId,
      status,
      editedValue,
    }: {
      outcomeId: string;
      status: OutcomeStatus;
      editedValue?: Record<string, unknown>;
      closeoutId: string;
    }) => {
      const result = await updateOutcomeStatus(outcomeId, status, editedValue);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['closeouts', 'detail', variables.closeoutId],
      });
    },
  });
}

export function useFinalizeCloseout() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (closeoutId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await finalizeCloseout(closeoutId, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['closeouts', 'detail', data.closeout.id] });
      queryClient.invalidateQueries({
        queryKey: ['closeouts', 'forAppointment', data.appointment.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['appointments', 'detail', data.appointment.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['appointments', 'list', data.appointment.profile_id],
      });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail', data.appointment.profile_id] });
      // Closeout finalization writes profile facts and tasks across multiple
      // domains — drop the entire response cache.
      invalidateAskForProfile(queryClient, data.appointment.profile_id);
    },
  });
}

export function useGenerateVisitSummary() {
  return useMutation({
    mutationFn: async (closeoutId: string) => {
      const text = await generateVisitSummary(closeoutId);
      return text;
    },
  });
}
