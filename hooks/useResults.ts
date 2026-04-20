import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  fetchResults,
  fetchResult,
  createResult,
  updateResult,
  deleteResult,
  togglePin,
  updateTags,
  fetchResultDocuments,
  uploadResultDocument,
  deleteResultDocument,
  fetchResultExtractJobs,
  fetchLabObservations,
  triggerResultExtraction,
  saveCorrections,
  confirmResult,
  type ResultCorrections,
} from '@/services/results';
import {
  fetchResultsBriefingItems,
  fetchResultsNeedsReviewCount,
} from '@/services/resultsBriefing';
import type {
  CreateResultInput,
  UpdateResultInput,
  DocumentSource,
  ResultType,
} from '@/lib/types/results';
import { invalidateAskByDomain } from '@/services/askInvalidation';

export function useResults(profileId: string | null) {
  return useQuery({
    queryKey: ['results', 'list', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchResults(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useResult(resultId: string | null) {
  return useQuery({
    queryKey: ['results', 'detail', resultId],
    queryFn: async () => {
      if (!resultId) throw new Error('No result ID');
      const result = await fetchResult(resultId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!resultId,
  });
}

export function useCreateResult() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateResultInput) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createResult(input, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['results', 'list', data.profile_id] });
      invalidateAskByDomain(queryClient, data.profile_id, 'results');
    },
  });
}

export function useUpdateResult() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      resultId,
      updates,
    }: {
      resultId: string;
      updates: UpdateResultInput;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateResult(resultId, updates, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['results', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['results', 'detail', data.id] });
      invalidateAskByDomain(queryClient, data.profile_id, 'results');
    },
  });
}

export function useDeleteResult() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (resultId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await deleteResult(resultId, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['results', 'list', data.profileId] });
      invalidateAskByDomain(queryClient, data.profileId, 'results');
    },
  });
}

export function useTogglePin() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      resultId,
      isPinned,
    }: {
      resultId: string;
      isPinned: boolean;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await togglePin(resultId, isPinned, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['results', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['results', 'detail', data.id] });
    },
  });
}

export function useUpdateTags() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      resultId,
      tags,
    }: {
      resultId: string;
      tags: string[];
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateTags(resultId, tags, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['results', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['results', 'detail', data.id] });
    },
  });
}

export function useResultDocuments(resultId: string | null) {
  return useQuery({
    queryKey: ['results', 'documents', resultId],
    queryFn: async () => {
      if (!resultId) return [];
      const result = await fetchResultDocuments(resultId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!resultId,
  });
}

export function useUploadResultDocument() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      resultId: string;
      profileId: string;
      householdId: string;
      fileUri: string;
      fileName: string;
      mimeType: string;
      source: DocumentSource;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await uploadResultDocument({ ...params, userId: user.id });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['results', 'documents', data.result_id] });
      queryClient.invalidateQueries({ queryKey: ['results', 'detail', data.result_id] });
      queryClient.invalidateQueries({ queryKey: ['results', 'list', data.profile_id] });
      invalidateAskByDomain(queryClient, data.profile_id, 'results');
    },
  });
}

export function useDeleteResultDocument() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (docId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await deleteResultDocument(docId, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['results', 'documents', data.resultId] });
      queryClient.invalidateQueries({ queryKey: ['results', 'detail', data.resultId] });
      queryClient.invalidateQueries({ queryKey: ['results', 'list', data.profileId] });
    },
  });
}

export function useExtractJobs(resultId: string | null) {
  return useQuery({
    queryKey: ['results', 'extractJobs', resultId],
    queryFn: async () => {
      if (!resultId) return [];
      const result = await fetchResultExtractJobs(resultId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!resultId,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasProcessing = data?.some((j) => j.status === 'processing') ?? false;
      return hasProcessing ? 3000 : false;
    },
  });
}

export function useTriggerExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      resultId: string;
      profileId: string;
      householdId: string;
      resultType: string;
      rawText?: string | null;
      documentId?: string | null;
    }) => {
      const result = await triggerResultExtraction(params);
      if (!result.success) throw new Error(result.error);
      return { ...result.data, resultId: params.resultId, profileId: params.profileId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['results', 'extractJobs', data.resultId] });
      queryClient.invalidateQueries({ queryKey: ['results', 'detail', data.resultId] });
      queryClient.invalidateQueries({ queryKey: ['results', 'list', data.profileId] });
      queryClient.invalidateQueries({ queryKey: ['results', 'labObservations', data.resultId] });
      invalidateAskByDomain(queryClient, data.profileId, 'labs');
    },
  });
}

export function useLabObservations(resultId: string | null) {
  return useQuery({
    queryKey: ['results', 'labObservations', resultId],
    queryFn: async () => {
      if (!resultId) return [];
      const result = await fetchLabObservations(resultId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!resultId,
  });
}

export function useSaveCorrections() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      resultId: string;
      corrections: ResultCorrections;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await saveCorrections(
        params.resultId,
        params.corrections,
        user.id,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['results', 'detail', data.id] });
      queryClient.invalidateQueries({ queryKey: ['results', 'list', data.profile_id] });
      invalidateAskByDomain(queryClient, data.profile_id, 'labs');
    },
  });
}

export function useResultsBriefing(profileId: string | null, max: number = 3) {
  return useQuery({
    queryKey: ['results', 'briefing', profileId, max],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchResultsBriefingItems(profileId, max);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useResultsNeedsReviewCount(profileId: string | null) {
  return useQuery({
    queryKey: ['results', 'needsReviewCount', profileId],
    queryFn: async () => {
      if (!profileId) return 0;
      const result = await fetchResultsNeedsReviewCount(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useConfirmResult() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      resultId: string;
      profileId: string;
      householdId: string;
      corrections: ResultCorrections;
      resultType: ResultType;
      structuredData: Record<string, unknown> | null;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await confirmResult(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['results', 'detail', data.id] });
      queryClient.invalidateQueries({ queryKey: ['results', 'list', data.profile_id] });
      queryClient.invalidateQueries({
        queryKey: ['results', 'labObservations', data.id],
      });
      invalidateAskByDomain(queryClient, data.profile_id, 'labs');
    },
  });
}
