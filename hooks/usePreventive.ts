import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchRules,
  fetchPreventiveItems,
  fetchPreventiveItem,
  updatePreventiveItem,
  runAndPersistScan,
  fetchPreventiveItemEvents,
  updateLastDoneDate,
  deferItem,
  declineItem,
  reopenItem,
  createIntentSheet,
  commitIntentSheet,
  fetchIntentSheets,
  fetchIntentSheet,
  markAsCompleted,
  uploadPreventiveDocument,
  extractCompletionDate,
  reopenCompletedItem,
  getPreventiveDocumentUrl,
} from '@/services/preventive';
import { fetchPreventiveBriefingItems } from '@/services/preventiveBriefing';
import { useAuth } from '@/hooks/useAuth';
import type {
  PreventiveItem,
  PreventiveLastDoneSource,
  PreventiveIntentSheetContent,
} from '@/lib/types/preventive';

export function usePreventiveRules() {
  return useQuery({
    queryKey: ['preventive', 'rules'],
    queryFn: async () => {
      const result = await fetchRules();
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    staleTime: 1000 * 60 * 60, // rules change rarely — cache for an hour
  });
}

export function usePreventiveItems(profileId: string | null) {
  return useQuery({
    queryKey: ['preventive', 'items', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchPreventiveItems(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function usePreventiveItem(itemId: string | null) {
  return useQuery({
    queryKey: ['preventive', 'item', itemId],
    queryFn: async () => {
      if (!itemId) throw new Error('No item ID');
      const result = await fetchPreventiveItem(itemId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!itemId,
  });
}

export function usePreventiveItemEvents(itemId: string | null) {
  return useQuery({
    queryKey: ['preventive', 'itemEvents', itemId],
    queryFn: async () => {
      if (!itemId) return [];
      const result = await fetchPreventiveItemEvents(itemId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!itemId,
  });
}

export function useRunScan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { profileId: string; householdId: string }) => {
      const result = await runAndPersistScan(params.profileId, params.householdId);
      if (!result.success) throw new Error(result.error);
      return { ...result.data, profileId: params.profileId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['preventive', 'items', data.profileId] });
      queryClient.invalidateQueries({ queryKey: ['preventive', 'briefing', data.profileId] });
    },
  });
}

export function useUpdatePreventiveItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      updates: Parameters<typeof updatePreventiveItem>[1];
      createdBy?: 'user' | 'system' | 'extraction';
    }) => {
      const result = await updatePreventiveItem(
        params.itemId,
        params.updates,
        params.createdBy ?? 'user',
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data: PreventiveItem) => {
      queryClient.invalidateQueries({ queryKey: ['preventive', 'items', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['preventive', 'item', data.id] });
      queryClient.invalidateQueries({ queryKey: ['preventive', 'itemEvents', data.id] });
      queryClient.invalidateQueries({ queryKey: ['preventive', 'briefing', data.profile_id] });
    },
  });
}

function invalidatePreventiveCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  profileId: string,
  itemId: string,
) {
  queryClient.invalidateQueries({ queryKey: ['preventive', 'items', profileId] });
  queryClient.invalidateQueries({ queryKey: ['preventive', 'item', itemId] });
  queryClient.invalidateQueries({ queryKey: ['preventive', 'itemEvents', itemId] });
  queryClient.invalidateQueries({ queryKey: ['preventive', 'briefing', profileId] });
}

export function useUpdateLastDoneDate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      date: string | null;
      source: PreventiveLastDoneSource;
      profileId: string;
      householdId: string;
    }) => {
      const result = await updateLastDoneDate(
        params.itemId,
        params.date,
        params.source,
        params.profileId,
        params.householdId,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data: PreventiveItem) => {
      invalidatePreventiveCaches(queryClient, data.profile_id, data.id);
    },
  });
}

export function useDeferItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      deferredUntil: string | null;
      profileId: string;
      householdId: string;
    }) => {
      const result = await deferItem(
        params.itemId,
        params.deferredUntil,
        params.profileId,
        params.householdId,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data: PreventiveItem) => {
      invalidatePreventiveCaches(queryClient, data.profile_id, data.id);
    },
  });
}

export function useDeclineItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      reason: string | null;
      profileId: string;
      householdId: string;
    }) => {
      const result = await declineItem(
        params.itemId,
        params.reason,
        params.profileId,
        params.householdId,
      );
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data: PreventiveItem) => {
      invalidatePreventiveCaches(queryClient, data.profile_id, data.id);
    },
  });
}

export function useReopenItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      profileId: string;
      householdId: string;
    }) => {
      const result = await reopenItem(params.itemId, params.profileId, params.householdId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data: PreventiveItem) => {
      invalidatePreventiveCaches(queryClient, data.profile_id, data.id);
    },
  });
}

// ── Intent Sheets ───────────────────────────────────────────────────────────

export function useIntentSheets(profileId: string | null) {
  return useQuery({
    queryKey: ['preventive', 'intentSheets', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchIntentSheets(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useIntentSheet(sheetId: string | null) {
  return useQuery({
    queryKey: ['preventive', 'intentSheet', sheetId],
    queryFn: async () => {
      if (!sheetId) throw new Error('No sheet ID');
      const result = await fetchIntentSheet(sheetId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!sheetId,
  });
}

export function useCreateIntentSheet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      profileId: string;
      householdId: string;
      content: PreventiveIntentSheetContent;
    }) => {
      const result = await createIntentSheet(params);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (sheet) => {
      queryClient.invalidateQueries({
        queryKey: ['preventive', 'intentSheets', sheet.profile_id],
      });
    },
  });
}

// ── Document-Backed Completion ──────────────────────────────────────────────

export function useMarkAsCompleted() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      profileId: string;
      householdId: string;
      completionDate: string;
      source: 'user_reported' | 'document_backed';
      evidenceDocumentPath?: string | null;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await markAsCompleted({ ...params, userId: user.id });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data: PreventiveItem) => {
      invalidatePreventiveCaches(queryClient, data.profile_id, data.id);
      queryClient.invalidateQueries({ queryKey: ['tasks', 'list', data.profile_id] });
    },
  });
}

export function useUploadPreventiveDocument() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      profileId: string;
      householdId: string;
      fileUri: string;
      fileName: string;
      mimeType: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await uploadPreventiveDocument({ ...params, userId: user.id });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}

export function useReopenCompletedItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      profileId: string;
      householdId: string;
    }) => {
      const result = await reopenCompletedItem(params);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data: PreventiveItem) => {
      invalidatePreventiveCaches(queryClient, data.profile_id, data.id);
    },
  });
}

export function usePreventiveDocumentUrl(filePath: string | null) {
  return useQuery({
    queryKey: ['preventive', 'evidenceUrl', filePath],
    queryFn: async () => {
      if (!filePath) return null;
      const result = await getPreventiveDocumentUrl(filePath);
      if (!result.success) throw new Error(result.error);
      return result.data.url;
    },
    enabled: !!filePath,
    staleTime: 1000 * 60 * 5,
  });
}

export function useExtractCompletionDate() {
  return useMutation({
    mutationFn: async (params: {
      documentBase64: string;
      mimeType: string;
      screeningType: string;
      screeningTitle: string;
    }) => {
      const result = await extractCompletionDate(params);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}

export function usePreventiveBriefing(profileId: string | null, max: number = 2) {
  return useQuery({
    queryKey: ['preventive', 'briefing', profileId, max],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchPreventiveBriefingItems(profileId, max);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useCommitIntentSheet() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      sheetId: string;
      profileId: string;
      householdId: string;
      content: PreventiveIntentSheetContent;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await commitIntentSheet({ ...params, userId: user.id });
      if (!result.success) throw new Error(result.error);
      return {
        taskCount: result.data.taskCount,
        reminderCount: result.data.reminderCount,
        profileId: params.profileId,
        sheetId: params.sheetId,
      };
    },
    onSuccess: ({ profileId, sheetId }) => {
      queryClient.invalidateQueries({ queryKey: ['preventive', 'items', profileId] });
      queryClient.invalidateQueries({ queryKey: ['preventive', 'intentSheets', profileId] });
      queryClient.invalidateQueries({ queryKey: ['preventive', 'intentSheet', sheetId] });
      queryClient.invalidateQueries({ queryKey: ['preventive', 'briefing', profileId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'list', profileId] });
    },
  });
}
