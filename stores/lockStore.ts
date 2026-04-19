import { create } from 'zustand';

interface LockState {
  isLocked: boolean;
  hasEvaluatedColdStart: boolean;
  lock: () => void;
  unlock: () => void;
  markColdStartEvaluated: () => void;
  reset: () => void;
}

export const useLockStore = create<LockState>((set) => ({
  isLocked: false,
  hasEvaluatedColdStart: false,
  lock: () => set({ isLocked: true }),
  unlock: () => set({ isLocked: false }),
  markColdStartEvaluated: () => set({ hasEvaluatedColdStart: true }),
  reset: () => set({ isLocked: false, hasEvaluatedColdStart: false }),
}));
