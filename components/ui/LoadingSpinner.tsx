import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES } from '@/lib/constants/typography';

interface LoadingSpinnerProps {
  message?: string;
  size?: 'small' | 'large';
}

export function LoadingSpinner({
  message,
  size = 'large',
}: LoadingSpinnerProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size={size} color={COLORS.primary.DEFAULT} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    color: COLORS.text.secondary,
    marginTop: 12,
    textAlign: 'center',
    fontSize: FONT_SIZES.base,
  },
});
