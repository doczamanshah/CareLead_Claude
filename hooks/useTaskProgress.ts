import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  buildWeeklySummary,
  markStreakAnnounced,
  markWeeklySummaryShown,
  nextStreakCelebration,
  resetStreakAnnouncement,
  shouldShowWeeklySummary,
  trackTaskCompletion,
  type TaskProgressStats,
  type WeeklySummary,
} from '@/services/taskProgress';
import { useAuth } from './useAuth';

export function useTaskProgress(profileId: string | null) {
  return useQuery<TaskProgressStats>({
    queryKey: ['taskProgress', profileId],
    queryFn: async () => {
      if (!profileId) {
        return {
          completedToday: 0,
          completedThisWeek: 0,
          completedThisMonth: 0,
          streakDays: 0,
          topCategory: null,
          totalCompleted: 0,
        };
      }
      const result = await trackTaskCompletion(profileId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

/**
 * Fetches last week's summary and guards it behind a per-user "already
 * shown this week" SecureStore flag. Returns `null` until it's appropriate
 * to surface (user opted in via having ≥2 completions + no prior view).
 */
export function useWeeklySummary(
  profileId: string | null,
): WeeklySummary | null {
  const { user } = useAuth();
  const [summary, setSummary] = useState<WeeklySummary | null>(null);

  useEffect(() => {
    if (!profileId || !user?.id) return;
    let cancelled = false;
    (async () => {
      const result = await buildWeeklySummary(profileId);
      if (cancelled || !result.success || !result.data) return;
      const gate = await shouldShowWeeklySummary(
        user.id,
        result.data.weekStartIso,
      );
      if (cancelled || !gate) return;
      setSummary(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, user?.id]);

  return summary;
}

export async function dismissWeeklySummary(
  userId: string,
  weekStartIso: string,
): Promise<void> {
  await markWeeklySummaryShown(userId, weekStartIso);
}

/**
 * Returns the next streak celebration threshold (3, 7, 30) or null when
 * no new threshold has been crossed. Also quietly resets the announcement
 * marker when the streak breaks so the next milestone can fire later.
 */
export function useStreakCelebration(
  streakDays: number,
): 3 | 7 | 30 | null {
  const { user } = useAuth();
  const [threshold, setThreshold] = useState<3 | 7 | 30 | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      if (streakDays === 0) {
        await resetStreakAnnouncement(user.id);
        if (!cancelled) setThreshold(null);
        return;
      }
      const next = await nextStreakCelebration(user.id, streakDays);
      if (!cancelled) setThreshold(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, streakDays]);

  return threshold;
}

export async function dismissStreakCelebration(
  userId: string,
  threshold: 3 | 7 | 30,
): Promise<void> {
  await markStreakAnnounced(userId, threshold);
}
