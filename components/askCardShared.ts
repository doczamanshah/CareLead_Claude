import { COLORS } from '@/lib/constants/colors';
import type { FlagColor } from '@/lib/types/ask';

export const FLAG_COLORS: Record<FlagColor, { text: string; bg: string }> = {
  normal: { text: COLORS.success.DEFAULT, bg: COLORS.success.light },
  high: { text: COLORS.tertiary.DEFAULT, bg: COLORS.warning.light },
  low: { text: '#2563EB', bg: '#DBEAFE' },
  abnormal: { text: COLORS.warning.DEFAULT, bg: COLORS.warning.light },
  critical: { text: COLORS.error.DEFAULT, bg: COLORS.error.light },
};

export function flagColorFromString(flag: string | null | undefined): FlagColor {
  if (!flag) return 'normal';
  const f = flag.toLowerCase();
  if (f === 'normal' || f === 'in_range' || f === 'n') return 'normal';
  if (f === 'high' || f === 'h') return 'high';
  if (f === 'low' || f === 'l') return 'low';
  if (f === 'critical' || f === 'crit' || f === 'alert') return 'critical';
  return 'abnormal';
}

export function formatFlagLabel(flag: string | null | undefined): string {
  if (!flag) return '—';
  const f = flag.toLowerCase();
  if (f === 'normal') return 'Normal';
  if (f === 'high' || f === 'h') return 'High';
  if (f === 'low' || f === 'l') return 'Low';
  if (f === 'critical') return 'Critical';
  return flag.charAt(0).toUpperCase() + flag.slice(1);
}

export const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 6,
  elevation: 2,
} as const;
