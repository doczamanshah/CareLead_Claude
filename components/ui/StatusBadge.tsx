import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '@/lib/constants/colors';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/lib/constants/design';

type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';
type StatusSize = 'sm' | 'md';

interface StatusBadgeProps {
  label: string;
  variant: StatusVariant;
  size?: StatusSize;
}

const VARIANT_COLORS: Record<StatusVariant, { fg: string; bg: string }> = {
  success: { fg: COLORS.status.success, bg: COLORS.status.successLight },
  warning: { fg: COLORS.status.warning, bg: COLORS.status.warningLight },
  error: { fg: COLORS.status.error, bg: COLORS.status.errorLight },
  info: { fg: COLORS.status.info, bg: COLORS.status.infoLight },
  neutral: { fg: COLORS.status.neutral, bg: COLORS.status.neutralLight },
};

export function StatusBadge({ label, variant, size = 'sm' }: StatusBadgeProps) {
  const { fg, bg } = VARIANT_COLORS[variant];
  const isLg = size === 'md';
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: bg,
          paddingHorizontal: isLg ? SPACING.md : SPACING.sm,
          paddingVertical: isLg ? SPACING.xs : 2,
        },
      ]}
    >
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    borderRadius: RADIUS.full,
  },
  label: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
});
