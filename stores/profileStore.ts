import { create } from 'zustand';
import type { Profile } from '@/lib/types/profile';

interface ProfileState {
  profiles: Profile[];
  activeProfileId: string | null;
  isLoaded: boolean;
  setProfiles: (profiles: Profile[]) => void;
  setActiveProfileId: (id: string | null) => void;
  switchProfile: (id: string) => void;
  reset: () => void;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  isLoaded: false,

  setProfiles: (profiles) => {
    const current = get();
    const activeStillExists = profiles.some((p) => p.id === current.activeProfileId);
    const selfProfile = profiles.find((p) => p.relationship === 'self');

    set({
      profiles,
      isLoaded: true,
      // Keep current active if still valid, otherwise default to self profile
      activeProfileId: activeStillExists
        ? current.activeProfileId
        : selfProfile?.id ?? profiles[0]?.id ?? null,
    });
  },

  setActiveProfileId: (activeProfileId) => set({ activeProfileId }),

  switchProfile: (id) => {
    const profile = get().profiles.find((p) => p.id === id);
    if (profile) {
      set({ activeProfileId: id });
    }
  },

  reset: () => set({ profiles: [], activeProfileId: null, isLoaded: false }),
}));
