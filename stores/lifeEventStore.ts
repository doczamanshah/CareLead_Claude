/**
 * Life-event prompt store.
 *
 * Holds pending follow-up prompts triggered by profile changes and filters
 * out anything the user has already dismissed. One prompt renders at a time
 * (highest priority first); the rest queue behind it.
 *
 * Dismissals persist to SecureStore so a prompt the user explicitly
 * dismissed never reappears — even across app restarts.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { LifeEventPrompt } from '@/lib/types/lifeEvents';

const DISMISSED_KEY = 'life_event.dismissed.v1';

// SecureStore (iOS) limits values to ~2KB. Cap the list so older dismissals
// roll off long before we hit the ceiling.
const MAX_DISMISSED = 200;

function readDismissed(): string[] {
  try {
    if (Platform.OS === 'web') {
      const raw =
        typeof localStorage !== 'undefined' ? localStorage.getItem(DISMISSED_KEY) : null;
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
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DISMISSED_KEY, serialized);
      }
      return;
    }
    SecureStore.setItem(DISMISSED_KEY, serialized);
  } catch {
    // Persistence is best-effort — a write failure shouldn't break the UI.
  }
}

const PRIORITY_ORDER: Record<LifeEventPrompt['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function sortPrompts(prompts: LifeEventPrompt[]): LifeEventPrompt[] {
  return [...prompts].sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

interface LifeEventState {
  pendingPrompts: LifeEventPrompt[];
  dismissedIds: Set<string>;

  /** Merge a batch of new prompts, filtering out already-dismissed or already-queued. */
  addPrompts: (prompts: LifeEventPrompt[]) => void;
  dismissPrompt: (promptId: string) => void;
  clearAll: () => void;
  /** Top pending prompt for a given profile, or null. */
  topPromptForProfile: (profileId: string) => LifeEventPrompt | null;
  /** Pending prompts restricted to one profile. */
  promptsForProfile: (profileId: string) => LifeEventPrompt[];
  getDismissedIds: () => string[];
}

export const useLifeEventStore = create<LifeEventState>((set, get) => ({
  pendingPrompts: [],
  dismissedIds: new Set<string>(readDismissed()),

  addPrompts: (incoming) => {
    set((state) => {
      const existingIds = new Set(state.pendingPrompts.map((p) => p.id));
      const filtered = incoming.filter(
        (p) => !state.dismissedIds.has(p.id) && !existingIds.has(p.id),
      );
      if (filtered.length === 0) return state;
      return {
        pendingPrompts: sortPrompts([...state.pendingPrompts, ...filtered]),
      };
    });
  },

  dismissPrompt: (promptId) => {
    set((state) => {
      const nextDismissed = new Set(state.dismissedIds);
      nextDismissed.add(promptId);
      writeDismissed(Array.from(nextDismissed));
      return {
        dismissedIds: nextDismissed,
        pendingPrompts: state.pendingPrompts.filter((p) => p.id !== promptId),
      };
    });
  },

  clearAll: () => {
    set({ pendingPrompts: [] });
  },

  topPromptForProfile: (profileId) => {
    const scoped = get().pendingPrompts.filter((p) => p.profileId === profileId);
    return scoped[0] ?? null;
  },

  promptsForProfile: (profileId) =>
    get().pendingPrompts.filter((p) => p.profileId === profileId),

  getDismissedIds: () => Array.from(get().dismissedIds),
}));
