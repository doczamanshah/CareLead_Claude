import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  fetchAppointments,
  fetchAppointmentDetail,
  createAppointment,
  updateAppointment,
  cancelAppointment,
  rescheduleAppointment,
  generateAppointmentVisitPrep,
  saveVisitPrep,
  addCaregiverSuggestion,
  updateCaregiverSuggestionStatus,
} from '@/services/appointments';
import type { CaregiverSuggestionStatus } from '@/lib/types/appointments';
import { generateVisitPacket } from '@/services/visitPacket';
import {
  processVisitPrepInput,
  mergeAdditionalInput,
} from '@/services/visitPrepProcessor';
import type {
  AppointmentFilter,
  CreateAppointmentParams,
  UpdateAppointmentParams,
  VisitPrep,
} from '@/lib/types/appointments';

export function useAppointments(profileId: string | null, filters?: AppointmentFilter) {
  return useQuery({
    queryKey: ['appointments', 'list', profileId, filters],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchAppointments(profileId, filters);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useAppointmentDetail(appointmentId: string | null) {
  return useQuery({
    queryKey: ['appointments', 'detail', appointmentId],
    queryFn: async () => {
      if (!appointmentId) throw new Error('No appointment ID');
      const result = await fetchAppointmentDetail(appointmentId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!appointmentId,
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: CreateAppointmentParams) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createAppointment(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['appointments', 'list', data.profile_id] });
    },
  });
}

export function useUpdateAppointment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      appointmentId,
      params,
    }: {
      appointmentId: string;
      params: UpdateAppointmentParams;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateAppointment(appointmentId, params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['appointments', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['appointments', 'detail', data.id] });
    },
  });
}

export function useCancelAppointment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (appointmentId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await cancelAppointment(appointmentId, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['appointments', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['appointments', 'detail', data.id] });
    },
  });
}

export function useRescheduleAppointment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      appointmentId,
      newData,
    }: {
      appointmentId: string;
      newData: CreateAppointmentParams;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await rescheduleAppointment(appointmentId, newData, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['appointments', 'list', data.profile_id] });
    },
  });
}

/**
 * Generate the initial Visit Prep object for an appointment. Idempotent —
 * if prep already exists it returns the existing prep unchanged.
 */
export function useGenerateVisitPrep() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (appointmentId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await generateAppointmentVisitPrep(appointmentId, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['appointments', 'detail', data.id] });
      queryClient.invalidateQueries({ queryKey: ['appointments', 'list', data.profile_id] });
    },
  });
}

/**
 * Persist edited Visit Prep and (re)create the small set of related tasks.
 */
export function useSaveVisitPrep() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      appointmentId,
      prep,
      markReady,
    }: {
      appointmentId: string;
      prep: VisitPrep;
      markReady?: boolean;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await saveVisitPrep(appointmentId, prep, user.id, {
        markReady,
      });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['appointments', 'detail', data.appointment.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['appointments', 'list', data.appointment.profile_id],
      });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] });
    },
  });
}

/**
 * Process raw patient input into a structured VisitPrep using the
 * process-visit-prep Edge Function. Does NOT persist — call useSaveVisitPrep
 * after the user reviews the result.
 */
export function useProcessVisitPrepInput() {
  return useMutation({
    mutationFn: async ({
      appointmentId,
      patientInput,
      profileId,
    }: {
      appointmentId: string;
      patientInput: string;
      profileId: string;
    }) => {
      const result = await processVisitPrepInput(
        appointmentId,
        patientInput,
        profileId,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}

/**
 * Merge an additional round of patient input into an existing VisitPrep.
 */
export function useMergeVisitPrepInput() {
  return useMutation({
    mutationFn: async ({
      appointmentId,
      existingPrep,
      additionalInput,
      profileId,
    }: {
      appointmentId: string;
      existingPrep: VisitPrep;
      additionalInput: string;
      profileId: string;
    }) => {
      const result = await mergeAdditionalInput(
        appointmentId,
        existingPrep,
        additionalInput,
        profileId,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}

/**
 * Caregiver adds a suggestion to a shared visit prep.
 */
export function useAddCaregiverSuggestion() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      appointmentId,
      text,
      fromName,
    }: {
      appointmentId: string;
      text: string;
      fromName: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await addCaregiverSuggestion(appointmentId, {
        from_user_id: user.id,
        from_name: fromName,
        text,
      });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['appointments', 'detail', data.appointment.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['appointments', 'list', data.appointment.profile_id],
      });
    },
  });
}

/**
 * Patient accepts or dismisses a caregiver suggestion.
 */
export function useUpdateCaregiverSuggestionStatus() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      appointmentId,
      suggestionId,
      status,
    }: {
      appointmentId: string;
      suggestionId: string;
      status: CaregiverSuggestionStatus;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateCaregiverSuggestionStatus(
        appointmentId,
        suggestionId,
        status,
        user.id,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['appointments', 'detail', data.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['appointments', 'list', data.profile_id],
      });
    },
  });
}

/**
 * Generate (and persist) the Visit Packet text for an appointment.
 */
export function useGenerateVisitPacket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appointmentId,
      profileId,
    }: {
      appointmentId: string;
      profileId: string;
    }) => {
      const result = await generateVisitPacket(appointmentId, profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, { appointmentId }) => {
      queryClient.invalidateQueries({
        queryKey: ['appointments', 'detail', appointmentId],
      });
    },
  });
}
