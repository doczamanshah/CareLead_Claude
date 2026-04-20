import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { COLORS } from '@/lib/constants/colors';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/lib/constants/design';

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
  // "secondary" was the green sage. Phase 3 maps it to a softer tinted
  // primary surface for visual consistency with the new system.
  secondary: { backgroundColor: COLORS.primary.lighter },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: COLORS.primary.DEFAULT,
  },
  ghost: { backgroundColor: 'transparent' },
};

const variantTextStyles: Record<ButtonVariant, TextStyle> = {
  primary: { color: COLORS.text.inverse },
  secondary: { color: COLORS.text.inverse },
  outline: { color: COLORS.primary.DEFAULT },
  ghost: { color: COLORS.primary.DEFAULT },
};

const sizeStyles: Record<ButtonSize, ViewStyle> = {
  sm: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  md: { paddingHorizontal: SPACING.xxl, paddingVertical: SPACING.md },
  lg: { paddingHorizontal: SPACING.xxxl, paddingVertical: SPACING.lg },
};

const sizeTextStyles: Record<ButtonSize, TextStyle> = {
  sm: TYPOGRAPHY.buttonSmall,
  md: TYPOGRAPHY.button,
  lg: { ...TYPOGRAPHY.button, fontSize: 17 },
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
          color={
            variant === 'primary' || variant === 'secondary'
              ? COLORS.text.inverse
              : COLORS.primary.DEFAULT
          }
          style={styles.spinner}
        />
      )}
      <Text style={[variantTextStyles[variant], sizeTextStyles[size]]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  disabled: {
    opacity: 0.5,
  },
  spinner: {
    marginRight: SPACING.sm,
  },
});
