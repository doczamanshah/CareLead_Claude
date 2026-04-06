import { create } from 'zustand';

interface ProfileState {
  activeProfileId: string | null;
  setActiveProfileId: (id: string | null) => void;
  reset: () => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  activeProfileId: null,
  setActiveProfileId: (activeProfileId) => set({ activeProfileId }),
  reset: () => set({ activeProfileId: null }),
}));
