import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { runAllProactiveChecks } from '@/services/proactiveChecks';
import type { ProactiveSuggestion } from '@/lib/types/tasks';

const COOLDOWN_KEY = 'proactive_checks_last_run';
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

async function shouldRunChecks(): Promise<boolean> {
  try {
    const lastRun = await SecureStore.getItemAsync(COOLDOWN_KEY);
    if (!lastRun) return true;
    return Date.now() - parseInt(lastRun, 10) > COOLDOWN_MS;
  } catch {
    return true;
  }
}

async function markChecksRun(): Promise<void> {
  try {
    await SecureStore.setItemAsync(COOLDOWN_KEY, Date.now().toString());
  } catch {
    // Non-critical — worst case we run again next time
  }
}

/**
 * Runs proactive checks when the Home screen mounts, with a daily cooldown.
 * Returns suggestions and a dismiss function.
 */
export function useProactiveChecks(profileId: string | null) {
  const hasChecked = useRef(false);

  const {
    data: suggestions = [],
    isLoading,
    refetch,
  } = useQuery<ProactiveSuggestion[]>({
    queryKey: ['proactiveChecks', profileId],
    queryFn: async () => {
      if (!profileId) return [];

      const canRun = await shouldRunChecks();
      if (!canRun) {
        // Return cached suggestions if within cooldown
        return [];
      }

      const result = await runAllProactiveChecks(profileId);
      if (!result.success) return [];

      await markChecksRun();
      return result.data;
    },
    enabled: !!profileId && !hasChecked.current,
    staleTime: COOLDOWN_MS,
    gcTime: COOLDOWN_MS,
  });

  useEffect(() => {
    if (profileId && !hasChecked.current) {
      hasChecked.current = true;
    }
  }, [profileId]);

  const queryClient = useQueryClient();

  const dismissSuggestion = (suggestionId: string) => {
    queryClient.setQueryData<ProactiveSuggestion[]>(
      ['proactiveChecks', profileId],
      (old) => (old ?? []).filter((s) => s.id !== suggestionId),
    );
  };

  const forceRefresh = async () => {
    hasChecked.current = false;
    await SecureStore.deleteItemAsync(COOLDOWN_KEY);
    refetch();
  };

  return {
    suggestions,
    isLoading,
    dismissSuggestion,
    forceRefresh,
  };
}
