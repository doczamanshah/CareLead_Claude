/**
 * Caregiver Welcome & Contribute screen.
 *
 * One-time guided entry point shown the first time a caregiver accesses a
 * profile they've been granted access to. Five quick-win options point to the
 * same creation paths the patient uses — caregivers aren't second-class
 * citizens, they're co-authors.
 *
 * Any card tap — or the explicit "I'll do this later" link — marks the
 * caregiver as onboarded for this profile so they aren't re-routed here
 * next time.
 */

import { useCallback } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useMarkCaregiverOnboarded } from '@/hooks/useCaregiverEnrichment';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

interface OptionCard {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  estimate: string;
  /** Called with the active profile id — each option navigates to its own flow. */
  navigate: (profileId: string, router: ReturnType<typeof useRouter>) => void;
}

const OPTIONS: OptionCard[] = [
  {
    key: 'medications',
    icon: 'medical-outline',
    title: 'Add their medications',
    subtitle: 'List medications you know they\u2019re taking',
    estimate: 'Takes about 30 seconds',
    navigate: (_profileId, router) => router.push('/(main)/medications/create'),
  },
  {
    key: 'conditions',
    icon: 'fitness-outline',
    title: 'Add their conditions',
    subtitle: 'Any diagnoses or health conditions',
    estimate: 'Takes about 30 seconds',
    navigate: (profileId, router) =>
      router.push({
        pathname: `/(main)/profile/${profileId}/add-fact`,
        params: { category: 'condition' },
      } as never),
  },
  {
    key: 'insurance',
    icon: 'card-outline',
    title: 'Snap their insurance card',
    subtitle: 'Take a photo of their insurance card',
    estimate: 'Takes about 20 seconds',
    navigate: (_profileId, router) => router.push('/(main)/capture/camera'),
  },
  {
    key: 'document',
    icon: 'document-outline',
    title: 'Upload a document',
    subtitle: 'Discharge papers, lab results, medication lists',
    estimate: 'Takes about 30 seconds',
    navigate: (_profileId, router) => router.push('/(main)/capture/upload'),
  },
  {
    key: 'care_team',
    icon: 'people-outline',
    title: 'Add their doctors',
    subtitle: 'Primary care, specialists, pharmacy',
    estimate: 'Takes about 45 seconds',
    navigate: (profileId, router) =>
      router.push({
        pathname: `/(main)/profile/${profileId}/add-fact`,
        params: { category: 'care_team' },
      } as never),
  },
];

export default function CaregiverContributeScreen() {
  const router = useRouter();
  const { profileId: paramProfileId } = useLocalSearchParams<{
    profileId?: string;
  }>();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const targetProfileId = paramProfileId ?? activeProfileId ?? null;
  const patientName = activeProfile?.display_name?.trim() || 'this profile';
  const markOnboarded = useMarkCaregiverOnboarded();

  const handleSelect = useCallback(
    (option: OptionCard) => {
      if (!targetProfileId) return;
      markOnboarded.mutate(targetProfileId);
      option.navigate(targetProfileId, router);
    },
    [markOnboarded, router, targetProfileId],
  );

  const handleSkip = useCallback(() => {
    if (targetProfileId) {
      markOnboarded.mutate(targetProfileId);
    }
    router.back();
  }, [markOnboarded, router, targetProfileId]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={handleSkip} style={styles.backButton}>
          <Text style={styles.backText}>Skip</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>
          Help build the profile
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Ionicons name="heart-outline" size={28} color={COLORS.primary.DEFAULT} />
          </View>
          <Text style={styles.heading}>
            Help build {patientName}'s health profile
          </Text>
          <Text style={styles.subheading}>
            The more complete the profile, the better CareLead can help. You can
            add information you know about.
          </Text>
        </View>

        <View style={styles.options}>
          {OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              activeOpacity={0.7}
              onPress={() => handleSelect(opt)}
            >
              <Card style={styles.optionCard}>
                <View style={styles.optionIconWrap}>
                  <Ionicons
                    name={opt.icon}
                    size={22}
                    color={COLORS.primary.DEFAULT}
                  />
                </View>
                <View style={styles.optionBody}>
                  <Text style={styles.optionTitle}>{opt.title}</Text>
                  <Text style={styles.optionSubtitle}>{opt.subtitle}</Text>
                  <Text style={styles.optionEstimate}>{opt.estimate}</Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={COLORS.text.tertiary}
                />
              </Card>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={styles.skipLink}
          activeOpacity={0.7}
          onPress={handleSkip}
        >
          <Text style={styles.skipLinkText}>I'll do this later</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: { paddingVertical: 4, paddingRight: 16 },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  navTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flex: 1,
    textAlign: 'center',
  },
  navSpacer: { width: 60 },
  scrollView: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heading: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
    marginBottom: 8,
  },
  subheading: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  options: {
    gap: 10,
    marginBottom: 24,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  optionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.primary.DEFAULT + '0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionBody: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  optionSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },
  optionEstimate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
    fontStyle: 'italic',
  },
  skipLink: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipLinkText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
