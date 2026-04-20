import { useMutation, useQueryClient } from '@tanstack/react-query';
import { commitIntentSheet, updateIntentItemStatus } from '@/services/commit';
import type { CommitSummary } from '@/services/commit';
import { invalidateAskForProfile } from '@/services/askInvalidation';

/**
 * Mutation to commit all accepted/edited intent items for an intent sheet.
 * Care guidance level is now fetched internally by the commit engine.
 * Invalidates profile, artifact, intent sheet, and task queries on success.
 */
export function useCommitIntentSheet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      intentSheetId,
    }: {
      intentSheetId: string;
    }) => {
      const result = await commitIntentSheet(intentSheetId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['intentSheets'] });
      queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['profileGaps'] });
      // Commit can touch any domain — drop the entire response cache and
      // refetch the profile index for the affected profile.
      invalidateAskForProfile(queryClient, data?.profileId ?? null);
    },
  });
}

/**
 * Mutation to update a single intent item's status (accept/edit/reject).
 */
export function useUpdateIntentItemStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      status: 'accepted' | 'edited' | 'rejected';
      editedValue?: Record<string, unknown>;
    }) => {
      const result = await updateIntentItemStatus(
        params.itemId,
        params.status,
        params.editedValue,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intentSheets'] });
    },
  });
}

export type { CommitSummary };
