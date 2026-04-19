/**
 * Hooks for the structured post-visit capture flow + briefing.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  capturePostVisitData,
  recordCancelledAppointment,
  recordRescheduledAppointment,
  type CapturePostVisitParams,
} from '@/services/postVisitCapture';
import { fetchPostVisitBriefing } from '@/services/postVisitBriefing';

export function usePostVisitBriefing(profileId: string | null, max: number = 3) {
  return useQuery({
    queryKey: ['appointments', 'postVisitBriefing', profileId, max],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchPostVisitBriefing(profileId, max);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
    // Capture window is short — keep this fresh-ish so the briefing reflects
    // a finalized capture without a manual refresh.
    staleTime: 30_000,
  });
}

export function useCapturePostVisitData() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: Omit<CapturePostVisitParams, 'userId'>) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await capturePostVisitData({ ...params, userId: user.id });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      // Broad invalidation: capture touches meds, conditions (profile), tasks,
      // and the appointment itself.
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['medications'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail'] });
      queryClient.invalidateQueries({
        queryKey: ['appointments', 'detail', data.appointmentId],
      });
    },
  });
}

export function useRecordRescheduled() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: { appointmentId: string; newStartTime: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await recordRescheduledAppointment(
        params.appointmentId,
        params.newStartTime,
        user.id,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
}

export function useRecordCancelled() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (appointmentId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await recordCancelledAppointment(appointmentId, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
}
