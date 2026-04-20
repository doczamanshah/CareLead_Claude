import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useBatchCaptureStore } from '@/stores/batchCaptureStore';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useSmartEnrichment } from '@/hooks/useSmartEnrichment';
import { SmartNudgeCard } from '@/components/SmartNudgeCard';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

interface CategoryOption {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const CATEGORIES: CategoryOption[] = [
  { key: 'medication_label', label: 'Medication bottles/labels', icon: 'medical-outline' },
  { key: 'insurance_card', label: 'Insurance cards', icon: 'card-outline' },
  { key: 'lab_result', label: 'Lab results', icon: 'flask-outline' },
  { key: 'discharge_summary', label: 'Discharge papers', icon: 'document-text-outline' },
  { key: 'prescription', label: 'Prescription papers', icon: 'receipt-outline' },
  { key: 'bill', label: 'Bills & EOBs', icon: 'wallet-outline' },
  { key: 'other', label: 'Other documents', icon: 'documents-outline' },
  { key: 'mix', label: 'A mix of everything', icon: 'albums-outline' },
];

export default function CatchUpScreen() {
  const router = useRouter();
  const setInitialCategories = useBatchCaptureStore((s) => s.setInitialCategories);
  const clear = useBatchCaptureStore((s) => s.clear);
  const [selected, setSelected] = useState<Set<string>>(new Set(['mix']));

  const { activeProfile, activeProfileId } = useActiveProfile();
  const householdId = activeProfile?.household_id ?? null;
  const {
    nonMilestoneNudges,
    tierInfo,
    totalFacts,
    dismiss,
  } = useSmartEnrichment(activeProfileId, householdId);

  const topNudges = nonMilestoneNudges.slice(0, 4);

  function toggle(key: string) {
    setSelected((prev) => {
      if (key === 'mix') return new Set(['mix']);
      const next = new Set(prev);
      next.delete('mix');
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === 0) return new Set(['mix']);
      return next;
    });
  }

  function handleStart() {
    clear();
    setInitialCategories(Array.from(selected));
    router.push('/(main)/capture/catch-up-capture');
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backRow}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={18} color={COLORS.primary.DEFAULT} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.iconCluster}>
          <View style={[styles.iconBubble, { backgroundColor: COLORS.primary.DEFAULT + '14' }]}>
            <Ionicons name="camera" size={26} color={COLORS.primary.DEFAULT} />
          </View>
          <View style={[styles.iconBubble, { backgroundColor: COLORS.accent.DEFAULT + '20' }]}>
            <Ionicons name="sparkles" size={22} color={COLORS.accent.dark} />
          </View>
          <View style={[styles.iconBubble, { backgroundColor: COLORS.secondary.DEFAULT + '20' }]}>
            <Ionicons name="document-text" size={24} color={COLORS.secondary.dark} />
          </View>
        </View>

        <Text style={styles.title}>Catch Up Your Profile</Text>
        <Text style={styles.subtitle}>
          Quickly snap photos of your health documents. CareLead will organize
          everything.
        </Text>

        {/* SECTION 1: Strengthen your profile — the "why" */}
        {activeProfileId && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Strengthen your profile</Text>
            <Text style={styles.sectionSubheading}>
              Here's what would make your profile more useful
            </Text>

            {topNudges.length > 0 ? (
              <View style={styles.nudgeList}>
                {topNudges.map((nudge) => (
                  <SmartNudgeCard
                    key={nudge.id}
                    nudge={nudge}
                    profileId={activeProfileId}
                    compact
                    onDismiss={() => dismiss(nudge.id)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.allGoodCard}>
                <View style={styles.allGoodIconWrap}>
                  <Ionicons
                    name={
                      (tierInfo?.icon as keyof typeof Ionicons.glyphMap) ??
                      'checkmark-circle'
                    }
                    size={22}
                    color={COLORS.success.DEFAULT}
                  />
                </View>
                <View style={styles.allGoodBody}>
                  <Text style={styles.allGoodTitle}>
                    Your profile is looking great!
                  </Text>
                  {tierInfo && (
                    <Text style={styles.allGoodDetail}>
                      {tierInfo.label} · {totalFacts} health fact
                      {totalFacts === 1 ? '' : 's'} tracked
                    </Text>
                  )}
                </View>
              </View>
            )}
          </View>
        )}

        {/* SECTION 2: Add Information — the "how" */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Ways to add information</Text>

          <TouchableOpacity
            style={styles.shortcutCard}
            activeOpacity={0.7}
            onPress={() => router.push('/(main)/medications/snap-label')}
          >
            <View style={styles.shortcutIconWrap}>
              <Ionicons name="camera-outline" size={20} color={COLORS.primary.DEFAULT} />
            </View>
            <View style={styles.shortcutBody}>
              <Text style={styles.shortcutTitle}>Snap a medication label</Text>
              <Text style={styles.shortcutDetail}>
                Photo of the bottle → extraction → confirm. Under 30 seconds.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.text.tertiary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.shortcutCard}
            activeOpacity={0.7}
            onPress={() => router.push('/(main)/capture/import-summary')}
          >
            <View style={[styles.shortcutIconWrap, styles.shortcutIconAccent]}>
              <Ionicons name="cloud-download-outline" size={20} color={COLORS.secondary.dark} />
            </View>
            <View style={styles.shortcutBody}>
              <Text style={styles.shortcutTitle}>Import health summary</Text>
              <Text style={styles.shortcutDetail}>
                One file from MyChart or another portal can build most of your profile.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.text.tertiary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.shortcutCard}
            activeOpacity={0.7}
            onPress={() => router.push('/(main)/(tabs)/health')}
          >
            <View style={[styles.shortcutIconWrap, styles.shortcutIconTertiary]}>
              <Ionicons name="create-outline" size={20} color={COLORS.accent.dark} />
            </View>
            <View style={styles.shortcutBody}>
              <Text style={styles.shortcutTitle}>Add manually</Text>
              <Text style={styles.shortcutDetail}>
                Enter information yourself in the Health tab.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.text.tertiary} />
          </TouchableOpacity>

          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Snap documents</Text>
          <Text style={styles.sectionSubheading}>
            What are you capturing?
          </Text>

          {CATEGORIES.map((cat) => {
            const isSelected = selected.has(cat.key);
            return (
              <TouchableOpacity
                key={cat.key}
                style={[styles.catRow, isSelected && styles.catRowSelected]}
                onPress={() => toggle(cat.key)}
                activeOpacity={0.7}
              >
                <View style={[styles.catIcon, isSelected && styles.catIconSelected]}>
                  <Ionicons
                    name={cat.icon}
                    size={20}
                    color={isSelected ? COLORS.text.inverse : COLORS.primary.DEFAULT}
                  />
                </View>
                <Text
                  style={[styles.catLabel, isSelected && styles.catLabelSelected]}
                >
                  {cat.label}
                </Text>
                {isSelected && (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={COLORS.primary.DEFAULT}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.spacer} />
        <Button title="Start Capturing" onPress={handleStart} size="lg" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  content: { padding: 24, paddingBottom: 48 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  iconCluster: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 16,
  },
  iconBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginTop: 4,
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    marginTop: 8,
    lineHeight: 22,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeading: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  sectionSubheading: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 12,
    lineHeight: 20,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  nudgeList: {
    gap: 10,
  },
  allGoodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.success.light,
    borderWidth: 1,
    borderColor: COLORS.success.DEFAULT + '33',
  },
  allGoodIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  allGoodBody: { flex: 1 },
  allGoodTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  allGoodDetail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    marginBottom: 8,
  },
  catRowSelected: {
    backgroundColor: COLORS.primary.DEFAULT + '0D',
    borderColor: COLORS.primary.DEFAULT,
  },
  catIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  catIconSelected: { backgroundColor: COLORS.primary.DEFAULT },
  catLabel: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  catLabelSelected: { color: COLORS.primary.dark },
  spacer: { height: 24 },
  shortcutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    marginBottom: 8,
  },
  shortcutIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutIconAccent: {
    backgroundColor: COLORS.secondary.DEFAULT + '22',
  },
  shortcutIconTertiary: {
    backgroundColor: COLORS.accent.DEFAULT + '22',
  },
  shortcutBody: { flex: 1 },
  shortcutTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  shortcutDetail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
    lineHeight: 16,
  },
});
