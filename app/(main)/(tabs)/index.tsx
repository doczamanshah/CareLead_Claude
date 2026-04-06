import { View, Text, StyleSheet } from 'react-native';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES } from '@/lib/constants/typography';

export default function HomeScreen() {
  return (
    <ScreenLayout title="Today">
      <View style={styles.container}>
        <Text style={styles.text}>
          Welcome to CareLead. Your care, in your hands.
        </Text>
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
  },
  text: {
    color: COLORS.text.secondary,
    fontSize: FONT_SIZES.base,
  },
});
