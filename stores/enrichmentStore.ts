/**
 * Enrichment store.
 *
 * Holds the current set of profile-enrichment suggestions per source (billing
 * case, result, etc.) and the user's dismissals. Active suggestions live in
 * memory — they are re-derived from the underlying extraction whenever the
 * user opens a detail screen, so persistence is unnecessary for them.
 *
 * Dismissals MUST persist across app restarts so a dismissed suggestion never
 * reappears on the next visit. They are written to SecureStore (small, key-
 * value, already a project dependency — no new packages). The hydration
 * helper is invoked once at app start.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { ProfileEnrichmentSuggestion } from '@/lib/types/enrichment';

const DISMISSED_KEY = 'enrichment.dismissed.v1';

// SecureStore on iOS limits a single value to ~2KB. Cap the persisted
// dismissed list to avoid hitting that ceiling; older dismissals roll off.
const MAX_DISMISSED = 200;

function readDismissed(): string[] {
  try {
    if (Platform.OS === 'web') {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(DISMISSED_KEY) : null;
      return raw ? (JSON.parse(raw) as string[]) : [];
    }
    const raw = SecureStore.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]): void {
  const trimmed = ids.slice(-MAX_DISMISSED);
  const serialized = JSON.stringify(trimmed);
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(DISMISSED_KEY, serialized);
      return;
    }
    SecureStore.setItem(DISMISSED_KEY, serialized);
  } catch {
    // Persistence is best-effort — a write failure shouldn't break the UI.
  }
}

interface EnrichmentState {
  /** Suggestions keyed by source ID (billing case ID, result ID, etc). */
  suggestions: Record<string, ProfileEnrichmentSuggestion[]>;
  /** Suggestion IDs the user has dismissed or accepted. */
  dismissedIds: Set<string>;

  /**
   * Replace the suggestion list for a source, automatically filtering out
   * anything the user has already dismissed/accepted. Idempotent.
   */
  setSuggestionsForSource: (
    sourceId: string,
    suggestions: ProfileEnrichmentSuggestion[],
  ) => void;
  dismissSuggestion: (sourceId: string, suggestionId: string) => void;
  dismissAllForSource: (sourceId: string) => void;
  /** Removes a suggestion from the store after the profile fact is created. */
  acceptSuggestion: (sourceId: string, suggestionId: string) => void;
  getPendingSuggestions: (sourceId: string) => ProfileEnrichmentSuggestion[];
  getAllPendingCount: () => number;
}

export const useEnrichmentStore = create<EnrichmentState>((set, get) => ({
  suggestions: {},
  dismissedIds: new Set<string>(readDismissed()),

  setSuggestionsForSource: (sourceId, incoming) => {
    set((state) => {
      const filtered = incoming.filter((s) => !state.dismissedIds.has(s.id));
      return {
        suggestions: { ...state.suggestions, [sourceId]: filtered },
      };
    });
  },

  dismissSuggestion: (sourceId, suggestionId) => {
    set((state) => {
      const nextDismissed = new Set(state.dismissedIds);
      nextDismissed.add(suggestionId);
      writeDismissed(Array.from(nextDismissed));
      const list = state.suggestions[sourceId] ?? [];
      return {
        dismissedIds: nextDismissed,
        suggestions: {
          ...state.suggestions,
          [sourceId]: list.filter((s) => s.id !== suggestionId),
        },
      };
    });
  },

  dismissAllForSource: (sourceId) => {
    set((state) => {
      const list = state.suggestions[sourceId] ?? [];
      if (list.length === 0) return state;
      const nextDismissed = new Set(state.dismissedIds);
      for (const s of list) nextDismissed.add(s.id);
      writeDismissed(Array.from(nextDismissed));
      return {
        dismissedIds: nextDismissed,
        suggestions: { ...state.suggestions, [sourceId]: [] },
      };
    });
  },

  acceptSuggestion: (sourceId, suggestionId) => {
    set((state) => {
      const nextDismissed = new Set(state.dismissedIds);
      nextDismissed.add(suggestionId);
      writeDismissed(Array.from(nextDismissed));
      const list = state.suggestions[sourceId] ?? [];
      return {
        dismissedIds: nextDismissed,
        suggestions: {
          ...state.suggestions,
          [sourceId]: list.filter((s) => s.id !== suggestionId),
        },
      };
    });
  },

  getPendingSuggestions: (sourceId) => get().suggestions[sourceId] ?? [],

  getAllPendingCount: () => {
    const all = get().suggestions;
    let total = 0;
    for (const key of Object.keys(all)) total += all[key].length;
    return total;
  },
}));
