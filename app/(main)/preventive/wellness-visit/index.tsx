import { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useWellnessVisitStore } from '@/stores/wellnessVisitStore';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  WELLNESS_STEPS,
  type WellnessStepKey,
} from '@/lib/types/wellnessVisit';

export default function WellnessVisitOverviewScreen() {
  const router = useRouter();
  const hydrated = useWellnessVisitStore((s) => s.hydrated);
  const hydrate = useWellnessVisitStore((s) => s.hydrate);
  const stepsCompleted = useWellnessVisitStore((s) => s.stepsCompleted);
  const freeformLen = useWellnessVisitStore((s) => s.freeformInput.length);
  const questionCount = useWellnessVisitStore((s) => s.questions.length);
  const selectedCount = useWellnessVisitStore((s) => s.selectedScreenings.length);
  const packetGenerated = useWellnessVisitStore((s) => s.packetGenerated);
  const resetVisit = useWellnessVisitStore((s) => s.resetVisit);
  const markStepCompleted = useWellnessVisitStore((s) => s.markStepCompleted);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const completedCount = useMemo(
    () => Object.values(stepsCompleted).filter(Boolean).length,
    [stepsCompleted],
  );
  const total = WELLNESS_STEPS.length;

  const getStepStatus = useCallback(
    (key: WellnessStepKey): 'not_started' | 'in_progress' | 'done' => {
      if (stepsCompleted[key]) return 'done';
      if (key === 'freeform' && freeformLen > 0) return 'in_progress';
      if (key === 'questions' && questionCount > 0) return 'in_progress';
      if (key === 'preventive_agenda' && selectedCount > 0) return 'in_progress';
      if (key === 'packet' && packetGenerated) return 'done';
      return 'not_started';
    },
    [
      stepsCompleted,
      freeformLen,
      questionCount,
      selectedCount,
      packetGenerated,
    ],
  );

  const handleRecentlyReviewed = useCallback(() => {
    Alert.alert(
      'Profile review complete',
      'We\'ll mark your profile review as done. You can still revisit it anytime from this screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark as done',
          onPress: () => markStepCompleted('profile_review', true),
        },
      ],
    );
  }, [markStepCompleted]);

  const handleStartOver = useCallback(() => {
    Alert.alert(
      'Start over?',
      'This clears everything in your current wellness visit prep. This can\'t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start over',
          style: 'destructive',
          onPress: resetVisit,
        },
      ],
    );
  }, [resetVisit]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary.DEFAULT} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Annual Wellness Visit Prep</Text>
        </View>
        <Text style={styles.subtitle}>
          Get the most out of your annual checkup. This takes about 15–20
          minutes and makes your visit much more productive.
        </Text>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.progressWrap}>
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              {completedCount} of {total} steps done
            </Text>
            {completedCount > 0 && (
              <TouchableOpacity onPress={handleStartOver} activeOpacity={0.7}>
                <Text style={styles.startOverText}>Start over</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${(completedCount / total) * 100}%` },
              ]}
            />
          </View>
        </View>

        <Text style={styles.sectionTitle}>STEPS (DO IN ANY ORDER)</Text>

        {WELLNESS_STEPS.map((step) => {
          const status = getStepStatus(step.key);
          return (
            <StepCard
              key={step.key}
              title={step.title}
              subtitle={step.subtitle}
              icon={step.icon}
              status={status}
              onPress={() => router.push(step.route as never)}
            />
          );
        })}

        <TouchableOpacity
          onPress={handleRecentlyReviewed}
          activeOpacity={0.7}
          style={styles.recentlyReviewed}
        >
          <Ionicons
            name="checkmark-done-outline"
            size={18}
            color={COLORS.text.secondary}
          />
          <Text style={styles.recentlyReviewedText}>
            I've already done a profile review recently
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function StepCard({
  title,
  subtitle,
  icon,
  status,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: string;
  status: 'not_started' | 'in_progress' | 'done';
  onPress: () => void;
}) {
  const statusLabel =
    status === 'done'
      ? 'Done'
      : status === 'in_progress'
      ? 'In progress'
      : 'Not started';

  const statusColor =
    status === 'done'
      ? COLORS.success.DEFAULT
      : status === 'in_progress'
      ? COLORS.accent.dark
      : COLORS.text.tertiary;

  const badgeBg =
    status === 'done'
      ? COLORS.success.light
      : status === 'in_progress'
      ? COLORS.accent.DEFAULT + '1F'
      : COLORS.surface.muted;

  return (
    <Card style={stepStyles.card} onPress={onPress}>
      <View style={stepStyles.row}>
        <View
          style={[
            stepStyles.iconBubble,
            status === 'done' && { backgroundColor: COLORS.success.light },
          ]}
        >
          <Ionicons
            name={
              status === 'done'
                ? 'checkmark'
                : (icon as keyof typeof Ionicons.glyphMap)
            }
            size={20}
            color={
              status === 'done'
                ? COLORS.success.DEFAULT
                : COLORS.primary.DEFAULT
            }
          />
        </View>
        <View style={stepStyles.body}>
          <Text style={stepStyles.title}>{title}</Text>
          <Text style={stepStyles.subtitle}>{subtitle}</Text>
          <View style={[stepStyles.statusPill, { backgroundColor: badgeBg }]}>
            <Text style={[stepStyles.statusPillText, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </View>
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={COLORS.text.tertiary}
        />
      </View>
    </Card>
  );
}

const stepStyles = StyleSheet.create({
  card: { marginBottom: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 4 },
  title: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 19,
  },
  statusPill: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusPillText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 40, paddingHorizontal: 24 },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 8,
    marginLeft: -4,
  },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
    marginTop: 8,
  },
  progressWrap: {
    marginTop: 16,
    marginBottom: 20,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  startOverText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.surface.muted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary.DEFAULT,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    letterSpacing: 1,
    marginBottom: 10,
  },
  recentlyReviewed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.surface.muted,
    marginTop: 12,
  },
  recentlyReviewedText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
});
