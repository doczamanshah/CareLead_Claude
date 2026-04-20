import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  fetchMedications,
  fetchMedicationDetail,
  createMedication,
  updateMedication,
  updateMedicationStatus,
  updateSupply,
  updateSig,
  logAdherence,
  fetchTodaysDoses,
  checkRefillStatus,
} from '@/services/medications';
import type {
  CreateMedicationParams,
  UpdateMedicationParams,
  UpdateSupplyParams,
  UpdateSigParams,
  AdherenceEventType,
  MedicationStatus,
} from '@/lib/types/medications';
import { invalidateAskByDomain } from '@/services/askInvalidation';

export function useMedications(profileId: string | null) {
  return useQuery({
    queryKey: ['medications', 'list', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchMedications(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useMedicationDetail(medicationId: string | null) {
  return useQuery({
    queryKey: ['medications', 'detail', medicationId],
    queryFn: async () => {
      if (!medicationId) throw new Error('No medication ID');
      const result = await fetchMedicationDetail(medicationId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!medicationId,
  });
}

export function useTodaysDoses(profileId: string | null) {
  return useQuery({
    queryKey: ['medications', 'today', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchTodaysDoses(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useRefillStatus(profileId: string | null) {
  return useQuery({
    queryKey: ['medications', 'refills', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await checkRefillStatus(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useCreateMedication() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: CreateMedicationParams) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createMedication(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['medications', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'today', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'refills', data.profile_id] });
      invalidateAskByDomain(queryClient, data.profile_id, 'medications');
    },
  });
}

export function useUpdateMedication() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ medicationId, params }: { medicationId: string; params: UpdateMedicationParams }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateMedication(medicationId, params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['medications', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'detail', data.id] });
      invalidateAskByDomain(queryClient, data.profile_id, 'medications');
    },
  });
}

export function useUpdateMedicationStatus() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ medicationId, status }: { medicationId: string; status: MedicationStatus }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateMedicationStatus(medicationId, status, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['medications', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'detail', data.id] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'today', data.profile_id] });
      invalidateAskByDomain(queryClient, data.profile_id, 'medications');
    },
  });
}

export function useUpdateSupply() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ medicationId, params }: { medicationId: string; params: UpdateSupplyParams }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateSupply(medicationId, params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['medications', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'detail', data.medication_id] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'refills', data.profile_id] });
      invalidateAskByDomain(queryClient, data.profile_id, 'medications');
    },
  });
}

export function useUpdateSig() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ medicationId, params }: { medicationId: string; params: UpdateSigParams }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateSig(medicationId, params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['medications', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'detail', data.medication_id] });
      invalidateAskByDomain(queryClient, data.profile_id, 'medications');
    },
  });
}

export function useLogAdherence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      medicationId,
      eventType,
      profileId,
      scheduledTime,
    }: {
      medicationId: string;
      eventType: AdherenceEventType;
      profileId: string;
      scheduledTime?: string;
    }) => {
      const result = await logAdherence(medicationId, eventType, profileId, scheduledTime);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['medications', 'today', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'detail', data.medication_id] });
    },
  });
}
