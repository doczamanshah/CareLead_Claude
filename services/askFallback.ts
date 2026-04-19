/**
 * Voice Retrieval ("Ask Profile") — AI Fallback
 *
 * Invoked only when the deterministic router can't confidently classify a
 * question. Sends a curated subset of CanonicalFacts to the `ask-profile`
 * Edge Function (which calls Claude) and normalizes the response into an
 * AskResponse shaped like the deterministic engine's output.
 *
 * Rules:
 *   - Never send the entire index. Filter to domains likely relevant to the
 *     query's keywords, capped at ~50 facts.
 *   - Never fabricate provenance. For any card the AI produces, use a
 *     'system' provenance marking the data as read from the index.
 *   - If the AI returns something we can't parse, return a graceful "no
 *     results" response rather than throwing.
 */

import { supabase } from '@/lib/supabase';
import type {
  AnswerCard,
  AnswerCardAction,
  AskResponse,
  CanonicalFact,
  FactDomain,
  FactProvenance,
  ProfileIndex,
} from '@/lib/types/ask';
import { gapActionForUnclassified } from '@/services/askGapActions';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

const MAX_FALLBACK_FACTS = 50;

/** Keyword hints used to pre-filter the index before sending to Claude. */
const DOMAIN_HINTS: Record<FactDomain, string[]> = {
  medications: ['med', 'drug', 'pill', 'prescription', 'rx', 'dose', 'pharmacy', 'refill'],
  labs: ['lab', 'a1c', 'cholesterol', 'glucose', 'test', 'blood', 'panel', 'level'],
  allergies: ['allerg', 'reaction'],
  conditions: ['condition', 'diagnos', 'history', 'disease', 'problem'],
  appointments: ['appointment', 'visit', 'doctor', 'see', 'schedule'],
  insurance: ['insurance', 'payer', 'member', 'plan', 'coverage', 'group'],
  care_team: ['doctor', 'provider', 'specialist', 'pharmacy', 'care team', 'pcp'],
  surgeries: ['surgery', 'operation', 'procedure'],
  immunizations: ['vaccine', 'vaccination', 'shot', 'immun'],
  vitals: ['blood pressure', 'weight', 'heart rate', 'vital', 'bp'],
  results: ['imaging', 'x-ray', 'mri', 'ct', 'ultrasound', 'scan', 'report', 'result'],
  billing: ['bill', 'owe', 'payment', 'invoice', 'eob', 'charge'],
  preventive: ['screen', 'preventive', 'vaccination', 'immun', 'overdue', 'due for'],
};

function filterFactsForFallback(query: string, index: ProfileIndex): CanonicalFact[] {
  const q = query.toLowerCase();
  const matchedDomains = new Set<FactDomain>();
  for (const [domain, hints] of Object.entries(DOMAIN_HINTS) as [FactDomain, string[]][]) {
    if (hints.some((h) => q.includes(h))) {
      matchedDomains.add(domain);
    }
  }

  // If we couldn't hint any domain, include the lightest, most commonly asked
  // domains so the AI at least has something to reason over.
  if (matchedDomains.size === 0) {
    (['medications', 'allergies', 'conditions', 'appointments', 'insurance', 'care_team'] as FactDomain[])
      .forEach((d) => matchedDomains.add(d));
  }

  const filtered = index.facts.filter((f) => matchedDomains.has(f.domain));
  // Prefer current/recent facts, drop archived/inactive, cap at MAX.
  const scored = filtered
    .filter((f) => f.status !== 'archived' && f.status !== 'inactive')
    .sort((a, b) => {
      const freshnessRank: Record<string, number> = {
        current: 0,
        recent: 1,
        unknown: 2,
        stale: 3,
      };
      const diff = (freshnessRank[a.freshness] ?? 4) - (freshnessRank[b.freshness] ?? 4);
      if (diff !== 0) return diff;
      const aT = a.dateRelevant ? new Date(a.dateRelevant).getTime() : 0;
      const bT = b.dateRelevant ? new Date(b.dateRelevant).getTime() : 0;
      return bT - aT;
    });
  return scored.slice(0, MAX_FALLBACK_FACTS);
}

interface RawFallbackCard {
  title?: unknown;
  primary_value?: unknown;
  secondary_value?: unknown;
  domain?: unknown;
  date_relevant?: unknown;
  source_id?: unknown;
}

interface RawFallbackResponse {
  short_answer?: unknown;
  cards?: unknown;
  suggested_follow_ups?: unknown;
  no_results?: unknown;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

function coerceDomain(v: unknown): FactDomain {
  const s = typeof v === 'string' ? v : '';
  const allowed: FactDomain[] = [
    'medications',
    'labs',
    'allergies',
    'conditions',
    'appointments',
    'insurance',
    'care_team',
    'surgeries',
    'immunizations',
    'vitals',
    'results',
    'billing',
    'preventive',
  ];
  return (allowed as string[]).includes(s) ? (s as FactDomain) : 'medications';
}

function aiProvenance(): FactProvenance {
  return {
    source: 'system',
    sourceLabel: 'From your profile',
    verifiedBy: null,
    verifiedAt: null,
  };
}

function makeActionsForFact(fact: CanonicalFact | undefined): AnswerCardAction[] {
  if (!fact) return [];
  const route =
    fact.sourceType === 'med_medications' ? `/(main)/medications/${fact.sourceId}`
    : fact.sourceType === 'result_items' ? `/(main)/results/${fact.sourceId}`
    : fact.sourceType === 'apt_appointments' ? `/(main)/appointments/${fact.sourceId}`
    : fact.sourceType === 'billing_cases' ? `/(main)/billing/${fact.sourceId}`
    : fact.sourceType === 'preventive_items' ? `/(main)/preventive/${fact.sourceId}`
    : null;
  return [
    {
      type: 'view_source',
      label: 'View details',
      targetId: fact.sourceId,
      targetRoute: route,
    },
  ];
}

function normalizeFallbackResponse(
  query: string,
  raw: RawFallbackResponse,
  sentFacts: CanonicalFact[],
  profileId: string,
): AskResponse {
  const factsById = new Map(sentFacts.map((f) => [f.id, f]));
  const factsBySourceId = new Map(sentFacts.filter((f) => f.sourceId).map((f) => [f.sourceId!, f]));

  const rawCards = Array.isArray(raw.cards) ? (raw.cards as RawFallbackCard[]) : [];
  const cards: AnswerCard[] = rawCards
    .map((rc, idx): AnswerCard | null => {
      const title = str(rc.title);
      const primary = str(rc.primary_value);
      if (!title || !primary) return null;
      const sourceIdStr = str(rc.source_id);
      const fact = sourceIdStr ? (factsById.get(sourceIdStr) ?? factsBySourceId.get(sourceIdStr)) : undefined;
      return {
        id: `ai_card:${idx}:${title.slice(0, 32)}`,
        title,
        primaryValue: primary,
        secondaryValue: str(rc.secondary_value),
        domain: coerceDomain(rc.domain),
        provenance: fact?.provenance ?? aiProvenance(),
        freshness: fact?.freshness ?? 'unknown',
        dateRelevant: fact?.dateRelevant ?? str(rc.date_relevant),
        status: fact?.status ?? 'unverified',
        sourceId: fact?.sourceId ?? null,
        sourceType: fact?.sourceType ?? null,
        conflictGroupId: fact?.conflictGroupId ?? null,
        actions: makeActionsForFact(fact),
      };
    })
    .filter((c): c is AnswerCard => c !== null);

  const followUpsRaw = Array.isArray(raw.suggested_follow_ups) ? raw.suggested_follow_ups : [];
  const suggestedFollowUps: string[] = followUpsRaw
    .map((f: unknown) => str(f))
    .filter((f): f is string => !!f)
    .slice(0, 3);

  const noResults = raw.no_results === true || cards.length === 0;
  return {
    query,
    shortAnswer:
      str(raw.short_answer) ?? "I don't have that information in your profile.",
    cards,
    tableCards: [],
    trendCharts: [],
    comparisonTables: [],
    summaryLists: [],
    timelines: [],
    suggestedFollowUps,
    noResults,
    // When the AI couldn't find anything, lean on the keyword gap detector
    // to point the user at a one-tap entry route. Successful fallbacks keep
    // a null gap so the answer doesn't get a redundant "want to add?" CTA.
    gapAction: noResults ? gapActionForUnclassified(query, { profileId }) : null,
  };
}

/**
 * Strip fact payloads down to the minimum needed for the AI to answer — the
 * Edge Function receives small, scrubbed records, not the full domain blobs.
 */
function scrubFactsForAi(facts: CanonicalFact[]): Array<Record<string, unknown>> {
  return facts.map((f) => ({
    id: f.id,
    domain: f.domain,
    fact_type: f.factType,
    display_name: f.displayName,
    value: f.value,
    secondary_value: f.secondaryValue,
    date_relevant: f.dateRelevant,
    status: f.status,
    source_id: f.sourceId,
    source_type: f.sourceType,
    provenance_label: f.provenance.sourceLabel,
    freshness: f.freshness,
  }));
}

export async function runAiFallback(
  query: string,
  profileIndex: ProfileIndex,
): Promise<ServiceResult<AskResponse>> {
  const sentFacts = filterFactsForFallback(query, profileIndex);

  const { data, error } = await supabase.functions.invoke('ask-profile', {
    body: {
      query,
      profile_name: profileIndex.profileName,
      facts: scrubFactsForAi(sentFacts),
    },
  });

  if (error) {
    return { success: false, error: error.message ?? 'ask-profile invocation failed' };
  }

  const response = normalizeFallbackResponse(
    query,
    (data ?? {}) as RawFallbackResponse,
    sentFacts,
    profileIndex.profileId,
  );
  return { success: true, data: response };
}
