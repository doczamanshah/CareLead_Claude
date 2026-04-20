/**
 * Voice Retrieval ("Ask Profile") — Orchestrator
 *
 * Top-level entry point. Routes a natural-language query through the
 * deterministic intent system first, and only falls through to the AI
 * fallback when the router can't confidently classify the query or when
 * the deterministic engine returned nothing useful.
 *
 * Wraps the flow with the in-memory response cache (askCache) and prints
 * lightweight timing logs so we can spot regressions in dev.
 */

import type { AskResponse, ProfileIndex } from '@/lib/types/ask';
import { routeQuery } from '@/services/askRouter';
import { executeQuery } from '@/services/askEngine';
import { runAiFallback } from '@/services/askFallback';
import { gapActionForUnclassified } from '@/services/askGapActions';
import { askCache } from '@/services/askCache';

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
 * engine, the AI fallback, or the response cache.
 */
export async function askProfile(
  params: AskProfileParams,
): Promise<ServiceResult<AskResponse>> {
  const query = params.query?.trim();
  if (!query) {
    return { success: false, error: 'query is required' };
  }

  const startTime = Date.now();

  // ── Cache fast path ───────────────────────────────────────────────────
  const cached = askCache.get(query);
  if (cached) {
    const elapsed = Date.now() - startTime;
    logTiming({
      query,
      source: cached.source ?? 'deterministic',
      cached: true,
      totalMs: elapsed,
    });
    return { success: true, data: cached };
  }

  // ── Deterministic path ────────────────────────────────────────────────
  const routeStart = Date.now();
  const routed = routeQuery(query, params.profileIndex);
  const routeMs = Date.now() - routeStart;

  if (routed.confidence === 'high' || routed.confidence === 'medium') {
    const engineStart = Date.now();
    const response = executeQuery({
      routedQuery: routed,
      profileIndex: params.profileIndex,
    });
    const engineMs = Date.now() - engineStart;

    // If the deterministic engine returned an empty answer for an entity-
    // required intent that couldn't resolve, let the AI have a shot — it
    // may be able to answer from a nearby domain.
    if (response.noResults && routed.intent?.entityRequired && !routed.entityFact) {
      const fallbackStart = Date.now();
      const fallback = await runAiFallback(query, params.profileIndex);
      const fallbackMs = Date.now() - fallbackStart;
      if (fallback.success) {
        const annotated = { ...fallback.data, source: 'ai_fallback' as const };
        askCache.set(query, annotated, 'ai_fallback');
        logTiming({
          query,
          source: 'ai_fallback',
          cached: false,
          routeMs,
          engineMs,
          fallbackMs,
          totalMs: Date.now() - startTime,
        });
        return { success: true, data: annotated };
      }
    }

    const annotated = { ...response, source: 'deterministic' as const };
    askCache.set(query, annotated, 'deterministic');
    logTiming({
      query,
      source: 'deterministic',
      cached: false,
      routeMs,
      engineMs,
      totalMs: Date.now() - startTime,
    });
    return { success: true, data: annotated };
  }

  // ── AI fallback ───────────────────────────────────────────────────────
  const fallbackStart = Date.now();
  const fallback = await runAiFallback(query, params.profileIndex);
  const fallbackMs = Date.now() - fallbackStart;

  if (!fallback.success) {
    // Last-resort graceful degradation: return a null-response shaped object
    // rather than surfacing the fallback error to the UI.
    logTiming({
      query,
      source: 'ai_fallback',
      cached: false,
      routeMs,
      fallbackMs,
      totalMs: Date.now() - startTime,
      error: true,
    });
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
        gapAction: gapActionForUnclassified(query, {
          profileId: params.profileIndex.profileId,
        }),
        source: 'ai_fallback',
      },
    };
  }

  const annotated = { ...fallback.data, source: 'ai_fallback' as const };
  askCache.set(query, annotated, 'ai_fallback');
  logTiming({
    query,
    source: 'ai_fallback',
    cached: false,
    routeMs,
    fallbackMs,
    totalMs: Date.now() - startTime,
  });
  return { success: true, data: annotated };
}

// ── Performance telemetry (dev-only console logs) ──────────────────────────
//
// These print to the JS console in development so we can spot slow paths
// without adding any infrastructure or DB writes. No PHI in the log line —
// the query string is the user's input which is fine to surface in dev.

interface TimingEvent {
  query: string;
  source: 'deterministic' | 'ai_fallback';
  cached: boolean;
  routeMs?: number;
  engineMs?: number;
  fallbackMs?: number;
  totalMs: number;
  error?: boolean;
}

function logTiming(event: TimingEvent): void {
  if (!__DEV__) return;
  const parts: string[] = [
    `[Ask] "${event.query}"`,
    `src=${event.source}`,
    `cached=${event.cached}`,
    `total=${event.totalMs}ms`,
  ];
  if (event.routeMs != null) parts.push(`route=${event.routeMs}ms`);
  if (event.engineMs != null) parts.push(`engine=${event.engineMs}ms`);
  if (event.fallbackMs != null) parts.push(`fallback=${event.fallbackMs}ms`);
  if (event.error) parts.push('error=true');
  console.log(parts.join(' | '));
}
