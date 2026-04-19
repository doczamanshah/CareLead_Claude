import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  confirmReviewItem,
  confirmSection,
  generateProfileReview,
  getLastReviewedAt,
  getReviewFrequency,
  markBriefingDismissed,
  markReviewCompleted,
  removeReviewItem,
  setReviewFrequency,
  shouldShowProfileReview,
} from '@/services/profileReview';
import type {
  ProfileReviewItem,
  ProfileReviewSection,
  ReviewFrequency,
} from '@/lib/types/profile';

/** Whether the gentle "quarterly check-in" briefing nudge should surface. */
export function useProfileReviewDue(profileId: string | null) {
  return useQuery({
    queryKey: ['profileReview', 'due', profileId],
    queryFn: async () => {
      if (!profileId) return false;
      return shouldShowProfileReview(profileId);
    },
    enabled: !!profileId,
  });
}

/** Full snapshot of profile data grouped into review sections. */
export function useProfileReviewData(
  profileId: string | null,
  householdId: string | null,
) {
  return useQuery({
    queryKey: ['profileReview', 'data', profileId],
    queryFn: async () => {
      if (!profileId || !householdId) throw new Error('Missing params');
      const result = await generateProfileReview({ profileId, householdId });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId && !!householdId,
  });
}

/** Last-reviewed timestamp for display in Settings. */
export function useLastReviewedAt(profileId: string | null) {
  return useQuery({
    queryKey: ['profileReview', 'lastReviewed', profileId],
    queryFn: async () => {
      if (!profileId) return null;
      return getLastReviewedAt(profileId);
    },
    enabled: !!profileId,
  });
}

/** Review frequency preference (shared across profiles). */
export function useReviewFrequency() {
  return useQuery({
    queryKey: ['profileReview', 'frequency'],
    queryFn: () => getReviewFrequency(),
  });
}

export function useSetReviewFrequency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (freq: ReviewFrequency) => {
      await setReviewFrequency(freq);
      return freq;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profileReview', 'frequency'] });
      queryClient.invalidateQueries({ queryKey: ['profileReview', 'due'] });
    },
  });
}

export function useConfirmReviewItem() {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (item: ProfileReviewItem) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await confirmReviewItem(item, user.id);
      if (!result.success) throw new Error(result.error);
      return item;
    },
  });
}

export function useConfirmSection() {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (section: ProfileReviewSection) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await confirmSection(section, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}

export function useRemoveReviewItem() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      item,
      profileId,
    }: {
      item: ProfileReviewItem;
      profileId: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await removeReviewItem(item, profileId, user.id);
      if (!result.success) throw new Error(result.error);
      return item;
    },
    onSuccess: (_data, { profileId }) => {
      queryClient.invalidateQueries({ queryKey: ['medications'] });
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail', profileId] });
    },
  });
}

/** Mark the review as complete and bust the due query. */
export function useMarkReviewCompleted() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string) => {
      await markReviewCompleted(profileId);
      return profileId;
    },
    onSuccess: (profileId) => {
      queryClient.invalidateQueries({ queryKey: ['profileReview', 'due', profileId] });
      queryClient.invalidateQueries({
        queryKey: ['profileReview', 'lastReviewed', profileId],
      });
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail', profileId] });
      queryClient.invalidateQueries({ queryKey: ['medications'] });
    },
  });
}

/** Briefing nudge dismissal — 7-day cooldown. */
export function useDismissReviewBriefing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string) => {
      await markBriefingDismissed(profileId);
      return profileId;
    },
    onSuccess: (profileId) => {
      queryClient.invalidateQueries({ queryKey: ['profileReview', 'due', profileId] });
    },
  });
}
