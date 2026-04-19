import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  uploadAndExtractHealthSummary,
  commitHealthSummaryImport,
  detectDuplicates,
  type UploadHealthSummaryParams,
  type CommitImportParams,
  type HealthSummaryExtraction,
  type DuplicateMap,
} from '@/services/healthSummaryImport';

export function useUploadHealthSummary() {
  return useMutation({
    mutationFn: async (params: UploadHealthSummaryParams) => {
      const res = await uploadAndExtractHealthSummary(params);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
}

export function useDetectImportDuplicates() {
  return useMutation({
    mutationFn: async ({
      profileId,
      extraction,
    }: {
      profileId: string;
      extraction: HealthSummaryExtraction;
    }): Promise<DuplicateMap> => detectDuplicates(profileId, extraction),
  });
}

export function useCommitHealthSummaryImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: CommitImportParams) => {
      const res = await commitHealthSummaryImport(params);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['medications', 'list', variables.profileId] });
      queryClient.invalidateQueries({ queryKey: ['medications', 'today', variables.profileId] });
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail', variables.profileId] });
      queryClient.invalidateQueries({ queryKey: ['profile', 'facts', variables.profileId] });
      queryClient.invalidateQueries({ queryKey: ['results'] });
      queryClient.invalidateQueries({ queryKey: ['preventive'] });
      queryClient.invalidateQueries({ queryKey: ['artifacts', 'list', variables.profileId] });
    },
  });
}
