import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { buildProfileIndex } from '@/services/profileIndex';
import { askProfile } from '@/services/askOrchestrator';
import { askCache } from '@/services/askCache';
import {
  verifyFact,
  resolveConflict,
  type VerifyFactParams,
  type ResolveConflictParams,
} from '@/services/askVerify';
import type { AskResponse, ProfileIndex } from '@/lib/types/ask';

const PROFILE_INDEX_STALE_MS = 5 * 60 * 1000; // 5 min — data rarely changes mid-session
const PROFILE_INDEX_GC_MS = 10 * 60 * 1000; // 10 min — keep around for back-nav

/** Build the TanStack Query options object the index hook + prefetch share. */
function profileIndexQueryOptions(
  profileId: string | null,
  householdId: string | null,
) {
  return {
    queryKey: ['ask', 'profileIndex', profileId, householdId] as const,
    queryFn: async (): Promise<ProfileIndex> => {
      if (!profileId || !householdId) {
        throw new Error('profileId and householdId are required');
      }
      const buildStart = Date.now();
      const result = await buildProfileIndex(profileId, householdId);
      if (!result.success) throw new Error(result.error);
      if (__DEV__) {
        console.log(
          `[Ask] indexBuild profileId=${profileId} facts=${result.data.facts.length} time=${
            Date.now() - buildStart
          }ms`,
        );
      }
      return result.data;
    },
    staleTime: PROFILE_INDEX_STALE_MS,
    gcTime: PROFILE_INDEX_GC_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false as const,
  };
}

/**
 * useProfileIndex — the read-only, cross-domain index used by the Voice
 * Retrieval ("Ask Profile") engine. Cached for 5 minutes; reused across
 * mounts within that window so the Ask screen feels instant after the
 * first build.
 *
 * Pair with `prefetchProfileIndex` (from Home or anywhere idle) to warm
 * the cache before the user navigates here.
 */
export function useProfileIndex(
  profileId: string | null,
  householdId: string | null,
) {
  const opts = profileIndexQueryOptions(profileId, householdId);
  return useQuery<ProfileIndex>({
    ...opts,
    enabled: !!profileId && !!householdId,
  });
}

/**
 * Prefetch the profile index into the TanStack Query cache. Safe to call
 * speculatively — if the data is already cached and fresh, nothing happens.
 *
 * Use from screens where the user is likely to ask a question soon (Home,
 * Ask screen mount). Cost is just DB queries, no AI.
 */
export function prefetchProfileIndex(
  queryClient: QueryClient,
  profileId: string | null,
  householdId: string | null,
): void {
  if (!profileId || !householdId) return;
  const opts = profileIndexQueryOptions(profileId, householdId);
  // prefetchQuery is a no-op if data exists and is fresh per staleTime.
  queryClient.prefetchQuery(opts);
}

/**
 * Hook that prefetches the profile index on mount. Use on screens where the
 * user is likely to open Ask soon. Safe to mount on Home — pre-builds in
 * the background, ready when they tap the FAB.
 */
export function usePrefetchProfileIndex(
  profileId: string | null,
  householdId: string | null,
): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    prefetchProfileIndex(queryClient, profileId, householdId);
  }, [queryClient, profileId, householdId]);
}

export interface AskProfileMutationParams {
  query: string;
  profileIndex: ProfileIndex;
  profileId: string;
  householdId: string;
}

/**
 * useAskProfile — mutation that executes a natural-language question against
 * a pre-built ProfileIndex. Deterministic path first, AI fallback only for
 * queries the router can't classify.
 */
export function useAskProfile() {
  return useMutation<AskResponse, Error, AskProfileMutationParams>({
    mutationFn: async ({ query, profileIndex, profileId, householdId }) => {
      const result = await askProfile({ query, profileIndex, profileId, householdId });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}

/**
 * useVerifyFact — marks a fact as verified in its source table (or records an
 * audit-only verification for sources without a verification column). Rebuilds
 * the profile index AND drops the response cache so subsequent queries see
 * the new status.
 */
export function useVerifyFact() {
  const qc = useQueryClient();
  return useMutation<void, Error, VerifyFactParams>({
    mutationFn: async (params) => {
      const result = await verifyFact(params);
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: (_data, variables) => {
      askCache.invalidate();
      qc.invalidateQueries({
        queryKey: ['ask', 'profileIndex', variables.profileId, variables.householdId],
      });
    },
  });
}

/**
 * useResolveConflict — commits a conflict resolution: the kept fact is
 * verified, the losing facts are archived per their source-table semantics.
 */
export function useResolveConflict() {
  const qc = useQueryClient();
  return useMutation<void, Error, ResolveConflictParams>({
    mutationFn: async (params) => {
      const result = await resolveConflict(params);
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: (_data, variables) => {
      askCache.invalidate();
      qc.invalidateQueries({
        queryKey: ['ask', 'profileIndex', variables.profileId, variables.householdId],
      });
    },
  });
}
