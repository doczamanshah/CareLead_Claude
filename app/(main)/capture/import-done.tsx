import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useHealthSummaryImportStore } from '@/stores/healthSummaryImportStore';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const COUNT_ORDER: Array<{
  key: 'medications' | 'allergies' | 'conditions' | 'procedures' | 'immunizations' | 'lab_results' | 'providers' | 'insurance' | 'emergency_contacts';
  singular: string;
  plural: string;
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap;
}> = [
  { key: 'medications', singular: 'medication', plural: 'medications', icon: 'medkit-outline' },
  { key: 'allergies', singular: 'allergy', plural: 'allergies', icon: 'warning-outline' },
  { key: 'conditions', singular: 'condition', plural: 'conditions', icon: 'pulse-outline' },
  { key: 'procedures', singular: 'procedure', plural: 'procedures', icon: 'bandage-outline' },
  { key: 'immunizations', singular: 'immunization', plural: 'immunizations', icon: 'shield-checkmark-outline' },
  { key: 'lab_results', singular: 'lab result', plural: 'lab results', icon: 'flask-outline' },
  { key: 'providers', singular: 'provider', plural: 'providers', icon: 'people-outline' },
  { key: 'insurance', singular: 'insurance plan', plural: 'insurance plans', icon: 'shield-outline' },
  { key: 'emergency_contacts', singular: 'emergency contact', plural: 'emergency contacts', icon: 'call-outline' },
];

export default function ImportDoneScreen() {
  const router = useRouter();
  const counts = useHealthSummaryImportStore((s) => s.importedCounts);
  const extraction = useHealthSummaryImportStore((s) => s.extraction);
  const clear = useHealthSummaryImportStore((s) => s.clear);

  const rows = useMemo(() => {
    if (!counts) return [];
    return COUNT_ORDER.filter((c) => counts[c.key] > 0).map((c) => ({
      ...c,
      count: counts[c.key],
    }));
  }, [counts]);

  const total = rows.reduce((n, r) => n + r.count, 0);
  const confidence = extraction?.overall_confidence ?? 1;

  function handleDone() {
    clear();
    router.replace('/(main)/(tabs)');
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.successIconWrap}>
          <Ionicons name="checkmark-circle" size={60} color={COLORS.success.DEFAULT} />
        </View>

        <Text style={styles.title}>Health summary imported!</Text>
        <Text style={styles.subtitle}>
          {total > 0
            ? 'Your profile just got a lot more complete.'
            : 'Nothing was added this time.'}
        </Text>

        {rows.length > 0 && (
          <View style={styles.countsCard}>
            {rows.map((row) => (
              <View key={row.key} style={styles.countRow}>
                <View style={styles.countIconWrap}>
                  <Ionicons
                    name={row.icon}
                    size={18}
                    color={COLORS.primary.DEFAULT}
                  />
                </View>
                <Text style={styles.countText}>
                  {row.count} {row.count === 1 ? row.singular : row.plural} added
                </Text>
              </View>
            ))}
          </View>
        )}

        {confidence < 0.7 && total > 0 && (
          <View style={styles.reviewBanner}>
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={COLORS.accent.dark}
            />
            <Text style={styles.reviewBannerText}>
              Some items may need your review. Open the profile to verify them.
            </Text>
          </View>
        )}

        <View style={styles.tipBox}>
          <Ionicons name="information-circle-outline" size={16} color={COLORS.text.secondary} />
          <Text style={styles.tipText}>
            Imported items are marked unverified — tap any item in your profile to
            confirm or edit.
          </Text>
        </View>

        <View style={styles.buttonGroup}>
          <Button title="Go to Home" onPress={handleDone} size="lg" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  content: {
    padding: 24,
    paddingBottom: 48,
    alignItems: 'center',
  },
  successIconWrap: {
    marginTop: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 22,
  },
  countsCard: {
    alignSelf: 'stretch',
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    gap: 10,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  countIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    padding: 12,
    backgroundColor: COLORS.accent.DEFAULT + '14',
    borderRadius: 10,
    alignSelf: 'stretch',
  },
  reviewBannerText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.accent.dark,
    lineHeight: 20,
  },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 16,
    alignSelf: 'stretch',
  },
  tipText: {
    flex: 1,
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    lineHeight: 16,
  },
  buttonGroup: {
    marginTop: 28,
    alignSelf: 'stretch',
  },
});
