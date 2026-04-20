/**
 * Voice Retrieval ("Ask Profile") — Invalidation helpers
 *
 * Centralized cache-busting for the Ask retrieval system. Anywhere profile
 * data mutates, call one of these helpers from the mutation's `onSuccess`
 * to keep cached answers from going stale.
 *
 * What gets invalidated:
 *   - Response cache (services/askCache.ts) — full or domain-scoped
 *   - Profile index TanStack Query — keyed by `['ask', 'profileIndex', …]`
 *
 * Usage in a hook:
 *   const qc = useQueryClient();
 *   useMutation({
 *     ...,
 *     onSuccess: (data) => {
 *       qc.invalidateQueries({ queryKey: ['medications', ...] });
 *       invalidateAskForProfile(qc, data.profile_id, 'medications');
 *     },
 *   });
 */

import type { QueryClient } from '@tanstack/react-query';
import { askCache } from '@/services/askCache';

/**
 * Invalidate everything Ask-related for a given profile. Use when the
 * mutation crosses domains or when you don't have a clean domain hint.
 */
export function invalidateAskForProfile(
  queryClient: QueryClient,
  profileId: string | null | undefined,
): void {
  askCache.invalidate();
  if (profileId) {
    queryClient.invalidateQueries({
      queryKey: ['ask', 'profileIndex', profileId],
    });
  } else {
    queryClient.invalidateQueries({
      queryKey: ['ask', 'profileIndex'],
    });
  }
}

/**
 * Targeted invalidation: drop only response-cache entries that mention the
 * named domain, AND invalidate the profile index (the index is the source
 * of truth — it always needs to refresh when underlying rows change).
 */
export function invalidateAskByDomain(
  queryClient: QueryClient,
  profileId: string | null | undefined,
  domain:
    | 'medications'
    | 'labs'
    | 'results'
    | 'appointments'
    | 'preventive'
    | 'billing'
    | 'allergies'
    | 'conditions'
    | 'insurance'
    | 'care_team'
    | 'profile',
): void {
  // 'profile' is a catch-all — when individual profile facts change the
  // safest move is to drop the whole response cache because we don't know
  // which domain the change touched.
  if (domain === 'profile') {
    askCache.invalidate();
  } else {
    askCache.invalidateByDomain(domain);
  }
  if (profileId) {
    queryClient.invalidateQueries({
      queryKey: ['ask', 'profileIndex', profileId],
    });
  } else {
    queryClient.invalidateQueries({
      queryKey: ['ask', 'profileIndex'],
    });
  }
}
