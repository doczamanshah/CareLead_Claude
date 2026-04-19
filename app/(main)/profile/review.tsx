/**
 * Quarterly Profile Review Wizard
 *
 * Walks the patient through their saved profile one section at a time —
 * medications, conditions, allergies, care team, insurance, emergency
 * contacts — with three fast choices per item:
 *
 *   • Still correct  → verified_at = now (profile facts) or updated_at bump
 *   • Needs update   → deep-link to the item's edit screen
 *   • No longer relevant → soft-remove with confirmation
 *
 * Plus a per-section "All correct" fast path for the common case where
 * nothing changed. Target: 2 minutes start to finish.
 *
 * Skipping the wizard anytime is fine; the review timestamp only writes on
 * the final "Done" tap on the summary screen, which is also when the 90-day
 * briefing cooldown resets.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import {
  useConfirmReviewItem,
  useConfirmSection,
  useMarkReviewCompleted,
  useProfileReviewData,
  useRemoveReviewItem,
} from '@/hooks/useProfileReview';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  ProfileReviewItem,
  ProfileReviewSection,
} from '@/lib/types/profile';

type ItemDecision = 'confirmed' | 'updated' | 'removed' | 'pending';

interface Tally {
  confirmed: number;
  updated: number;
  removed: number;
}

export default function ProfileReviewScreen() {
  const router = useRouter();
  const { activeProfileId, activeProfile } = useActiveProfile();
  const householdId = activeProfile?.household_id ?? null;

  const { data: review, isLoading, error } = useProfileReviewData(
    activeProfileId,
    householdId,
  );
  const confirmItem = useConfirmReviewItem();
  const confirmSection = useConfirmSection();
  const removeItem = useRemoveReviewItem();
  const markCompleted = useMarkReviewCompleted();

  const [sectionIndex, setSectionIndex] = useState(0);
  // Tracks per-item decision so the wizard can tally at the end and so the
  // currently-visible section shows which items are already resolved.
  const [decisions, setDecisions] = useState<Record<string, ItemDecision>>({});
  const [showSummary, setShowSummary] = useState(false);

  const totalSections = review?.sections.length ?? 0;
  const currentSection = review?.sections[sectionIndex];

  const tally: Tally = useMemo(() => {
    let confirmed = 0;
    let updated = 0;
    let removed = 0;
    for (const d of Object.values(decisions)) {
      if (d === 'confirmed') confirmed++;
      else if (d === 'updated') updated++;
      else if (d === 'removed') removed++;
    }
    return { confirmed, updated, removed };
  }, [decisions]);

  const goNext = useCallback(() => {
    if (sectionIndex + 1 < totalSections) {
      setSectionIndex((i) => i + 1);
    } else {
      setShowSummary(true);
    }
  }, [sectionIndex, totalSections]);

  const recordDecision = useCallback((itemId: string, decision: ItemDecision) => {
    setDecisions((prev) => ({ ...prev, [itemId]: decision }));
  }, []);

  const handleStillCorrect = useCallback(
    (item: ProfileReviewItem) => {
      confirmItem.mutate(item, {
        onSuccess: () => recordDecision(item.id, 'confirmed'),
      });
    },
    [confirmItem, recordDecision],
  );

  const handleNeedsUpdate = useCallback(
    (item: ProfileReviewItem) => {
      recordDecision(item.id, 'updated');
      if (item.sourceType === 'medication') {
        router.push(`/(main)/medications/${item.sourceId}`);
      } else if (activeProfileId) {
        router.push(`/(main)/profile/${activeProfileId}`);
      }
    },
    [activeProfileId, recordDecision, router],
  );

  const handleRemove = useCallback(
    (item: ProfileReviewItem) => {
      if (!activeProfileId) return;
      Alert.alert(
        'Remove from active profile?',
        'This will be removed from your active profile. You can always re-add it later.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              removeItem.mutate(
                { item, profileId: activeProfileId },
                { onSuccess: () => recordDecision(item.id, 'removed') },
              );
            },
          },
        ],
      );
    },
    [activeProfileId, recordDecision, removeItem],
  );

  const handleAllCorrect = useCallback(() => {
    if (!currentSection) return;
    confirmSection.mutate(currentSection, {
      onSuccess: () => {
        setDecisions((prev) => {
          const next = { ...prev };
          for (const item of currentSection.items) {
            if (!next[item.id]) next[item.id] = 'confirmed';
          }
          return next;
        });
        goNext();
      },
    });
  }, [confirmSection, currentSection, goNext]);

  const handleFinish = useCallback(() => {
    if (!activeProfileId) return;
    markCompleted.mutate(activeProfileId, {
      onSuccess: () => router.back(),
    });
  }, [activeProfileId, markCompleted, router]);

  if (isLoading || !review) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ReviewNavBar onBack={() => router.back()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ReviewNavBar onBack={() => router.back()} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Couldn't load your profile data.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (showSummary) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ReviewNavBar onBack={() => setShowSummary(false)} />
        <SummaryView tally={tally} onDone={handleFinish} loading={markCompleted.isPending} />
      </SafeAreaView>
    );
  }

  if (!currentSection) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ReviewNavBar onBack={() => router.back()} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>No sections to review.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ReviewNavBar onBack={() => router.back()} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>Quarterly Profile Check-in</Text>
        <Text style={styles.subheading}>
          Let's make sure everything is still accurate. This takes about 2 minutes.
        </Text>

        <ProgressStrip
          current={sectionIndex + 1}
          total={totalSections}
        />

        <View style={styles.sectionHeader}>
          <Ionicons
            name={currentSection.icon as keyof typeof Ionicons.glyphMap}
            size={22}
            color={COLORS.primary.DEFAULT}
          />
          <Text style={styles.sectionTitle}>{currentSection.title}</Text>
        </View>

        {currentSection.isEmpty ? (
          <EmptySectionView
            section={currentSection}
            onAdd={() => {
              if (activeProfileId) {
                router.push(`/(main)/profile/${activeProfileId}/add-fact`);
              }
            }}
            onSkip={goNext}
          />
        ) : (
          <>
            {currentSection.items.map((item) => (
              <ReviewItemCard
                key={item.id}
                item={item}
                decision={decisions[item.id] ?? 'pending'}
                onStillCorrect={() => handleStillCorrect(item)}
                onNeedsUpdate={() => handleNeedsUpdate(item)}
                onRemove={() => handleRemove(item)}
              />
            ))}

            <View style={styles.sectionActions}>
              <Button
                title="All correct"
                onPress={handleAllCorrect}
                loading={confirmSection.isPending}
              />
              <TouchableOpacity
                style={styles.skipButton}
                activeOpacity={0.7}
                onPress={goNext}
              >
                <Text style={styles.skipText}>Skip this section</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function ReviewNavBar({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.navBar}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>{'\u2039'} Back</Text>
      </TouchableOpacity>
      <Text style={styles.navTitle} numberOfLines={1}>
        Profile Review
      </Text>
      <View style={styles.navSpacer} />
    </View>
  );
}

function ProgressStrip({ current, total }: { current: number; total: number }) {
  const percent = total > 0 ? (current / total) * 100 : 0;
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressLabelRow}>
        <Text style={styles.progressLabel}>
          {current} of {total}
        </Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percent}%` }]} />
      </View>
    </View>
  );
}

function ReviewItemCard({
  item,
  decision,
  onStillCorrect,
  onNeedsUpdate,
  onRemove,
}: {
  item: ProfileReviewItem;
  decision: ItemDecision;
  onStillCorrect: () => void;
  onNeedsUpdate: () => void;
  onRemove: () => void;
}) {
  const isResolved = decision !== 'pending';

  return (
    <Card style={styles.itemCard}>
      <View style={styles.itemRow}>
        <View style={styles.itemBody}>
          <Text style={styles.itemLabel} numberOfLines={2}>
            {item.label}
          </Text>
          <View style={styles.itemMetaRow}>
            <Text style={styles.itemDetail}>{item.detail}</Text>
            {item.isStale && !isResolved && (
              <View style={styles.staleBadge}>
                <Ionicons
                  name="time-outline"
                  size={12}
                  color={COLORS.accent.dark}
                />
                <Text style={styles.staleBadgeText}>Stale</Text>
              </View>
            )}
          </View>
        </View>
        {isResolved && (
          <DecisionChip decision={decision} />
        )}
      </View>

      {!isResolved && (
        <View style={styles.itemActions}>
          <TouchableOpacity
            style={[styles.actionChip, styles.actionChipConfirm]}
            onPress={onStillCorrect}
            activeOpacity={0.7}
          >
            <Ionicons
              name="checkmark"
              size={16}
              color={COLORS.success.DEFAULT}
            />
            <Text style={styles.actionChipText}>Still correct</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionChip}
            onPress={onNeedsUpdate}
            activeOpacity={0.7}
          >
            <Ionicons
              name="pencil"
              size={15}
              color={COLORS.primary.DEFAULT}
            />
            <Text style={styles.actionChipText}>Needs update</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionChip, styles.actionChipRemove]}
            onPress={onRemove}
            activeOpacity={0.7}
          >
            <Ionicons
              name="close"
              size={16}
              color={COLORS.error.DEFAULT}
            />
            <Text style={styles.actionChipText}>No longer relevant</Text>
          </TouchableOpacity>
        </View>
      )}
    </Card>
  );
}

function DecisionChip({ decision }: { decision: ItemDecision }) {
  if (decision === 'confirmed') {
    return (
      <View style={[styles.decisionChip, styles.decisionChipConfirmed]}>
        <Ionicons name="checkmark-circle" size={14} color={COLORS.success.DEFAULT} />
        <Text style={[styles.decisionChipText, { color: COLORS.success.DEFAULT }]}>
          Confirmed
        </Text>
      </View>
    );
  }
  if (decision === 'updated') {
    return (
      <View style={[styles.decisionChip, styles.decisionChipUpdated]}>
        <Ionicons name="pencil" size={13} color={COLORS.primary.DEFAULT} />
        <Text style={[styles.decisionChipText, { color: COLORS.primary.DEFAULT }]}>
          Updated
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.decisionChip, styles.decisionChipRemoved]}>
      <Ionicons name="close-circle" size={14} color={COLORS.error.DEFAULT} />
      <Text style={[styles.decisionChipText, { color: COLORS.error.DEFAULT }]}>
        Removed
      </Text>
    </View>
  );
}

function EmptySectionView({
  section,
  onAdd,
  onSkip,
}: {
  section: ProfileReviewSection;
  onAdd: () => void;
  onSkip: () => void;
}) {
  return (
    <Card style={styles.emptyCard}>
      <Ionicons
        name={section.icon as keyof typeof Ionicons.glyphMap}
        size={32}
        color={COLORS.text.tertiary}
      />
      <Text style={styles.emptyTitle}>Nothing here yet</Text>
      <Text style={styles.emptyBody}>
        You haven't added anything to {section.title.toLowerCase()}. Want to add something?
      </Text>
      <View style={styles.emptyActions}>
        <Button title="Add" variant="outline" onPress={onAdd} />
        <TouchableOpacity
          style={styles.skipButton}
          activeOpacity={0.7}
          onPress={onSkip}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

function SummaryView({
  tally,
  onDone,
  loading,
}: {
  tally: Tally;
  onDone: () => void;
  loading: boolean;
}) {
  const total = tally.confirmed + tally.updated + tally.removed;
  return (
    <View style={styles.summaryWrap}>
      <View style={styles.summaryIconCircle}>
        <Ionicons
          name="checkmark-circle"
          size={48}
          color={COLORS.success.DEFAULT}
        />
      </View>
      <Text style={styles.summaryTitle}>Profile review complete!</Text>
      <Text style={styles.summaryBody}>
        Your profile is now up to date.
      </Text>

      <View style={styles.summaryStats}>
        <SummaryStat label="Confirmed" value={tally.confirmed} />
        <SummaryStat label="Updated" value={tally.updated} />
        <SummaryStat label="Removed" value={tally.removed} />
      </View>

      {total === 0 && (
        <Text style={styles.summaryNoChanges}>
          No changes this time — we'll check back in a few months.
        </Text>
      )}

      <View style={styles.summaryAction}>
        <Button title="Done" onPress={onDone} loading={loading} />
      </View>
    </View>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryStatValue}>{value}</Text>
      <Text style={styles.summaryStatLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.error.DEFAULT,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: { paddingVertical: 4, paddingRight: 16 },
  backText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  navTitle: {
    fontSize: FONT_SIZES.lg,
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
  heading: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 6,
  },
  subheading: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  progressWrap: {
    marginBottom: 24,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressTrack: {
    height: 6,
    backgroundColor: COLORS.border.light,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary.DEFAULT,
    borderRadius: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  itemCard: {
    marginBottom: 10,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  itemBody: {
    flex: 1,
  },
  itemLabel: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  itemDetail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  staleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.accent.DEFAULT + '1A',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  staleBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.accent.dark,
  },
  itemActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  actionChipConfirm: {
    backgroundColor: COLORS.success.DEFAULT + '0D',
    borderColor: COLORS.success.DEFAULT + '33',
  },
  actionChipRemove: {
    backgroundColor: COLORS.error.DEFAULT + '0D',
    borderColor: COLORS.error.DEFAULT + '33',
  },
  actionChipText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  decisionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  decisionChipConfirmed: {
    backgroundColor: COLORS.success.DEFAULT + '14',
  },
  decisionChipUpdated: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  decisionChipRemoved: {
    backgroundColor: COLORS.error.DEFAULT + '14',
  },
  decisionChipText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  sectionActions: {
    marginTop: 16,
    gap: 10,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  skipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginTop: 6,
  },
  emptyBody: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  emptyActions: {
    marginTop: 12,
    width: '100%',
    gap: 8,
  },
  summaryWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    alignItems: 'center',
  },
  summaryIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.success.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  summaryTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
    marginBottom: 8,
  },
  summaryBody: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 28,
  },
  summaryStats: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 36,
    marginBottom: 28,
  },
  summaryStat: {
    alignItems: 'center',
  },
  summaryStatValue: {
    fontSize: FONT_SIZES['3xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
  },
  summaryStatLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  summaryNoChanges: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 12,
  },
  summaryAction: {
    width: '100%',
    marginTop: 'auto',
    marginBottom: 24,
  },
});
