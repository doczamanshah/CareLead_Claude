/**
 * Wellness visit prep store.
 *
 * Persists the user's in-progress Annual Wellness Visit preparation across
 * app sessions so they can work on it over multiple sittings. Data volume
 * can be large (the freeform dictation alone may exceed SecureStore's
 * ~2KB-per-key iOS limit) so we persist to a JSON file in the document
 * directory instead of SecureStore.
 *
 * HIPAA note: iOS `documentDirectory` is app-sandboxed and encrypted at rest
 * via File Protection (`NSFileProtectionCompleteUntilFirstUserAuthentication`
 * by default); on Android it is app-private internal storage. The file is
 * cleared by `clearPersisted()` on sign-out (see `services/auth.ts` →
 * `cleanupOnSignOut`) and by `resetVisit()` once the packet is generated.
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';
import type {
  WellnessVisitPrep,
  WellnessExtraction,
  WellnessQuestion,
  WellnessProfileChange,
  WellnessStepKey,
} from '@/lib/types/wellnessVisit';

const STORAGE_FILE = `${FileSystem.documentDirectory ?? ''}wellness_visit_prep.v1.json`;

function emptyPrep(): WellnessVisitPrep {
  return {
    currentVisitId: `wv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    freeformInput: '',
    extractedData: null,
    profileReviewCompleted: false,
    profileChanges: [],
    selectedScreenings: [],
    questions: [],
    packetGenerated: false,
    stepsCompleted: {
      freeform: false,
      profile_review: false,
      preventive_agenda: false,
      questions: false,
      packet: false,
    },
    createdAt: new Date().toISOString(),
    appointmentId: null,
  };
}

async function loadPersisted(): Promise<WellnessVisitPrep | null> {
  try {
    if (!STORAGE_FILE) return null;
    const info = await FileSystem.getInfoAsync(STORAGE_FILE);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(STORAGE_FILE);
    const parsed = JSON.parse(raw) as WellnessVisitPrep;
    if (!parsed?.currentVisitId) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function persist(prep: WellnessVisitPrep): Promise<void> {
  try {
    if (!STORAGE_FILE) return;
    await FileSystem.writeAsStringAsync(STORAGE_FILE, JSON.stringify(prep));
  } catch {
    // Best effort — an I/O failure shouldn't break the UI.
  }
}

async function clearPersisted(): Promise<void> {
  try {
    if (!STORAGE_FILE) return;
    const info = await FileSystem.getInfoAsync(STORAGE_FILE);
    if (info.exists) {
      await FileSystem.deleteAsync(STORAGE_FILE, { idempotent: true });
    }
  } catch {
    // Non-fatal.
  }
}

/**
 * Called from the auth sign-out cleanup so the freeform dictation + extracted
 * wellness-visit PHI never survives across user sessions on the same device.
 */
export async function clearWellnessVisitPersisted(): Promise<void> {
  await clearPersisted();
}

interface WellnessVisitState extends WellnessVisitPrep {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  resetVisit: () => void;
  setFreeformInput: (text: string) => void;
  setExtractedData: (data: WellnessExtraction | null) => void;
  markProfileReviewCompleted: (completed: boolean) => void;
  addProfileChange: (change: Omit<WellnessProfileChange, 'id' | 'appliedAt'>) => void;
  setSelectedScreenings: (ids: string[]) => void;
  toggleScreening: (id: string) => void;
  addQuestion: (question: Omit<WellnessQuestion, 'id'>) => void;
  addQuestions: (questions: Omit<WellnessQuestion, 'id'>[]) => void;
  updateQuestion: (id: string, updates: Partial<Omit<WellnessQuestion, 'id'>>) => void;
  removeQuestion: (id: string) => void;
  reorderQuestions: (orderedIds: string[]) => void;
  markStepCompleted: (step: WellnessStepKey, completed?: boolean) => void;
  markPacketGenerated: () => void;
  setAppointmentId: (appointmentId: string | null) => void;
  countCompletedSteps: () => number;
  isFlowInProgress: () => boolean;
}

function newQuestionId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function newChangeId(): string {
  return `pc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useWellnessVisitStore = create<WellnessVisitState>((set, get) => {
  // Schedule an async persist after a set. Keeps state updates synchronous.
  const syncAfterChange = () => {
    const { hydrate, resetVisit, ...snapshot } = get() as unknown as Record<
      string,
      unknown
    >;
    const { hydrated, ...prepOnly } = snapshot as Record<string, unknown>;
    void prepOnly; // structural only — we persist the computed prep below.
    const prep: WellnessVisitPrep = {
      currentVisitId: get().currentVisitId,
      freeformInput: get().freeformInput,
      extractedData: get().extractedData,
      profileReviewCompleted: get().profileReviewCompleted,
      profileChanges: get().profileChanges,
      selectedScreenings: get().selectedScreenings,
      questions: get().questions,
      packetGenerated: get().packetGenerated,
      stepsCompleted: get().stepsCompleted,
      createdAt: get().createdAt,
      appointmentId: get().appointmentId,
    };
    void persist(prep);
  };

  return {
    ...emptyPrep(),
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated) return;
      const loaded = await loadPersisted();
      if (loaded) {
        set({ ...loaded, hydrated: true });
      } else {
        set({ hydrated: true });
      }
    },

    resetVisit: () => {
      const fresh = emptyPrep();
      set({ ...fresh, hydrated: true });
      void clearPersisted();
    },

    setFreeformInput: (text) => {
      set({ freeformInput: text });
      syncAfterChange();
    },

    setExtractedData: (data) => {
      set({ extractedData: data });
      syncAfterChange();
    },

    markProfileReviewCompleted: (completed) => {
      set((state) => ({
        profileReviewCompleted: completed,
        stepsCompleted: { ...state.stepsCompleted, profile_review: completed },
      }));
      syncAfterChange();
    },

    addProfileChange: (change) => {
      set((state) => ({
        profileChanges: [
          ...state.profileChanges,
          { ...change, id: newChangeId(), appliedAt: new Date().toISOString() },
        ],
      }));
      syncAfterChange();
    },

    setSelectedScreenings: (ids) => {
      set((state) => ({
        selectedScreenings: ids,
        stepsCompleted: {
          ...state.stepsCompleted,
          preventive_agenda: ids.length > 0,
        },
      }));
      syncAfterChange();
    },

    toggleScreening: (id) => {
      set((state) => {
        const has = state.selectedScreenings.includes(id);
        const next = has
          ? state.selectedScreenings.filter((x) => x !== id)
          : [...state.selectedScreenings, id];
        return {
          selectedScreenings: next,
          stepsCompleted: {
            ...state.stepsCompleted,
            preventive_agenda: next.length > 0,
          },
        };
      });
      syncAfterChange();
    },

    addQuestion: (question) => {
      set((state) => ({
        questions: [...state.questions, { ...question, id: newQuestionId() }],
        stepsCompleted: { ...state.stepsCompleted, questions: true },
      }));
      syncAfterChange();
    },

    addQuestions: (questions) => {
      set((state) => ({
        questions: [
          ...state.questions,
          ...questions.map((q) => ({ ...q, id: newQuestionId() })),
        ],
        stepsCompleted: {
          ...state.stepsCompleted,
          questions: state.questions.length + questions.length > 0,
        },
      }));
      syncAfterChange();
    },

    updateQuestion: (id, updates) => {
      set((state) => ({
        questions: state.questions.map((q) =>
          q.id === id ? { ...q, ...updates } : q,
        ),
      }));
      syncAfterChange();
    },

    removeQuestion: (id) => {
      set((state) => ({
        questions: state.questions.filter((q) => q.id !== id),
      }));
      syncAfterChange();
    },

    reorderQuestions: (orderedIds) => {
      set((state) => {
        const byId = new Map(state.questions.map((q) => [q.id, q]));
        const reordered: WellnessQuestion[] = [];
        for (const id of orderedIds) {
          const q = byId.get(id);
          if (q) reordered.push(q);
        }
        // Append anything not in the ordered list to preserve data.
        for (const q of state.questions) {
          if (!orderedIds.includes(q.id)) reordered.push(q);
        }
        return { questions: reordered };
      });
      syncAfterChange();
    },

    markStepCompleted: (step, completed = true) => {
      set((state) => ({
        stepsCompleted: { ...state.stepsCompleted, [step]: completed },
      }));
      syncAfterChange();
    },

    markPacketGenerated: () => {
      set((state) => ({
        packetGenerated: true,
        stepsCompleted: { ...state.stepsCompleted, packet: true },
      }));
      syncAfterChange();
    },

    setAppointmentId: (appointmentId) => {
      set({ appointmentId });
      syncAfterChange();
    },

    countCompletedSteps: () => {
      const { stepsCompleted } = get();
      return Object.values(stepsCompleted).filter(Boolean).length;
    },

    isFlowInProgress: () => {
      const s = get();
      const started =
        s.freeformInput.length > 0 ||
        s.profileReviewCompleted ||
        s.selectedScreenings.length > 0 ||
        s.questions.length > 0 ||
        s.profileChanges.length > 0;
      return started && !s.packetGenerated;
    },
  };
});
