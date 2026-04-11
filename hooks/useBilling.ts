import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  fetchBillingCases,
  fetchBillingCase,
  createBillingCase,
  updateBillingCase,
  deleteBillingCase,
  fetchBillingDocuments,
  uploadBillingDocument,
  deleteBillingDocument,
  triggerDocumentExtraction,
  triggerFreeformExtraction,
  fetchExtractionJobs,
  fetchLedgerLines,
} from '@/services/billing';
import type {
  CreateBillingCaseInput,
  UpdateBillingCaseInput,
  BillingDocType,
} from '@/lib/types/billing';

export function useBillingCases(profileId: string | null) {
  return useQuery({
    queryKey: ['billing', 'cases', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchBillingCases(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useBillingCase(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'case', caseId],
    queryFn: async () => {
      if (!caseId) throw new Error('No case ID');
      const result = await fetchBillingCase(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

export function useBillingDocuments(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'documents', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchBillingDocuments(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}

export function useCreateBillingCase() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: CreateBillingCaseInput) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createBillingCase(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profile_id] });
    },
  });
}

export function useUpdateBillingCase() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ caseId, updates }: { caseId: string; updates: UpdateBillingCaseInput }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateBillingCase(caseId, updates, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.id] });
    },
  });
}

export function useDeleteBillingCase() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ caseId, profileId }: { caseId: string; profileId: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await deleteBillingCase(caseId, user.id);
      if (!result.success) throw new Error(result.error);
      return { profileId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profileId] });
    },
  });
}

export function useUploadBillingDocument() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      caseId: string;
      profileId: string;
      householdId: string;
      docType: BillingDocType;
      fileUri: string;
      fileName: string;
      mimeType: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await uploadBillingDocument({ ...params, userId: user.id });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'documents', data.billing_case_id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.billing_case_id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profile_id] });
    },
  });
}

export function useDeleteBillingDocument() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ docId, caseId, profileId }: { docId: string; caseId: string; profileId: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await deleteBillingDocument(docId, user.id);
      if (!result.success) throw new Error(result.error);
      return { caseId, profileId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'documents', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profileId] });
    },
  });
}

// ── Extraction ────────────────────────────────────────────────────────────

export function useTriggerDocumentExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      documentId: string;
      caseId: string;
      profileId: string;
      householdId: string;
    }) => {
      const result = await triggerDocumentExtraction(
        params.documentId,
        params.caseId,
        params.profileId,
        params.householdId,
      );
      if (!result.success) throw new Error(result.error);
      return { ...result.data, caseId: params.caseId, profileId: params.profileId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'extractionJobs', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profileId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'ledgerLines', data.caseId] });
    },
  });
}

export function useTriggerFreeformExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      caseId: string;
      profileId: string;
      householdId: string;
      text: string;
    }) => {
      const result = await triggerFreeformExtraction(
        params.caseId,
        params.profileId,
        params.householdId,
        params.text,
      );
      if (!result.success) throw new Error(result.error);
      return { ...result.data, caseId: params.caseId, profileId: params.profileId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'extractionJobs', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', data.caseId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'cases', data.profileId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'ledgerLines', data.caseId] });
    },
  });
}

export function useExtractionJobs(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'extractionJobs', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchExtractionJobs(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasProcessing = data?.some((j) => j.status === 'processing') ?? false;
      return hasProcessing ? 3000 : false;
    },
  });
}

export function useLedgerLines(caseId: string | null) {
  return useQuery({
    queryKey: ['billing', 'ledgerLines', caseId],
    queryFn: async () => {
      if (!caseId) return [];
      const result = await fetchLedgerLines(caseId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!caseId,
  });
}
