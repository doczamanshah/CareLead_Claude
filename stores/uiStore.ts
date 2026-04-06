import { create } from 'zustand';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

interface UIState {
  isGlobalLoading: boolean;
  toasts: Toast[];
  setGlobalLoading: (loading: boolean) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  isGlobalLoading: false,
  toasts: [],
  setGlobalLoading: (isGlobalLoading) => set({ isGlobalLoading }),
  addToast: (toast) =>
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id: Date.now().toString() }],
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
  reset: () => set({ isGlobalLoading: false, toasts: [] }),
}));
