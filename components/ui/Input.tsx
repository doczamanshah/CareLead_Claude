import { View, Text, TextInput, StyleSheet, type TextInputProps } from 'react-native';
import { useState } from 'react';
import { COLORS } from '@/lib/constants/colors';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/lib/constants/design';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function Input({ label, error, style, ...props }: InputProps) {
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? COLORS.status.error
    : focused
      ? COLORS.border.focus
      : 'transparent';

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[
          styles.input,
          { borderColor, borderWidth: focused || error ? 1 : 0 },
          style,
        ]}
        placeholderTextColor={COLORS.text.tertiary}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        {...props}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.lg,
  },
  label: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '500',
    color: COLORS.text.DEFAULT,
    marginBottom: SPACING.xs + 2,
  },
  input: {
    backgroundColor: COLORS.background.subtle,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    ...TYPOGRAPHY.body,
    color: COLORS.text.DEFAULT,
  },
  error: {
    ...TYPOGRAPHY.caption,
    color: COLORS.status.error,
    marginTop: SPACING.xs,
  },
});
