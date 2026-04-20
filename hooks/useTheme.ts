import { useEffect } from 'react';
import { Appearance } from 'react-native';
import {
  resolveTheme,
  useThemeStore,
  type ResolvedTheme,
  type ThemeMode,
} from '@/stores/themeStore';
import {
  DARK_THEME,
  LIGHT_THEME,
  type ThemePalette,
} from '@/lib/constants/themes';

interface ThemeContext {
  colors: ThemePalette;
  isDark: boolean;
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
}

/**
 * Returns the currently-active theme palette and metadata. Use in any
 * component that should participate in dark mode — replaces direct
 * imports of `COLORS` from `lib/constants/colors.ts`.
 *
 * Existing screens that still import `COLORS` keep rendering the light
 * palette. This is intentional: we opt components in one at a time.
 */
export function useTheme(): ThemeContext {
  const mode = useThemeStore((s) => s.mode);
  const systemScheme = useThemeStore((s) => s.systemScheme);
  const resolved = resolveTheme(mode, systemScheme);
  const colors = resolved === 'dark' ? DARK_THEME : LIGHT_THEME;
  return { colors, isDark: resolved === 'dark', mode, resolvedTheme: resolved };
}

/** Convenience alias — just the palette, for components that only need colors. */
export function useColors(): ThemePalette {
  return useTheme().colors;
}

/**
 * Mount once at the app root to hydrate the stored preference and keep the
 * system-scheme mirror in sync so `mode: 'system'` re-resolves live when
 * the user toggles dark mode in iOS/Android settings.
 */
export function useInitTheme(): void {
  const hydrate = useThemeStore((s) => s.hydrate);
  const setSystemScheme = useThemeStore((s) => s.setSystemScheme);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme);
    });
    return () => sub.remove();
  }, [setSystemScheme]);
}
