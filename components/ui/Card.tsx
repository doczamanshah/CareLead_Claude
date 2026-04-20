import { useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { RADIUS, SHADOWS, SPACING } from '@/lib/constants/design';
import type { ThemePalette } from '@/lib/constants/themes';

type CardVariant = 'default' | 'elevated' | 'outlined' | 'accent';
type CardPadding = 'sm' | 'md' | 'lg' | 'none';

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
  style?: ViewStyle;
  variant?: CardVariant;
  /** Left-border color — only applies to variant="accent". */
  accentColor?: string;
  padding?: CardPadding;
}

const PADDING_MAP: Record<CardPadding, number> = {
  none: 0,
  sm: SPACING.md, // 12
  md: SPACING.lg, // 16
  lg: SPACING.xl, // 20
};

function baseStyleFor(
  variant: CardVariant,
  colors: ThemePalette,
  accentColor?: string,
): ViewStyle {
  const common: ViewStyle = {
    backgroundColor: colors.background.card,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  };
  switch (variant) {
    case 'elevated':
      return { ...common, ...SHADOWS.md };
    case 'outlined':
      return {
        ...common,
        borderWidth: 1,
        borderColor: colors.border.DEFAULT,
      };
    case 'accent':
      return {
        ...common,
        ...SHADOWS.sm,
        borderLeftWidth: 4,
        borderLeftColor: accentColor ?? colors.primary.DEFAULT,
      };
    case 'default':
    default:
      return { ...common, ...SHADOWS.sm };
  }
}

export function Card({
  children,
  onPress,
  onLongPress,
  delayLongPress,
  style,
  variant = 'default',
  accentColor,
  padding = 'md',
}: CardProps) {
  const { colors } = useTheme();
  const base = useMemo(
    () => baseStyleFor(variant, colors, accentColor),
    [variant, colors, accentColor],
  );
  const paddingStyle: ViewStyle = { padding: PADDING_MAP[padding] };

  if (onPress || onLongPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={delayLongPress}
        activeOpacity={0.7}
        style={[base, paddingStyle, style]}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={[base, paddingStyle, style]}>{children}</View>;
}

// Legacy flat-style export kept for callers that compose it manually — uses
// the light palette and is not theme-aware. Prefer <Card/> in new code.
export const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
});
