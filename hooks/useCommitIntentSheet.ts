import { useMutation, useQueryClient } from '@tanstack/react-query';
import { commitIntentSheet, updateIntentItemStatus } from '@/services/commit';

/**
 * Mutation to commit all accepted/edited intent items for an intent sheet.
 * Invalidates profile, artifact, intent sheet, and task queries on success.
 */
export function useCommitIntentSheet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (intentSheetId: string) => {
      const result = await commitIntentSheet(intentSheetId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, intentSheetId) => {
      // Invalidate everything that may have changed
      queryClient.invalidateQueries({ queryKey: ['intentSheets'] });
      queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
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
