import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchIntentSheetWithItems,
  fetchIntentSheetForArtifact,
  fetchPendingIntentSheets,
  triggerExtraction,
} from '@/services/extraction';
import { safeError } from '@/lib/utils/safeLog';
import type { TriggerExtractionParams } from '@/lib/types/intent-sheet';

/**
 * Fetch a single intent sheet with all its items.
 */
export function useIntentSheet(intentSheetId: string | undefined) {
  return useQuery({
    queryKey: ['intentSheets', 'detail', intentSheetId],
    queryFn: async () => {
      if (!intentSheetId) return null;
      const result = await fetchIntentSheetWithItems(intentSheetId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!intentSheetId,
  });
}

/**
 * Fetch the intent sheet associated with an artifact.
 */
export function useIntentSheetForArtifact(artifactId: string | undefined) {
  return useQuery({
    queryKey: ['intentSheets', 'byArtifact', artifactId],
    queryFn: async () => {
      if (!artifactId) return null;
      const result = await fetchIntentSheetForArtifact(artifactId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!artifactId,
  });
}

/**
 * Fetch all pending-review intent sheets for the active profile.
 */
export function usePendingIntentSheets(profileId: string | undefined) {
  return useQuery({
    queryKey: ['intentSheets', 'pending', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchPendingIntentSheets(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

/**
 * Mutation to trigger AI extraction for an artifact.
 * Invalidates intent sheet and artifact queries on success.
 */
export function useTriggerExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: TriggerExtractionParams) => {
      const result = await triggerExtraction(params);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onError: (error, variables) => {
      safeError(
        `[extraction] Mutation failed for artifact ${variables.artifactId}`,
        error,
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['intentSheets', 'pending', variables.profileId],
      });
      queryClient.invalidateQueries({
        queryKey: ['intentSheets', 'byArtifact', variables.artifactId],
      });
      queryClient.invalidateQueries({
        queryKey: ['artifacts', 'detail', variables.artifactId],
      });
      queryClient.invalidateQueries({
        queryKey: ['artifacts', 'list', variables.profileId],
      });
    },
  });
}
