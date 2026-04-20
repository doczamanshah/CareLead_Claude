/**
 * CareLead color palette.
 *
 * The original palette (primary/secondary/accent/tertiary, surface/background,
 * border, error/success/warning) is preserved verbatim — hundreds of files
 * reference these keys, and renaming would break the world.
 *
 * Phase 3 visual polish adds:
 *   - primary.lighter / primary.lightest / primary.50 for hover/tint surfaces
 *   - background.card / background.elevated / background.subtle aliases
 *   - status.success / status.warning / status.error / status.info family
 *   - border.focus alias
 *   - accent.teal / purple / orange / pink / indigo (data-viz / category badges)
 *
 * The Phase 3 polish slightly warms two values:
 *   - background.DEFAULT  #F8F9FA → #F9FAFB  (visually identical)
 *   - text.DEFAULT        #1A1A1A → #1F2937  (slightly warmer charcoal)
 */
export const COLORS = {
  primary: {
    DEFAULT: '#1B4332',
    light: '#2D6A4F',
    lighter: '#40916C',
    lightest: '#E8F5E9',
    /** Barely-there green tint — large surface backgrounds. */
    50: '#F0FFF4',
    /** Legacy alias kept for back-compat (was the original very dark green). */
    dark: '#0C3B2E',
  },
  secondary: {
    DEFAULT: '#6D9773',
    light: '#8DB393',
    dark: '#547A59',
  },
  accent: {
    /** Original gold/amber accent (kept for back-compat). */
    DEFAULT: '#FFBA00',
    light: '#FFCB3D',
    dark: '#CC9500',
    /** Phase 3 data-viz / category-badge accents. Use sparingly. */
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
    /** White cards on the warm background. */
    card: '#FFFFFF',
    /** Elevated surfaces (modals, sheets). */
    elevated: '#FFFFFF',
    /** Subtle section / input fill. */
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
    /** Border color when an input is focused — matches primary. */
    focus: '#1B4332',
  },
  error: {
    DEFAULT: '#EF4444',
    light: '#FEE2E2',
  },
  success: {
    DEFAULT: '#22C55E',
    light: '#DCFCE7',
  },
  warning: {
    DEFAULT: '#F59E0B',
    light: '#FEF3C7',
  },
  /**
   * Status palette — semantic shorthand for the variants above. Use
   * COLORS.status.* in new components for clarity; existing files can
   * keep using COLORS.error.DEFAULT etc. (they reference the same hex).
   */
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
} as const;
