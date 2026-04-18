/**
 * Voice Retrieval ("Ask Profile") — Intent Router
 *
 * Deterministic classification: takes a user query and returns a RoutedQuery
 * with the matched intent, extracted entity, and confidence. No AI calls.
 *
 * The router is tuned to be conservative — if nothing clearly matches, it
 * returns `confidence: 'none'` so the orchestrator can fall through to the
 * AI fallback. A few simple rules:
 *   - Entity-required intents beat list_all intents when both match.
 *   - Patterns containing a word boundary match (" lisinopril ") score
 *     higher than substring hits ("dose of").
 *   - An unmatched entity on an entity-required intent downgrades confidence
 *     to 'low' so the orchestrator can choose between a domain list-all
 *     response and AI fallback.
 */

import type { CanonicalFact, ProfileIndex } from '@/lib/types/ask';
import {
  ASK_INTENTS,
  KNOWN_LAB_ANALYTES,
  LAB_HISTORY_KEYWORDS,
} from '@/services/askIntents';
import type { AskIntent } from '@/services/askIntents';

export type RouteConfidence = 'high' | 'medium' | 'low' | 'none';

export interface RoutedQuery {
  intent: AskIntent | null;
  entity: string | null;
  /** The canonical fact the entity resolved to, if any. */
  entityFact: CanonicalFact | null;
  confidence: RouteConfidence;
  originalQuery: string;
  normalizedQuery: string;
  matchedPattern: string | null;
}

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[?!.,;:"']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface IntentMatch {
  intent: AskIntent;
  pattern: string;
  /** Word-boundary matches outrank substring matches. */
  score: number;
}

function matchIntents(normalized: string): IntentMatch[] {
  const matches: IntentMatch[] = [];
  for (const intent of ASK_INTENTS) {
    for (const pattern of intent.patterns) {
      const padded = ` ${normalized} `;
      const paddedPattern = ` ${pattern} `;
      let score = 0;
      if (padded.includes(paddedPattern)) score = 3;
      else if (normalized.startsWith(pattern) || normalized.endsWith(pattern)) score = 2;
      else if (normalized.includes(pattern)) score = 1;
      if (score > 0) {
        matches.push({ intent, pattern, score });
        break; // one match per intent is enough
      }
    }
  }
  return matches;
}

/**
 * Among competing intent matches, prefer the most specific:
 *   1. Highest match score (word-boundary > substring).
 *   2. Longer patterns over shorter ones (more specific wording).
 *   3. Entity-required intents over list_all ones.
 *   4. get_specific > get_history > get_latest > list_all > get_count.
 */
function pickBestIntent(matches: IntentMatch[]): IntentMatch | null {
  if (matches.length === 0) return null;
  const queryTypeRank: Record<string, number> = {
    get_specific: 5,
    get_history: 4,
    get_latest: 3,
    list_all: 2,
    get_count: 1,
  };
  const sorted = [...matches].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length;
    if (a.intent.entityRequired !== b.intent.entityRequired) {
      return a.intent.entityRequired ? -1 : 1;
    }
    const aRank = queryTypeRank[a.intent.queryType] ?? 0;
    const bRank = queryTypeRank[b.intent.queryType] ?? 0;
    return bRank - aRank;
  });
  return sorted[0];
}

function extractMedicationEntity(
  normalized: string,
  index: ProfileIndex,
): { entity: string | null; fact: CanonicalFact | null } {
  const meds = index.facts.filter((f) => f.domain === 'medications');
  for (const med of meds) {
    if (med.factKey && normalized.includes(med.factKey)) {
      return { entity: med.factKey, fact: med };
    }
    const name = med.displayName.toLowerCase();
    if (name && normalized.includes(name.split(' ')[0])) {
      return { entity: med.factKey, fact: med };
    }
  }
  // Fallback: word after "of"
  const ofMatch = normalized.match(/\bof\s+([a-z][a-z0-9\-]+)/);
  if (ofMatch) {
    return { entity: ofMatch[1], fact: null };
  }
  return { entity: null, fact: null };
}

function extractLabEntity(
  normalized: string,
  index: ProfileIndex,
): { entity: string | null; fact: CanonicalFact | null } {
  // 1. Check known analytes first — these beat profile-observed names
  //    because the user may ask about a lab they've never uploaded.
  for (const analyte of KNOWN_LAB_ANALYTES) {
    const padded = ` ${normalized} `;
    if (padded.includes(` ${analyte} `)) {
      const fact = index.facts.find(
        (f) => f.domain === 'labs' && f.factKey === analyte,
      );
      return { entity: analyte, fact: fact ?? null };
    }
  }
  // 2. Scan profile lab observations
  const labFacts = index.facts.filter((f) => f.domain === 'labs');
  for (const lab of labFacts) {
    if (lab.factKey && normalized.includes(lab.factKey)) {
      return { entity: lab.factKey, fact: lab };
    }
  }
  return { entity: null, fact: null };
}

function extractEntity(
  intent: AskIntent,
  normalized: string,
  index: ProfileIndex,
): { entity: string | null; fact: CanonicalFact | null } {
  switch (intent.entityDomain) {
    case 'medication_name':
      return extractMedicationEntity(normalized, index);
    case 'lab_name':
      return extractLabEntity(normalized, index);
    default:
      return { entity: null, fact: null };
  }
}

function hasHistoryKeyword(normalized: string): boolean {
  return LAB_HISTORY_KEYWORDS.some((k) => normalized.includes(k));
}

/**
 * Classify a query into an intent + optional entity. Returns a RoutedQuery.
 * When no intent matches, `confidence === 'none'` signals the orchestrator
 * to try the AI fallback.
 */
export function routeQuery(query: string, index: ProfileIndex): RoutedQuery {
  const normalizedQuery = normalizeQuery(query);
  const matches = matchIntents(normalizedQuery);
  let best = pickBestIntent(matches);

  if (!best) {
    return {
      intent: null,
      entity: null,
      entityFact: null,
      confidence: 'none',
      originalQuery: query,
      normalizedQuery,
      matchedPattern: null,
    };
  }

  // History boost — prefer GET_LAB_HISTORY over GET_LATEST_LAB when the query
  // carries a history/trend signal (e.g., "how has my A1c been over the last
  // year"). Without this, broad GET_LATEST_LAB patterns like "my a1c" or
  // "last" would outrank the history intent.
  if (
    best.intent.queryType === 'get_latest' &&
    best.intent.domain === 'labs' &&
    hasHistoryKeyword(normalizedQuery)
  ) {
    const historyMatch = matches.find((m) => m.intent.id === 'GET_LAB_HISTORY');
    if (historyMatch) {
      best = historyMatch;
    }
  }

  const { intent, pattern, score } = best;
  let confidence: RouteConfidence = score >= 3 ? 'high' : score === 2 ? 'medium' : 'low';

  let entity: string | null = null;
  let entityFact: CanonicalFact | null = null;

  if (intent.entityRequired) {
    const extracted = extractEntity(intent, normalizedQuery, index);
    entity = extracted.entity;
    entityFact = extracted.fact;
    if (!entity) {
      // Entity was required but not found — downgrade. The orchestrator may
      // still try to show a list_all for that domain or fall back to AI.
      confidence = 'low';
    } else if (!entityFact && confidence === 'high') {
      // We found a keyword but the profile doesn't have that fact yet.
      confidence = 'medium';
    }
  }

  return {
    intent,
    entity,
    entityFact,
    confidence,
    originalQuery: query,
    normalizedQuery,
    matchedPattern: pattern,
  };
}
