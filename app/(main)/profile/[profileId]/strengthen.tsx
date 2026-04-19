import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAccessGrants } from '@/hooks/useCaregivers';
import { useSmartEnrichment, getMilestone } from '@/hooks/useSmartEnrichment';
import {
  MilestoneBadgeCard,
  SmartNudgeCard,
} from '@/components/SmartNudgeCard';
import type { CategoryHealth } from '@/services/smartEnrichment';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

function healthColor(health: CategoryHealth): string {
  if (health === 'good') return COLORS.success.DEFAULT;
  if (health === 'sparse') return COLORS.warning.DEFAULT;
  return COLORS.error.DEFAULT;
}

function healthIcon(
  health: CategoryHealth,
): keyof typeof Ionicons.glyphMap {
  if (health === 'good') return 'checkmark-circle';
  if (health === 'sparse') return 'alert-circle-outline';
  return 'close-circle';
}

export default function StrengthenProfileScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const router = useRouter();
  const { activeProfile } = useActiveProfile();
  const householdId = activeProfile?.household_id ?? null;

  const {
    nonMilestoneNudges,
    milestoneNudges,
    tierInfo,
    categoryBreakdown,
    earnedMilestones,
    totalFacts,
    isLoading,
    dismiss,
  } = useSmartEnrichment(profileId ?? null, householdId);

  const { data: accessGrants } = useAccessGrants(profileId ?? null);
  const activeCaregiver = useMemo(() => {
    const list = accessGrants ?? [];
    return list.find((g) => g.status === 'active') ?? null;
  }, [accessGrants]);

  const [categoryExpanded, setCategoryExpanded] = useState(false);

  if (isLoading || !profileId || !tierInfo) {
    return <ScreenLayout loading />;
  }

  const handleAskCaregiver = async () => {
    if (!activeCaregiver) return;
    const caregiverName =
      activeCaregiver.grantee_display_name?.trim() || 'there';
    const topThree = nonMilestoneNudges.slice(0, 3).map((n) => `• ${n.title}`).join('\n');
    const message = topThree
      ? `Hey ${caregiverName}, can you help update my health profile on CareLead?\n${topThree}`
      : `Hey ${caregiverName}, can you help keep my health profile up to date?`;
    try {
      await Share.share({ message });
    } catch {
      // user cancelled
    }
  };

  const progressPct =
    tierInfo.nextThreshold
      ? Math.min(100, Math.round((totalFacts / tierInfo.nextThreshold) * 100))
      : 100;

  return (
    <ScreenLayout>
      {/* Tier visualization */}
      <View style={styles.tierCard}>
        <View style={styles.tierIconWrap}>
          <Ionicons
            name={tierInfo.icon as keyof typeof Ionicons.glyphMap}
            size={32}
            color={COLORS.secondary.dark}
          />
        </View>
        <View style={styles.tierBody}>
          <Text style={styles.tierLabel}>{tierInfo.label}</Text>
          <Text style={styles.tierFactCount}>
            {totalFacts} health fact{totalFacts === 1 ? '' : 's'} tracked
          </Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>
          {tierInfo.remaining !== null && tierInfo.nextTier ? (
            <Text style={styles.tierNext}>
              {tierInfo.remaining} more item{tierInfo.remaining === 1 ? '' : 's'} to reach '
              {tierInfo.nextTier === 'growing'
                ? 'Growing'
                : tierInfo.nextTier === 'strong'
                ? 'Strong'
                : 'Comprehensive'}
              '
            </Text>
          ) : (
            <Text style={styles.tierNext}>
              You've reached the top tier — keep it current.
            </Text>
          )}
        </View>
      </View>

      {/* Suggested next steps */}
      {nonMilestoneNudges.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SUGGESTED NEXT STEPS</Text>
          <View style={styles.nudgeList}>
            {nonMilestoneNudges.map((nudge) => (
              <SmartNudgeCard
                key={nudge.id}
                nudge={nudge}
                profileId={profileId}
                onDismiss={() => dismiss(nudge.id)}
              />
            ))}
          </View>
        </View>
      )}

      {/* Milestone earned this visit */}
      {milestoneNudges.length > 0 && (
        <View style={styles.section}>
          {milestoneNudges.map((m) => (
            <MilestoneBadgeCard
              key={m.id}
              title={m.title}
              detail={m.detail}
              icon={m.icon}
            />
          ))}
        </View>
      )}

      {/* Earned milestones summary */}
      {earnedMilestones.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>MILESTONES EARNED</Text>
          <View style={styles.milestoneGrid}>
            {earnedMilestones.map((id) => {
              const meta = getMilestone(id);
              if (!meta) return null;
              return (
                <View key={id} style={styles.milestoneSmall}>
                  <Ionicons
                    name={meta.icon as keyof typeof Ionicons.glyphMap}
                    size={18}
                    color={COLORS.success.DEFAULT}
                  />
                  <Text style={styles.milestoneSmallText} numberOfLines={2}>
                    {meta.title}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Quick-access batch flows */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.bigAction}
          activeOpacity={0.75}
          onPress={() => router.push('/(main)/capture/import-summary')}
        >
          <View style={styles.bigActionIconWrap}>
            <Ionicons
              name="cloud-download-outline"
              size={22}
              color={COLORS.primary.DEFAULT}
            />
          </View>
          <View style={styles.bigActionBody}>
            <View style={styles.bigActionTitleRow}>
              <Text style={styles.bigActionTitle}>Import health summary</Text>
              <View style={styles.highImpactBadge}>
                <Text style={styles.highImpactBadgeText}>High impact</Text>
              </View>
            </View>
            <Text style={styles.bigActionDetail}>
              One file from your portal can fill most of your profile at once.
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={COLORS.primary.DEFAULT}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bigAction, styles.bigActionSecondary]}
          activeOpacity={0.75}
          onPress={() => router.push('/(main)/capture/catch-up')}
        >
          <View
            style={[
              styles.bigActionIconWrap,
              { backgroundColor: COLORS.secondary.DEFAULT + '22' },
            ]}
          >
            <Ionicons
              name="albums-outline"
              size={22}
              color={COLORS.secondary.dark}
            />
          </View>
          <View style={styles.bigActionBody}>
            <Text style={styles.bigActionTitle}>Catch Up flow</Text>
            <Text style={styles.bigActionDetail}>
              Snap photos of bottles, cards, and documents to fill gaps fast.
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={COLORS.secondary.dark}
          />
        </TouchableOpacity>

        {activeCaregiver && (
          <TouchableOpacity
            style={[styles.bigAction, styles.bigActionSecondary]}
            activeOpacity={0.75}
            onPress={handleAskCaregiver}
          >
            <View
              style={[
                styles.bigActionIconWrap,
                { backgroundColor: COLORS.primary.DEFAULT + '14' },
              ]}
            >
              <Ionicons
                name="people-outline"
                size={22}
                color={COLORS.primary.DEFAULT}
              />
            </View>
            <View style={styles.bigActionBody}>
              <Text style={styles.bigActionTitle}>
                Ask {activeCaregiver.grantee_display_name?.trim() || 'your caregiver'} to help
              </Text>
              <Text style={styles.bigActionDetail}>
                Share your top gaps so they can add them for you.
              </Text>
            </View>
            <Ionicons
              name="share-outline"
              size={18}
              color={COLORS.primary.DEFAULT}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Category breakdown (collapsible) */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.breakdownHeader}
          activeOpacity={0.75}
          onPress={() => setCategoryExpanded((v) => !v)}
        >
          <Text style={styles.sectionTitle}>CATEGORY BREAKDOWN</Text>
          <Ionicons
            name={categoryExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={COLORS.text.tertiary}
          />
        </TouchableOpacity>
        {categoryExpanded && (
          <View style={styles.breakdownList}>
            {categoryBreakdown.map((cat) => (
              <View key={cat.key} style={styles.breakdownRow}>
                <Ionicons
                  name={cat.icon as keyof typeof Ionicons.glyphMap}
                  size={18}
                  color={COLORS.text.secondary}
                />
                <View style={styles.breakdownBody}>
                  <Text style={styles.breakdownLabel}>{cat.label}</Text>
                  <Text style={styles.breakdownHint}>{cat.hint}</Text>
                </View>
                <Ionicons
                  name={healthIcon(cat.health)}
                  size={20}
                  color={healthColor(cat.health)}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      {nonMilestoneNudges.length === 0 && milestoneNudges.length === 0 && (
        <View style={styles.emptyContainer}>
          <Ionicons
            name="checkmark-circle"
            size={48}
            color={COLORS.success.DEFAULT}
          />
          <Text style={styles.emptyTitle}>Your profile is in great shape</Text>
          <Text style={styles.emptySubtitle}>
            Nothing urgent right now. CareLead will let you know when there's
            something helpful to add.
          </Text>
        </View>
      )}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  tierCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    marginBottom: 22,
    backgroundColor: COLORS.secondary.DEFAULT + '14',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.secondary.DEFAULT + '33',
  },
  tierIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierBody: {
    flex: 1,
  },
  tierLabel: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  tierFactCount: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  progressBar: {
    height: 6,
    backgroundColor: COLORS.border.light,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 10,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.secondary.dark,
    borderRadius: 3,
  },
  tierNext: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 6,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  nudgeList: {
    gap: 10,
  },
  milestoneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  milestoneSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.success.light,
    borderRadius: 999,
  },
  milestoneSmallText: {
    fontSize: 12,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  bigAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginBottom: 10,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '33',
  },
  bigActionSecondary: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderColor: COLORS.border.DEFAULT,
  },
  bigActionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primary.DEFAULT + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigActionBody: { flex: 1 },
  bigActionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  bigActionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  highImpactBadge: {
    backgroundColor: COLORS.accent.DEFAULT + '33',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  highImpactBadgeText: {
    fontSize: 10,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.accent.dark,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bigActionDetail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
    lineHeight: 16,
  },
  breakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  breakdownList: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    overflow: 'hidden',
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  breakdownBody: {
    flex: 1,
  },
  breakdownLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  breakdownHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
});
