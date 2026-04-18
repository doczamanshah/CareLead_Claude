import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import {
  usePreventiveItems,
  useRunScan,
  useCreateIntentSheet,
} from '@/hooks/usePreventive';
import { generatePreventiveIntentSheet } from '@/services/preventiveIntentSheet';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  PREVENTIVE_STATUS_LABELS,
  PREVENTIVE_CATEGORY_LABELS,
  PREVENTIVE_STATUS_COLORS,
} from '@/lib/types/preventive';
import type {
  PreventiveItemWithRule,
  PreventiveStatus,
} from '@/lib/types/preventive';

const SCAN_STALENESS_HOURS = 24;

function isActionNeeded(status: PreventiveStatus): boolean {
  return status === 'due' || status === 'due_soon';
}

function isUpToDate(status: PreventiveStatus): boolean {
  return status === 'up_to_date' || status === 'completed';
}

function formatShortDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusOrder(status: PreventiveStatus): number {
  if (status === 'due') return 0;
  if (status === 'due_soon') return 1;
  if (status === 'needs_review') return 2;
  if (status === 'scheduled') return 3;
  if (status === 'up_to_date' || status === 'completed') return 4;
  return 5;
}

export default function PreventiveCareScreen() {
  const router = useRouter();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const { data: items, isLoading, refetch, error } = usePreventiveItems(activeProfileId);
  const runScan = useRunScan();
  const createIntentSheet = useCreateIntentSheet();
  const [refreshing, setRefreshing] = useState(false);
  const [showUpToDate, setShowUpToDate] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  const [showDeferred, setShowDeferred] = useState(false);

  const autoScanRanRef = useRef<string | null>(null);

  // Auto-run scan on first load if no items exist yet OR if latest scan is stale.
  useEffect(() => {
    if (!activeProfileId || !activeProfile?.household_id) return;
    if (isLoading || runScan.isPending) return;
    if (autoScanRanRef.current === activeProfileId) return;
    if (!items) return;

    const lastUpdated = items
      .map((i) => i.updated_at)
      .sort()
      .at(-1);

    const stale =
      !lastUpdated ||
      Date.now() - new Date(lastUpdated).getTime() > SCAN_STALENESS_HOURS * 60 * 60 * 1000;

    if (items.length === 0 || stale) {
      autoScanRanRef.current = activeProfileId;
      runScan.mutate({
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
      });
    } else {
      autoScanRanRef.current = activeProfileId;
    }
  }, [activeProfileId, activeProfile?.household_id, items, isLoading, runScan]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleManualScan = useCallback(() => {
    if (!activeProfileId || !activeProfile?.household_id) return;
    runScan.mutate({
      profileId: activeProfileId,
      householdId: activeProfile.household_id,
    });
  }, [activeProfileId, activeProfile?.household_id, runScan]);

  const handleCreatePlan = useCallback(
    (selectedItems: PreventiveItemWithRule[]) => {
      if (!activeProfileId || !activeProfile?.household_id || selectedItems.length === 0) return;
      const content = generatePreventiveIntentSheet({
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
        selectedItems,
      });
      createIntentSheet.mutate(
        {
          profileId: activeProfileId,
          householdId: activeProfile.household_id,
          content,
        },
        {
          onSuccess: (sheet) => {
            router.push({
              pathname: '/(main)/preventive/intent-review',
              params: { sheetId: sheet.id },
            });
          },
          onError: (err) => {
            Alert.alert(
              'Could not start plan',
              err instanceof Error ? err.message : 'Please try again.',
            );
          },
        },
      );
    },
    [activeProfileId, activeProfile?.household_id, createIntentSheet, router],
  );

  const grouped = useMemo(() => {
    const byStatus = {
      due: [] as PreventiveItemWithRule[],
      due_soon: [] as PreventiveItemWithRule[],
      needs_review: [] as PreventiveItemWithRule[],
      scheduled: [] as PreventiveItemWithRule[],
      up_to_date: [] as PreventiveItemWithRule[],
      completed: [] as PreventiveItemWithRule[],
      deferred: [] as PreventiveItemWithRule[],
      declined: [] as PreventiveItemWithRule[],
    };
    for (const item of items ?? []) {
      byStatus[item.status].push(item);
    }

    const actionNeeded = [...byStatus.due, ...byStatus.due_soon].sort(
      (a, b) => statusOrder(a.status) - statusOrder(b.status),
    );
    const needsReview = byStatus.needs_review;
    const scheduled = byStatus.scheduled;
    const upToDate = [...byStatus.up_to_date, ...byStatus.completed];
    const deferredDeclined = [...byStatus.deferred, ...byStatus.declined];

    return { actionNeeded, needsReview, scheduled, upToDate, deferredDeclined };
  }, [items]);

  const attentionCount =
    grouped.actionNeeded.length + grouped.needsReview.length;

  const totalItems = (items ?? []).length;
  const allClear = totalItems > 0 && attentionCount === 0;

  // Loading / first-scan spinner state
  const isScanning = runScan.isPending;
  const showInitialScan = isScanning && totalItems === 0;

  if (isLoading && !refreshing) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header
          onBack={() => router.back()}
          onScan={handleManualScan}
          onAsk={() => router.push({ pathname: '/(main)/ask', params: { domain: 'preventive' } })}
          scanDisabled={true}
          scanning={false}
        />
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading your preventive care...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header
          onBack={() => router.back()}
          onScan={handleManualScan}
          onAsk={() => router.push({ pathname: '/(main)/ask', params: { domain: 'preventive' } })}
          scanDisabled={true}
          scanning={false}
        />
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={36} color={COLORS.text.tertiary} />
          <Text style={styles.errorText}>Couldn't load your preventive care.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary.DEFAULT}
          />
        }
      >
        <Header
          onBack={() => router.back()}
          onScan={handleManualScan}
          onAsk={() => router.push({ pathname: '/(main)/ask', params: { domain: 'preventive' } })}
          scanDisabled={isScanning}
          scanning={isScanning}
        />

        {/* Initial scan indicator */}
        {showInitialScan ? (
          <View style={styles.initialScan}>
            <ActivityIndicator color={COLORS.primary.DEFAULT} />
            <Text style={styles.initialScanText}>
              Checking your preventive care status...
            </Text>
          </View>
        ) : totalItems === 0 ? (
          <EmptyState onRunScan={handleManualScan} scanning={isScanning} />
        ) : (
          <>
            {/* Summary bar */}
            <View style={styles.summaryBar}>
              {allClear ? (
                <View style={styles.summaryAllClear}>
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={COLORS.success.DEFAULT}
                  />
                  <Text style={styles.summaryAllClearText}>
                    You're up to date on your preventive care
                  </Text>
                </View>
              ) : attentionCount > 0 ? (
                <View style={styles.summaryRow}>
                  <View style={styles.summaryPill}>
                    <Text style={styles.summaryPillText}>
                      {attentionCount} {attentionCount === 1 ? 'item needs' : 'items need'} attention
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* Action Needed */}
            {grouped.actionNeeded.length > 0 && (
              <Section title="Action Needed">
                {grouped.actionNeeded.map((item) => (
                  <PreventiveItemCard
                    key={item.id}
                    item={item}
                    onPress={() => router.push(`/(main)/preventive/${item.id}`)}
                  />
                ))}
                <TouchableOpacity
                  style={[
                    styles.createPlanButton,
                    createIntentSheet.isPending && styles.createPlanButtonDisabled,
                  ]}
                  onPress={() => handleCreatePlan(grouped.actionNeeded)}
                  disabled={createIntentSheet.isPending}
                  activeOpacity={0.8}
                >
                  {createIntentSheet.isPending ? (
                    <ActivityIndicator color={COLORS.text.inverse} size="small" />
                  ) : (
                    <>
                      <Ionicons name="add-circle" size={18} color={COLORS.text.inverse} />
                      <Text style={styles.createPlanButtonText}>
                        Create Plan for {grouped.actionNeeded.length}{' '}
                        {grouped.actionNeeded.length === 1 ? 'Item' : 'Items'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </Section>
            )}

            {/* Needs Your Input */}
            {grouped.needsReview.length > 0 && (
              <Section title="Needs Your Input">
                {grouped.needsReview.map((item) => (
                  <PreventiveItemCard
                    key={item.id}
                    item={item}
                    onPress={() => router.push(`/(main)/preventive/${item.id}`)}
                  />
                ))}
              </Section>
            )}

            {/* Scheduled */}
            {grouped.scheduled.length > 0 && (
              <CollapsibleSection
                title="Scheduled"
                count={grouped.scheduled.length}
                expanded={showScheduled}
                onToggle={() => setShowScheduled((v) => !v)}
              >
                {grouped.scheduled.map((item) => (
                  <PreventiveItemCard
                    key={item.id}
                    item={item}
                    onPress={() => router.push(`/(main)/preventive/${item.id}`)}
                  />
                ))}
              </CollapsibleSection>
            )}

            {/* Up to Date */}
            {grouped.upToDate.length > 0 && (
              <CollapsibleSection
                title="Up to Date"
                count={grouped.upToDate.length}
                expanded={showUpToDate}
                onToggle={() => setShowUpToDate((v) => !v)}
              >
                {grouped.upToDate.map((item) => (
                  <PreventiveItemCard
                    key={item.id}
                    item={item}
                    onPress={() => router.push(`/(main)/preventive/${item.id}`)}
                  />
                ))}
              </CollapsibleSection>
            )}

            {/* Deferred / Declined */}
            {grouped.deferredDeclined.length > 0 && (
              <CollapsibleSection
                title="Deferred / Declined"
                count={grouped.deferredDeclined.length}
                expanded={showDeferred}
                onToggle={() => setShowDeferred((v) => !v)}
              >
                {grouped.deferredDeclined.map((item) => (
                  <PreventiveItemCard
                    key={item.id}
                    item={item}
                    onPress={() => router.push(`/(main)/preventive/${item.id}`)}
                  />
                ))}
              </CollapsibleSection>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Header({
  onBack,
  onScan,
  onAsk,
  scanDisabled,
  scanning,
}: {
  onBack: () => void;
  onScan: () => void;
  onAsk: () => void;
  scanDisabled: boolean;
  scanning: boolean;
}) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={22} color={COLORS.primary.DEFAULT} />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Preventive Care</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={onAsk}
            style={styles.askButton}
            activeOpacity={0.7}
            accessibilityLabel="Ask CareLead about preventive care"
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={18}
              color={COLORS.primary.DEFAULT}
            />
            <Text style={styles.askButtonText}>Ask</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onScan}
            disabled={scanDisabled}
            style={[styles.scanButton, scanDisabled && styles.scanButtonDisabled]}
            activeOpacity={0.7}
            accessibilityLabel="Run eligibility scan"
          >
            {scanning ? (
              <ActivityIndicator size="small" color={COLORS.primary.DEFAULT} />
            ) : (
              <Ionicons name="refresh-outline" size={20} color={COLORS.primary.DEFAULT} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function CollapsibleSection({
  title,
  count,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        style={styles.collapsibleHeader}
      >
        <Text style={styles.sectionTitle}>
          {title.toUpperCase()}{'  '}
          <Text style={styles.collapsibleCount}>({count})</Text>
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={COLORS.text.tertiary}
        />
      </TouchableOpacity>
      {expanded && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

function PreventiveItemCard({
  item,
  onPress,
}: {
  item: PreventiveItemWithRule;
  onPress: () => void;
}) {
  const statusColor = PREVENTIVE_STATUS_COLORS[item.status];
  const categoryLabel = PREVENTIVE_CATEGORY_LABELS[item.rule.category];
  const statusLabel = PREVENTIVE_STATUS_LABELS[item.status];
  const dimmed = item.status === 'deferred' || item.status === 'declined';
  const upToDate = isUpToDate(item.status);

  const lastDone = formatShortDate(item.last_done_date);
  const nextDue = formatShortDate(item.next_due_date);

  const rationaleOneLine = (item.rationale ?? '').split('.')[0];
  const hasMissing = (item.missing_data ?? []).length > 0;

  const guidelineLine = item.rule.guideline_version
    ? `${item.rule.guideline_source} ${item.rule.guideline_version}`
    : item.rule.guideline_source;

  return (
    <Card
      style={dimmed ? { ...styles.itemCard, ...styles.itemCardDimmed } : styles.itemCard}
      onPress={onPress}
    >
      <View style={styles.itemRow}>
        <View style={styles.itemInfo}>
          <View style={styles.itemTitleRow}>
            <Text style={styles.itemTitle} numberOfLines={2}>
              {item.rule.title}
            </Text>
            {upToDate && (
              <Ionicons
                name="checkmark-circle"
                size={18}
                color={COLORS.success.DEFAULT}
              />
            )}
          </View>

          {!hasMissing && !!rationaleOneLine && (
            <Text style={styles.itemRationale} numberOfLines={2}>
              {rationaleOneLine}
            </Text>
          )}

          {/* Missing data prompts as chips */}
          {hasMissing && (
            <View style={styles.missingChipsRow}>
              {(item.missing_data ?? []).slice(0, 2).map((md, i) => (
                <View key={i} style={styles.missingChip}>
                  <Ionicons
                    name="help-circle-outline"
                    size={12}
                    color={COLORS.accent.dark}
                  />
                  <Text style={styles.missingChipText} numberOfLines={1}>
                    {shortPromptLabel(md.field)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Up-to-date meta line */}
          {upToDate && (lastDone || nextDue) && (
            <Text style={styles.itemMeta}>
              {lastDone ? `Last done: ${lastDone}` : 'Completed'}
              {nextDue ? `  ·  Next due: ${nextDue}` : ''}
            </Text>
          )}

          {/* Deferred/declined reason */}
          {dimmed && item.declined_reason && (
            <Text style={styles.itemMeta} numberOfLines={2}>
              {item.declined_reason}
            </Text>
          )}

          <View style={styles.itemFooter}>
            <View style={styles.categoryChip}>
              <Text style={styles.categoryChipText}>{categoryLabel}</Text>
            </View>
            <Text style={styles.guidelineText}>{guidelineLine}</Text>
          </View>
        </View>

        <View style={[styles.statusPill, { backgroundColor: statusColor + '20' }]}>
          <Text style={[styles.statusPillText, { color: statusColor }]}>
            {statusLabel}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function shortPromptLabel(field: string): string {
  switch (field) {
    case 'last_done_date':
      return 'Last screening date needed';
    case 'date_of_birth':
      return 'Date of birth needed';
    case 'sex':
      return 'Sex needed';
    case 'conditions':
      return 'More health info needed';
    default:
      return 'More info needed';
  }
}

function EmptyState({
  onRunScan,
  scanning,
}: {
  onRunScan: () => void;
  scanning: boolean;
}) {
  return (
    <View style={styles.emptyWrap}>
      <Card>
        <View style={styles.emptyContainer}>
          <Ionicons
            name="shield-checkmark-outline"
            size={48}
            color={COLORS.primary.DEFAULT}
            style={styles.emptyIcon}
          />
          <Text style={styles.emptyText}>
            Let's check your preventive care status
          </Text>
          <Text style={styles.emptySubtext}>
            We'll look at recommended screenings and vaccines based on your age,
            sex, and health history. You'll review everything before anything is
            added to your care plan.
          </Text>
          <TouchableOpacity
            style={[styles.emptyCta, scanning && styles.emptyCtaDisabled]}
            onPress={onRunScan}
            disabled={scanning}
            activeOpacity={0.8}
          >
            {scanning ? (
              <ActivityIndicator color={COLORS.text.inverse} />
            ) : (
              <Text style={styles.emptyCtaText}>Run Check</Text>
            )}
          </TouchableOpacity>
        </View>
      </Card>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  loadingText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  retryText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Header
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
  scanButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  scanButtonDisabled: {
    opacity: 0.5,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  askButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  askButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },

  // Initial scan indicator
  initialScan: {
    marginHorizontal: 24,
    marginTop: 24,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  initialScanText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },

  // Summary bar
  summaryBar: {
    paddingHorizontal: 24,
    marginTop: 12,
  },
  summaryAllClear: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success.light,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  summaryAllClearText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.success.DEFAULT,
    flex: 1,
  },
  summaryRow: {
    flexDirection: 'row',
  },
  summaryPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: COLORS.warning.light,
  },
  summaryPillText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.warning.DEFAULT,
  },

  // Sections
  section: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    letterSpacing: 1,
    marginBottom: 10,
  },
  sectionBody: {
    gap: 10,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginBottom: 4,
  },
  collapsibleCount: {
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
    letterSpacing: 0.5,
  },

  // Item card
  itemCard: { marginBottom: 0 },
  itemCardDimmed: { opacity: 0.7 },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flexShrink: 1,
  },
  itemRationale: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
    lineHeight: 19,
  },
  itemMeta: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 6,
  },
  missingChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  missingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.accent.DEFAULT + '1A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    maxWidth: '100%',
  },
  missingChipText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.accent.dark,
    fontWeight: FONT_WEIGHTS.medium,
  },
  itemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  categoryChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: COLORS.secondary.DEFAULT + '1A',
  },
  categoryChipText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.secondary.dark,
  },
  guidelineText: {
    fontSize: 11,
    color: COLORS.text.tertiary,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: 2,
  },
  statusPillText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Create Plan button
  createPlanButton: {
    marginTop: 6,
    backgroundColor: COLORS.primary.DEFAULT,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  createPlanButtonDisabled: {
    opacity: 0.6,
  },
  createPlanButtonText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },

  // Empty state
  emptyWrap: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  emptyCta: {
    marginTop: 20,
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 120,
    alignItems: 'center',
  },
  emptyCtaDisabled: {
    opacity: 0.6,
  },
  emptyCtaText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
});
