/**
 * Voice Retrieval ("Ask Profile") — In-Memory Response Cache
 *
 * Caches full AskResponse objects keyed by a normalized form of the user's
 * query so repeat questions ("what meds am I on?", "What medications am I
 * taking", "my meds") return instantly without re-running the engine or
 * re-calling the AI fallback.
 *
 * Scope: in-memory, per-app-session. Resets on app restart, which is fine —
 * the worst case is one cache miss after launch.
 *
 * Eviction: LRU when full. TTL'd per source: deterministic answers expire
 * faster than AI fallbacks (AI calls cost money, so longer reuse window).
 *
 * Invalidation: clear-on-write. Any mutation that changes profile data
 * should call `askCache.invalidate()` (or the domain-scoped variant). The
 * profile index TanStack Query gets the same invalidation signal — see
 * `services/askInvalidation.ts`.
 */

import type { AskResponse } from '@/lib/types/ask';

type CacheSource = 'deterministic' | 'ai_fallback';

interface CachedResponse {
  query: string;
  normalizedQuery: string;
  response: AskResponse;
  cachedAt: number;
  source: CacheSource;
  /** Last-access timestamp for LRU eviction. */
  lastAccess: number;
}

const DETERMINISTIC_TTL_MS = 5 * 60 * 1000; // 5 min
const AI_FALLBACK_TTL_MS = 60 * 60 * 1000; // 60 min — AI calls cost money
const MAX_ENTRIES = 50;

/** Words/phrases that don't change the meaning of the query — strip them. */
const PREFIXES_TO_STRIP = [
  'can you tell me',
  'can you show me',
  'tell me about',
  'show me my',
  'show me the',
  'show me',
  'tell me',
  'list my',
  'list of',
  'list all',
  'list the',
  'what are my',
  'what is my',
  'what are the',
  'what is the',
  'what are',
  'what is',
  'what s',
  'whats',
  'whats my',
  'do i have any',
  'do i have',
  'i want to know',
  'i d like to know',
  'remind me of',
  'remind me what',
  'please show',
  'please tell',
  'please',
];

/** Common synonym pairs. Run after prefix stripping for further collapsing. */
const SYNONYMS: Array<[RegExp, string]> = [
  [/\bmedications?\b/g, 'meds'],
  [/\bprescriptions?\b/g, 'meds'],
  [/\brx\b/g, 'meds'],
  [/\ballergic to\b/g, 'allergies'],
  [/\bproviders?\b/g, 'doctors'],
  [/\bphysicians?\b/g, 'doctors'],
  [/\bvisits?\b/g, 'appointments'],
  [/\bappointment\b/g, 'appointments'],
  [/\bvaccinations?\b/g, 'immunizations'],
  [/\bvaccines?\b/g, 'immunizations'],
  [/\bshots?\b/g, 'immunizations'],
  [/\bscreenings?\b/g, 'screenings'],
  [/\blabs\b/g, 'labs'],
  [/\blab results?\b/g, 'labs'],
];

export class AskResponseCache {
  private cache = new Map<string, CachedResponse>();
  private hits = 0;
  private misses = 0;

  /**
   * Normalize a query for cache lookup. Strips punctuation, extra whitespace,
   * common verbal prefixes, and collapses synonyms so semantically-equivalent
   * questions hit the same cache entry.
   */
  normalizeQuery(query: string): string {
    let q = query
      .toLowerCase()
      .replace(/[?!.,;:"']+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Strip a single leading prefix — apply repeatedly because users stack
    // them ("please tell me what are my meds").
    let changed = true;
    while (changed) {
      changed = false;
      for (const prefix of PREFIXES_TO_STRIP) {
        if (q.startsWith(prefix + ' ')) {
          q = q.slice(prefix.length + 1).trim();
          changed = true;
          break;
        }
        if (q === prefix) {
          q = '';
          changed = true;
          break;
        }
      }
    }

    // Collapse synonyms.
    for (const [pattern, replacement] of SYNONYMS) {
      q = q.replace(pattern, replacement);
    }

    // Final whitespace pass after substitutions.
    return q.replace(/\s+/g, ' ').trim();
  }

  /** Look up a cached response. Returns null on miss or expiry. */
  get(query: string): AskResponse | null {
    const key = this.normalizeQuery(query);
    if (!key) {
      this.misses += 1;
      return null;
    }
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    const ttl =
      entry.source === 'ai_fallback' ? AI_FALLBACK_TTL_MS : DETERMINISTIC_TTL_MS;
    if (Date.now() - entry.cachedAt > ttl) {
      this.cache.delete(key);
      this.misses += 1;
      return null;
    }
    entry.lastAccess = Date.now();
    this.hits += 1;
    return { ...entry.response, cached: true, source: entry.source };
  }

  /** Store a response. Evicts LRU when the cache is full. */
  set(query: string, response: AskResponse, source: CacheSource): void {
    const key = this.normalizeQuery(query);
    if (!key) return;

    if (this.cache.size >= MAX_ENTRIES && !this.cache.has(key)) {
      this.evictLru();
    }

    this.cache.set(key, {
      query,
      normalizedQuery: key,
      response,
      cachedAt: Date.now(),
      source,
      lastAccess: Date.now(),
    });
  }

  /** Drop everything. Called when profile data mutates. */
  invalidate(): void {
    this.cache.clear();
  }

  /**
   * Drop entries whose normalized query mentions a domain keyword. Used by
   * targeted mutations (e.g., a medication change clears medication-related
   * cached responses but keeps lab answers intact).
   */
  invalidateByDomain(domain: string): void {
    const keywords = DOMAIN_INVALIDATION_KEYWORDS[domain] ?? [domain];
    for (const [key, entry] of this.cache) {
      if (keywords.some((k) => entry.normalizedQuery.includes(k))) {
        this.cache.delete(key);
      }
    }
  }

  /** Test/dev helper. Don't gate behavior on these numbers. */
  stats(): { size: number; hits: number; misses: number } {
    return { size: this.cache.size, hits: this.hits, misses: this.misses };
  }

  private evictLru(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (oldestKey) this.cache.delete(oldestKey);
  }
}

const DOMAIN_INVALIDATION_KEYWORDS: Record<string, string[]> = {
  medications: ['med', 'meds', 'drug', 'pill', 'prescrib', 'pharmacy', 'rx', 'dose', 'refill'],
  labs: ['lab', 'a1c', 'cholesterol', 'glucose', 'ldl', 'hdl', 'tsh', 'panel', 'cmp', 'bmp', 'cbc'],
  results: ['result', 'lab', 'imaging', 'scan', 'mri', 'x-ray', 'xray', 'ultrasound'],
  appointments: ['appointment', 'appointments', 'visit', 'doctor', 'next visit'],
  preventive: ['screen', 'preventive', 'overdue', 'due for', 'immunization', 'mammogram', 'colonoscopy'],
  billing: ['bill', 'owe', 'payment', 'eob', 'charge'],
  allergies: ['allerg', 'reaction'],
  conditions: ['condition', 'diagnos', 'problem'],
  insurance: ['insurance', 'member', 'plan', 'coverage'],
  care_team: ['doctor', 'doctors', 'provider', 'pcp', 'care team'],
  profile: [], // empty array means "match nothing" — use full invalidate() instead
};

/** Singleton instance shared across the app. */
export const askCache = new AskResponseCache();
