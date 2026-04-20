import { View, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { COLORS } from '@/lib/constants/colors';
import { RADIUS, SHADOWS, SPACING } from '@/lib/constants/design';

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

function baseStyleFor(variant: CardVariant, accentColor?: string): ViewStyle {
  const common: ViewStyle = {
    backgroundColor: COLORS.background.card,
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
        borderColor: COLORS.border.DEFAULT,
      };
    case 'accent':
      return {
        ...common,
        ...SHADOWS.sm,
        borderLeftWidth: 4,
        borderLeftColor: accentColor ?? COLORS.primary.DEFAULT,
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
  const base = baseStyleFor(variant, accentColor);
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

// Export the legacy flat-style for any caller that composes it manually.
export const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.background.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
});
