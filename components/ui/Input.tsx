import { View, Text, TextInput, StyleSheet, type TextInputProps } from 'react-native';
import { useState } from 'react';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function Input({ label, error, style, ...props }: InputProps) {
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? COLORS.error.DEFAULT
    : focused
      ? COLORS.primary.DEFAULT
      : COLORS.border.DEFAULT;

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[styles.input, { borderColor }, style]}
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
    marginBottom: 16,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
  },
  error: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.error.DEFAULT,
    marginTop: 4,
  },
});
