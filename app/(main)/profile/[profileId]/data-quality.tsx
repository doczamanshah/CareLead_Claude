import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { ConfirmCurrentButton } from '@/components/ConfirmCurrentButton';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import {
  useDataQualityCheck,
  useConfirmCurrentBatch,
} from '@/hooks/useDataQuality';
import { describeStaleAge, healthTierLabel } from '@/services/dataQuality';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  DataInconsistency,
  DataQualityCategory,
  DataQualityHealthTier,
  InconsistencyType,
  StaleItem,
  StalenessLevel,
} from '@/lib/types/dataQuality';

const STALE_GROUP_ORDER: StalenessLevel[] = ['very_stale', 'stale', 'aging'];

const STALE_GROUP_LABELS: Record<StalenessLevel, string> = {
  very_stale: 'Outdated — over a year old',
  stale: 'May need review',
  aging: 'Worth a check-in',
  fresh: 'Up to date',
};

const STALE_GROUP_COLORS: Record<StalenessLevel, string> = {
  very_stale: COLORS.tertiary.DEFAULT,
  stale: COLORS.warning.DEFAULT,
  aging: COLORS.text.secondary,
  fresh: COLORS.success.DEFAULT,
};

const CATEGORY_LABELS: Record<DataQualityCategory, string> = {
  medications: 'Medication',
  conditions: 'Condition',
  allergies: 'Allergy',
  insurance: 'Insurance',
  care_team: 'Provider',
  emergency_contact: 'Emergency Contact',
  lab_recency: 'Lab',
  other: 'Item',
};

const TIER_VISUAL: Record<
  DataQualityHealthTier,
  { color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  good: {
    color: COLORS.success.DEFAULT,
    bg: COLORS.success.light,
    icon: 'checkmark-circle',
  },
  fair: {
    color: COLORS.warning.DEFAULT,
    bg: COLORS.warning.light,
    icon: 'alert-circle',
  },
  needs_attention: {
    color: COLORS.tertiary.DEFAULT,
    bg: COLORS.tertiary.light + '33',
    icon: 'warning',
  },
};

export default function DataQualityScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const router = useRouter();
  const { activeProfile } = useActiveProfile();
  const householdId = activeProfile?.household_id ?? null;

  const { data: report, isLoading, error, refetch } = useDataQualityCheck(
    profileId ?? null,
    householdId,
  );
  const batchConfirm = useConfirmCurrentBatch(profileId ?? null);
  const [dismissedInconsistencies, setDismissedInconsistencies] = useState<Set<string>>(
    new Set(),
  );

  const grouped = useMemo(() => {
    const map = new Map<StalenessLevel, StaleItem[]>();
    for (const level of STALE_GROUP_ORDER) map.set(level, []);
    for (const item of report?.staleItems ?? []) {
      const list = map.get(item.staleness);
      if (list) list.push(item);
    }
    return map;
  }, [report]);

  const visibleInconsistencies = useMemo(
    () =>
      (report?.inconsistencies ?? []).filter((i) => !dismissedInconsistencies.has(i.id)),
    [report, dismissedInconsistencies],
  );

  if (!profileId) return <ScreenLayout error={new Error('Missing profile')} />;
  if (isLoading) return <ScreenLayout loading />;
  if (error) return <ScreenLayout error={error as Error} />;
  if (!report) return <ScreenLayout error={new Error('Could not load data quality report')} />;

  const tierVisual = TIER_VISUAL[report.healthTier];
  const totalStale = report.staleItems.length;
  const totalInc = visibleInconsistencies.length;

  const handleConfirmGroup = (level: StalenessLevel) => {
    const items = grouped.get(level) ?? [];
    if (items.length === 0) return;
    Alert.alert(
      'Confirm all current?',
      `Mark all ${items.length} ${level === 'very_stale' ? 'outdated' : 'aging'} items as still current?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm all',
          onPress: () => {
            batchConfirm.mutate(
              items.map((i) => ({ sourceType: i.sourceType, sourceId: i.sourceId })),
              { onSuccess: () => refetch() },
            );
          },
        },
      ],
    );
  };

  const handleInconsistencyAction = (inc: DataInconsistency) => {
    if (!profileId) return;
    switch (inc.type) {
      case 'med_without_condition':
        router.push(
          `/(main)/profile/${profileId}/add-fact?category=condition`,
        );
        break;
      case 'condition_without_provider':
        router.push(
          `/(main)/profile/${profileId}/add-fact?category=care_team`,
        );
        break;
      case 'condition_without_med':
        router.push(`/(main)/medications/create?profileId=${profileId}`);
        break;
      case 'duplicate_entries':
      case 'insurance_expired':
      case 'stale_emergency_contact':
        router.push(`/(main)/profile/${profileId}`);
        break;
    }
  };

  const dismissInconsistency = (id: string) => {
    setDismissedInconsistencies((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const navigateToSource = (item: StaleItem) => {
    if (item.sourceType === 'med_medications') {
      router.push(`/(main)/medications/${item.sourceId}`);
    } else if (item.sourceType === 'profile_facts') {
      router.push(`/(main)/profile/${profileId}`);
    } else if (item.sourceType === 'result_items') {
      router.push(`/(main)/results/${item.sourceId}`);
    }
  };

  return (
    <ScreenLayout title="Profile Data Quality">
      {/* Health summary banner */}
      <View style={[styles.tierBanner, { backgroundColor: tierVisual.bg }]}>
        <View style={[styles.tierIconWrap, { backgroundColor: tierVisual.color + '22' }]}>
          <Ionicons name={tierVisual.icon} size={26} color={tierVisual.color} />
        </View>
        <View style={styles.tierBannerBody}>
          <Text style={[styles.tierTitle, { color: tierVisual.color }]}>
            {healthTierLabel(report.healthTier)}
          </Text>
          <Text style={styles.tierSubtitle}>
            {totalStale === 0 && totalInc === 0
              ? 'Nothing needs your attention right now.'
              : [
                  totalStale > 0 ? `${totalStale} stale item${totalStale === 1 ? '' : 's'}` : null,
                  totalInc > 0 ? `${totalInc} inconsistency check${totalInc === 1 ? '' : 's'}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </Text>
        </View>
      </View>

      {/* Stale items */}
      {totalStale > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items to review</Text>
          {STALE_GROUP_ORDER.map((level) => {
            const items = grouped.get(level) ?? [];
            if (items.length === 0) return null;
            return (
              <View key={level} style={styles.staleGroup}>
                <View style={styles.staleGroupHeader}>
                  <View style={styles.staleGroupHeaderLeft}>
                    <View
                      style={[
                        styles.staleGroupDot,
                        { backgroundColor: STALE_GROUP_COLORS[level] },
                      ]}
                    />
                    <Text style={styles.staleGroupLabel}>
                      {STALE_GROUP_LABELS[level]} · {items.length}
                    </Text>
                  </View>
                  {items.length > 1 && (
                    <TouchableOpacity
                      onPress={() => handleConfirmGroup(level)}
                      style={styles.batchConfirmButton}
                      activeOpacity={0.7}
                      disabled={batchConfirm.isPending}
                    >
                      <Text style={styles.batchConfirmText}>
                        {batchConfirm.isPending ? 'Confirming…' : 'Confirm all'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Card>
                  {items.map((item, i) => (
                    <View key={item.id}>
                      {i > 0 && <View style={styles.divider} />}
                      <View style={styles.staleRow}>
                        <View style={styles.staleRowMain}>
                          <View style={styles.staleRowTop}>
                            <Text style={styles.staleLabel} numberOfLines={2}>
                              {item.label}
                            </Text>
                            <View style={styles.categoryBadge}>
                              <Text style={styles.categoryBadgeText}>
                                {CATEGORY_LABELS[item.category]}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.staleAge}>
                            {describeStaleAge(item.daysSinceUpdate)}
                          </Text>
                          <Text style={styles.staleSuggestion}>{item.suggestion}</Text>
                        </View>
                        <View style={styles.staleActions}>
                          <ConfirmCurrentButton
                            sourceType={item.sourceType}
                            sourceId={item.sourceId}
                            profileId={profileId}
                            label={item.label}
                            variant="text"
                            onConfirmed={refetch}
                          />
                          <TouchableOpacity
                            onPress={() => navigateToSource(item)}
                            style={styles.updateButton}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.updateButtonText}>Update</Text>
                            <Ionicons
                              name="chevron-forward"
                              size={14}
                              color={COLORS.text.secondary}
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ))}
                </Card>
              </View>
            );
          })}
        </View>
      )}

      {/* Inconsistencies */}
      {totalInc > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cross-check suggestions</Text>
          {visibleInconsistencies.map((inc) => (
            <InconsistencyCard
              key={inc.id}
              inconsistency={inc}
              onAct={() => handleInconsistencyAction(inc)}
              onDismiss={() => dismissInconsistency(inc.id)}
            />
          ))}
        </View>
      )}

      {/* All clear */}
      {totalStale === 0 && totalInc === 0 && (
        <View style={styles.allClear}>
          <Ionicons
            name="shield-checkmark"
            size={48}
            color={COLORS.success.DEFAULT}
          />
          <Text style={styles.allClearTitle}>Profile looks healthy</Text>
          <Text style={styles.allClearSubtitle}>
            All your data is current and consistent. We'll let you know when something needs review.
          </Text>
        </View>
      )}

      {/* Footer */}
      <Text style={styles.footerNote}>
        Last checked {new Date(report.lastCheckedAt).toLocaleString()}
      </Text>
    </ScreenLayout>
  );
}

interface InconsistencyCardProps {
  inconsistency: DataInconsistency;
  onAct: () => void;
  onDismiss: () => void;
}

const INCONSISTENCY_ACTION_LABEL: Record<InconsistencyType, string> = {
  med_without_condition: 'Add condition',
  condition_without_provider: 'Add specialist',
  condition_without_med: 'Add medication',
  duplicate_entries: 'Review profile',
  insurance_expired: 'Review insurance',
  stale_emergency_contact: 'Review contact',
};

function InconsistencyCard({ inconsistency, onAct, onDismiss }: InconsistencyCardProps) {
  const isWarning = inconsistency.severity === 'warning';
  const accentColor = isWarning ? COLORS.warning.DEFAULT : COLORS.text.secondary;
  return (
    <View style={styles.incCard}>
      <View style={styles.incHeader}>
        <View style={[styles.incDot, { backgroundColor: accentColor }]} />
        <Text style={styles.incTitle}>{inconsistency.title}</Text>
      </View>
      <Text style={styles.incDetail}>{inconsistency.detail}</Text>
      <Text style={styles.incSuggestion}>{inconsistency.suggestion}</Text>
      <View style={styles.incActions}>
        <TouchableOpacity
          onPress={onAct}
          style={[styles.incActionButton, styles.incActionPrimary]}
          activeOpacity={0.7}
        >
          <Text style={styles.incActionPrimaryText}>
            {INCONSISTENCY_ACTION_LABEL[inconsistency.type]}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDismiss}
          style={styles.incActionButton}
          activeOpacity={0.7}
        >
          <Text style={styles.incActionDismissText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tierBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  tierIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierBannerBody: {
    flex: 1,
  },
  tierTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.bold,
    marginBottom: 2,
  },
  tierSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  staleGroup: {
    marginBottom: 16,
  },
  staleGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  staleGroupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  staleGroupDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  staleGroupLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  batchConfirmButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  batchConfirmText: {
    fontSize: 12,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border.light,
  },
  staleRow: {
    paddingVertical: 12,
  },
  staleRowMain: {
    marginBottom: 10,
  },
  staleRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  staleLabel: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.surface.muted,
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  staleAge: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginBottom: 2,
  },
  staleSuggestion: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  staleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.surface.muted,
  },
  updateButtonText: {
    fontSize: 12,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
  },
  incCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    padding: 14,
    marginBottom: 10,
  },
  incHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  incDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  incTitle: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  incDetail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 4,
  },
  incSuggestion: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginBottom: 12,
  },
  incActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  incActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  incActionPrimary: {
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  incActionPrimaryText: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  incActionDismissText: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.tertiary,
  },
  allClear: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  allClearTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginTop: 12,
    marginBottom: 6,
  },
  allClearSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  footerNote: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textAlign: 'center',
    marginTop: 8,
  },
});
