/**
 * Theme palettes for light and dark mode.
 *
 * The shape matches `COLORS` in `./colors.ts` (subset — only keys that differ
 * between modes). Static-first migration: existing screens keep importing
 * `COLORS` and stay light-only; screens that opt into dark mode import
 * `useColors()` from `hooks/useTheme.ts` and read the resolved palette.
 */

type ColorScale = {
  DEFAULT: string;
  light: string;
  lighter: string;
  lightest: string;
  50: string;
  dark: string;
};

export interface ThemePalette {
  primary: ColorScale;
  secondary: { DEFAULT: string; light: string; dark: string };
  accent: {
    DEFAULT: string;
    light: string;
    dark: string;
    teal: string;
    purple: string;
    orange: string;
    pink: string;
    indigo: string;
  };
  tertiary: { DEFAULT: string; light: string; dark: string };
  background: {
    DEFAULT: string;
    secondary: string;
    card: string;
    elevated: string;
    subtle: string;
  };
  surface: { DEFAULT: string; elevated: string; muted: string };
  text: {
    DEFAULT: string;
    secondary: string;
    tertiary: string;
    inverse: string;
  };
  border: {
    DEFAULT: string;
    light: string;
    dark: string;
    focus: string;
  };
  error: { DEFAULT: string; light: string };
  success: { DEFAULT: string; light: string };
  warning: { DEFAULT: string; light: string };
  status: {
    success: string;
    successLight: string;
    warning: string;
    warningLight: string;
    error: string;
    errorLight: string;
    info: string;
    infoLight: string;
    neutral: string;
    neutralLight: string;
  };
}

export const LIGHT_THEME: ThemePalette = {
  primary: {
    DEFAULT: '#1B4332',
    light: '#2D6A4F',
    lighter: '#40916C',
    lightest: '#E8F5E9',
    50: '#F0FFF4',
    dark: '#0C3B2E',
  },
  secondary: {
    DEFAULT: '#6D9773',
    light: '#8DB393',
    dark: '#547A59',
  },
  accent: {
    DEFAULT: '#FFBA00',
    light: '#FFCB3D',
    dark: '#CC9500',
    teal: '#14B8A6',
    purple: '#8B5CF6',
    orange: '#F97316',
    pink: '#EC4899',
    indigo: '#6366F1',
  },
  tertiary: {
    DEFAULT: '#B46617',
    light: '#D4841F',
    dark: '#8E5012',
  },
  background: {
    DEFAULT: '#F9FAFB',
    secondary: '#FFFFFF',
    card: '#FFFFFF',
    elevated: '#FFFFFF',
    subtle: '#F3F4F6',
  },
  surface: {
    DEFAULT: '#FFFFFF',
    elevated: '#FFFFFF',
    muted: '#F1F3F5',
  },
  text: {
    DEFAULT: '#1F2937',
    secondary: '#6B7280',
    tertiary: '#9CA3AF',
    inverse: '#FFFFFF',
  },
  border: {
    DEFAULT: '#E5E7EB',
    light: '#F3F4F6',
    dark: '#D1D5DB',
    focus: '#1B4332',
  },
  error: { DEFAULT: '#EF4444', light: '#FEE2E2' },
  success: { DEFAULT: '#22C55E', light: '#DCFCE7' },
  warning: { DEFAULT: '#F59E0B', light: '#FEF3C7' },
  status: {
    success: '#22C55E',
    successLight: '#DCFCE7',
    warning: '#F59E0B',
    warningLight: '#FEF3C7',
    error: '#EF4444',
    errorLight: '#FEE2E2',
    info: '#3B82F6',
    infoLight: '#DBEAFE',
    neutral: '#6B7280',
    neutralLight: '#F3F4F6',
  },
};

export const DARK_THEME: ThemePalette = {
  primary: {
    // Dark green still reads as the brand color against dark surfaces. We
    // lighten it one step so primary buttons/links have enough contrast.
    DEFAULT: '#2D6A4F',
    light: '#40916C',
    lighter: '#52B788',
    // "lightest" becomes a very dark green tint for backgrounds on dark mode.
    lightest: '#0D2818',
    50: '#0D2818',
    dark: '#1B4332',
  },
  secondary: {
    DEFAULT: '#8DB393',
    light: '#A8C9AD',
    dark: '#6D9773',
  },
  accent: {
    DEFAULT: '#FFCB3D',
    light: '#FFDB70',
    dark: '#FFBA00',
    teal: '#2DD4BF',
    purple: '#A78BFA',
    orange: '#FB923C',
    pink: '#F472B6',
    indigo: '#818CF8',
  },
  tertiary: {
    DEFAULT: '#D4841F',
    light: '#E59E3D',
    dark: '#B46617',
  },
  background: {
    DEFAULT: '#111827',
    secondary: '#1F2937',
    card: '#1F2937',
    elevated: '#374151',
    subtle: '#1F2937',
  },
  surface: {
    DEFAULT: '#1F2937',
    elevated: '#374151',
    muted: '#111827',
  },
  text: {
    DEFAULT: '#F9FAFB',
    secondary: '#D1D5DB',
    tertiary: '#9CA3AF',
    inverse: '#1F2937',
  },
  border: {
    DEFAULT: '#374151',
    light: '#1F2937',
    dark: '#4B5563',
    focus: '#40916C',
  },
  error: { DEFAULT: '#F87171', light: '#450A0A' },
  success: { DEFAULT: '#4ADE80', light: '#052E16' },
  warning: { DEFAULT: '#FBBF24', light: '#451A03' },
  status: {
    success: '#4ADE80',
    successLight: '#052E16',
    warning: '#FBBF24',
    warningLight: '#451A03',
    error: '#F87171',
    errorLight: '#450A0A',
    info: '#60A5FA',
    infoLight: '#172554',
    neutral: '#9CA3AF',
    neutralLight: '#1F2937',
  },
};
