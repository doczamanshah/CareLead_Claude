import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

type Option = {
  key: 'typed' | 'dictated' | 'upload';
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  route: string;
};

const OPTIONS: Option[] = [
  {
    key: 'typed',
    icon: 'document-text-outline',
    title: 'Type or Paste',
    subtitle: 'Enter or paste your result text',
    route: '/(main)/results/add-typed',
  },
  {
    key: 'dictated',
    icon: 'mic-outline',
    title: 'Dictate',
    subtitle: 'Describe your results in your own words',
    route: '/(main)/results/add-dictated',
  },
  {
    key: 'upload',
    icon: 'cloud-upload-outline',
    title: 'Upload Report',
    subtitle: 'Photo or PDF of your result',
    route: '/(main)/results/add-upload',
  },
];

export default function AddResultScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>New Result</Text>
        <Text style={styles.subtitle}>How would you like to add this result?</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.optionsContainer}
        showsVerticalScrollIndicator={false}
      >
        {OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={styles.optionCard}
            activeOpacity={0.7}
            onPress={() => router.push(opt.route as never)}
          >
            <View style={styles.optionIconCircle}>
              <Ionicons name={opt.icon} size={26} color={COLORS.primary.DEFAULT} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{opt.title}</Text>
              <Text style={styles.optionDesc}>{opt.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.text.tertiary} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backButton: { marginBottom: 8 },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
    lineHeight: 20,
  },
  optionsContainer: {
    paddingHorizontal: 24,
    paddingTop: 24,
    gap: 12,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  optionIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  optionText: { flex: 1 },
  optionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  optionDesc: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
});
