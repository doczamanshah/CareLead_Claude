import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { buildProfileIndex } from '@/services/profileIndex';
import { askProfile } from '@/services/askOrchestrator';
import {
  verifyFact,
  resolveConflict,
  type VerifyFactParams,
  type ResolveConflictParams,
} from '@/services/askVerify';
import type { AskResponse, ProfileIndex } from '@/lib/types/ask';

/**
 * useProfileIndex — the read-only, cross-domain index used by the Voice
 * Retrieval ("Ask Profile") engine. Cached for 5 minutes so repeated
 * queries within a session don't rebuild the index on every render.
 *
 * This hook is the foundation for the retrieval engine. It never writes
 * to the database.
 */
export function useProfileIndex(
  profileId: string | null,
  householdId: string | null,
) {
  return useQuery<ProfileIndex>({
    queryKey: ['ask', 'profileIndex', profileId, householdId],
    queryFn: async () => {
      if (!profileId || !householdId) {
        throw new Error('profileId and householdId are required');
      }
      const result = await buildProfileIndex(profileId, householdId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId && !!householdId,
    staleTime: 5 * 60 * 1000,
  });
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
 * the profile index on success so subsequent queries see the new status.
 */
export function useVerifyFact() {
  const qc = useQueryClient();
  return useMutation<void, Error, VerifyFactParams>({
    mutationFn: async (params) => {
      const result = await verifyFact(params);
      if (!result.success) throw new Error(result.error);
    },
    onSuccess: (_data, variables) => {
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
      qc.invalidateQueries({
        queryKey: ['ask', 'profileIndex', variables.profileId, variables.householdId],
      });
    },
  });
}
