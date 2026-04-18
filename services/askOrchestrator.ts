/**
 * Voice Retrieval ("Ask Profile") — Orchestrator
 *
 * Top-level entry point. Routes a natural-language query through the
 * deterministic intent system first, and only falls through to the AI
 * fallback when the router can't confidently classify the query or when
 * the deterministic engine returned nothing useful.
 */

import type { AskResponse, ProfileIndex } from '@/lib/types/ask';
import { routeQuery } from '@/services/askRouter';
import { executeQuery } from '@/services/askEngine';
import { runAiFallback } from '@/services/askFallback';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface AskProfileParams {
  query: string;
  profileIndex: ProfileIndex;
  profileId: string;
  householdId: string;
}

/**
 * Run a natural-language query against a pre-built ProfileIndex. Returns a
 * structured AskResponse whether the answer came from the deterministic
 * engine or the AI fallback.
 */
export async function askProfile(
  params: AskProfileParams,
): Promise<ServiceResult<AskResponse>> {
  const query = params.query?.trim();
  if (!query) {
    return { success: false, error: 'query is required' };
  }

  const routed = routeQuery(query, params.profileIndex);

  if (routed.confidence === 'high' || routed.confidence === 'medium') {
    const response = executeQuery({
      routedQuery: routed,
      profileIndex: params.profileIndex,
    });
    // If the deterministic engine returned an empty answer for an entity-
    // required intent that couldn't resolve, let the AI have a shot — it
    // may be able to answer from a nearby domain.
    if (response.noResults && routed.intent?.entityRequired && !routed.entityFact) {
      const fallback = await runAiFallback(query, params.profileIndex);
      if (fallback.success) return fallback;
    }
    return { success: true, data: response };
  }

  // confidence === 'low' or 'none' → AI fallback
  const fallback = await runAiFallback(query, params.profileIndex);
  if (!fallback.success) {
    // Last-resort graceful degradation: return a null-response shaped object
    // rather than surfacing the fallback error to the UI.
    return {
      success: true,
      data: {
        query,
        shortAnswer: "I couldn't answer that right now. Try rephrasing, or ask something more specific.",
        cards: [],
        tableCards: [],
        trendCharts: [],
        comparisonTables: [],
        summaryLists: [],
        timelines: [],
        suggestedFollowUps: [
          'What medications am I taking?',
          'What are my allergies?',
          'When is my next appointment?',
        ],
        noResults: true,
      },
    };
  }
  return fallback;
}
