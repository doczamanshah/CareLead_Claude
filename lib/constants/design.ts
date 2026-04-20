/**
 * Phase 3 design tokens — spacing, radius, shadow, and typography presets.
 *
 * These coexist with the older `FONT_SIZES` / `FONT_WEIGHTS` primitives in
 * `typography.ts`. Use the `TYPOGRAPHY.*` presets in new code; the older
 * primitives remain available for screens that haven't been touched yet.
 */
import type { TextStyle, ViewStyle } from 'react-native';

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  /** Pill / circle. */
  full: 999,
} as const;

export const SHADOWS: Record<'sm' | 'md' | 'lg', ViewStyle> = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
};

export const TYPOGRAPHY = {
  // Headings
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 } satisfies TextStyle,
  h2: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 } satisfies TextStyle,
  h3: { fontSize: 18, fontWeight: '600' } satisfies TextStyle,
  h4: { fontSize: 16, fontWeight: '600' } satisfies TextStyle,

  // Body
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22 } satisfies TextStyle,
  bodySmall: { fontSize: 13, fontWeight: '400', lineHeight: 18 } satisfies TextStyle,

  // Labels
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  } satisfies TextStyle,
  caption: { fontSize: 12, fontWeight: '400' } satisfies TextStyle,

  // Actions
  button: { fontSize: 15, fontWeight: '600' } satisfies TextStyle,
  buttonSmall: { fontSize: 13, fontWeight: '600' } satisfies TextStyle,
} as const;
