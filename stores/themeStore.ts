import { create } from 'zustand';
import { Appearance, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { ColorSchemeName } from 'react-native';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'carelead_theme_mode';

interface ThemeState {
  mode: ThemeMode;
  /** Current OS-level color scheme; tracked so `system` mode re-resolves live. */
  systemScheme: ResolvedTheme;
  isHydrated: boolean;
  setMode: (mode: ThemeMode) => Promise<void>;
  setSystemScheme: (scheme: ColorSchemeName) => void;
  hydrate: () => Promise<void>;
}

function normalize(scheme: ColorSchemeName): ResolvedTheme {
  return scheme === 'dark' ? 'dark' : 'light';
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'system',
  systemScheme: normalize(Appearance.getColorScheme()),
  isHydrated: false,
  setMode: async (mode) => {
    set({ mode });
    if (Platform.OS === 'web') return;
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, mode);
    } catch {
      // noop
    }
  },
  setSystemScheme: (scheme) => set({ systemScheme: normalize(scheme) }),
  hydrate: async () => {
    if (get().isHydrated) return;
    if (Platform.OS === 'web') {
      set({ isHydrated: true });
      return;
    }
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        set({ mode: stored });
      }
    } catch {
      // noop
    }
    set({ isHydrated: true });
  },
}));

export function resolveTheme(mode: ThemeMode, systemScheme: ResolvedTheme): ResolvedTheme {
  if (mode === 'system') return systemScheme;
  return mode;
}
