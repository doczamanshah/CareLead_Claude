import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: COLORS.primary.DEFAULT },
  secondary: { backgroundColor: COLORS.secondary.DEFAULT },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.primary.DEFAULT },
  ghost: { backgroundColor: 'transparent' },
};

const variantTextStyles: Record<ButtonVariant, TextStyle> = {
  primary: { color: COLORS.text.inverse },
  secondary: { color: COLORS.text.inverse },
  outline: { color: COLORS.primary.DEFAULT },
  ghost: { color: COLORS.primary.DEFAULT },
};

const sizeStyles: Record<ButtonSize, ViewStyle> = {
  sm: { paddingHorizontal: 16, paddingVertical: 8 },
  md: { paddingHorizontal: 24, paddingVertical: 12 },
  lg: { paddingHorizontal: 32, paddingVertical: 16 },
};

const sizeTextStyles: Record<ButtonSize, TextStyle> = {
  sm: { fontSize: FONT_SIZES.sm },
  md: { fontSize: FONT_SIZES.base },
  lg: { fontSize: FONT_SIZES.lg },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
}: ButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.base,
        variantStyles[variant],
        sizeStyles[size],
        disabled && styles.disabled,
      ]}
      activeOpacity={0.8}
    >
      {loading && (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'secondary' ? COLORS.text.inverse : COLORS.primary.DEFAULT}
          style={styles.spinner}
        />
      )}
      <Text style={[styles.text, variantTextStyles[variant], sizeTextStyles[size]]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  disabled: {
    opacity: 0.5,
  },
  spinner: {
    marginRight: 8,
  },
  text: {
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
