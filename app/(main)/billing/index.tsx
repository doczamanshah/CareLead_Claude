import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useBillingCases } from '@/hooks/useBilling';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { BillingCaseWithDocCount, BillingCaseStatus } from '@/lib/types/billing';
import { BILLING_STATUS_LABELS } from '@/lib/types/billing';

const STATUS_COLORS: Record<BillingCaseStatus, string> = {
  open: COLORS.accent.dark,
  in_review: COLORS.primary.DEFAULT,
  action_plan: COLORS.tertiary.DEFAULT,
  in_progress: COLORS.secondary.DEFAULT,
  resolved: COLORS.success.DEFAULT,
  closed: COLORS.text.tertiary,
};

function isActive(status: BillingCaseStatus): boolean {
  return status !== 'resolved' && status !== 'closed';
}

type FilterMode = 'active' | 'all';

export default function BillingCasesScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const { data: cases, isLoading, refetch, error } = useBillingCases(activeProfileId);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('active');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const { sorted, activeCount, resolvedCount } = useMemo(() => {
    const list = cases ?? [];
    const filtered = filter === 'active' ? list.filter((c) => isActive(c.status)) : list;
    const sortedList = [...filtered].sort((a, b) => {
      const aActive = isActive(a.status) ? 0 : 1;
      const bActive = isActive(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.last_activity_at.localeCompare(a.last_activity_at);
    });
    return {
      sorted: sortedList,
      activeCount: list.filter((c) => isActive(c.status)).length,
      resolvedCount: list.filter((c) => !isActive(c.status)).length,
    };
  }, [cases, filter]);

  if (isLoading && !refreshing) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={22} color={COLORS.primary.DEFAULT} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Your Bills</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading your bills...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={22} color={COLORS.primary.DEFAULT} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Your Bills</Text>
        </View>
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={36} color={COLORS.text.tertiary} />
          <Text style={styles.errorText}>Couldn't load your bills.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const allEmpty = (cases ?? []).length === 0;

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
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={22} color={COLORS.primary.DEFAULT} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Your Bills</Text>
        </View>

        {/* Filter toggle */}
        {!allEmpty && (
          <View style={styles.filterRow}>
            <FilterChip
              label={`Active${activeCount > 0 ? ` (${activeCount})` : ''}`}
              selected={filter === 'active'}
              onPress={() => setFilter('active')}
            />
            <FilterChip
              label={`All${(cases ?? []).length > 0 ? ` (${(cases ?? []).length})` : ''}`}
              selected={filter === 'all'}
              onPress={() => setFilter('all')}
            />
          </View>
        )}

        {/* Content */}
        <View style={styles.section}>
          {allEmpty ? (
            <Card>
              <View style={styles.emptyContainer}>
                <Ionicons
                  name="receipt-outline"
                  size={48}
                  color={COLORS.text.tertiary}
                  style={styles.emptyIcon}
                />
                <Text style={styles.emptyText}>No bills yet</Text>
                <Text style={styles.emptySubtext}>
                  Track your first bill to catch billing errors and stay on top of what you owe.
                </Text>
                <TouchableOpacity
                  style={styles.emptyCta}
                  onPress={() => router.push('/(main)/billing/create')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.emptyCtaText}>Track a Bill</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ) : sorted.length === 0 ? (
            <Card>
              <View style={styles.emptyContainer}>
                <Ionicons
                  name="checkmark-done-circle-outline"
                  size={40}
                  color={COLORS.success.DEFAULT}
                  style={styles.emptyIcon}
                />
                <Text style={styles.emptyText}>Nothing active</Text>
                <Text style={styles.emptySubtext}>
                  {resolvedCount > 0
                    ? `You have ${resolvedCount} resolved bill${resolvedCount === 1 ? '' : 's'}. Switch to "All" to see them.`
                    : 'Tap + below to track a new bill.'}
                </Text>
              </View>
            </Card>
          ) : (
            sorted.map((billingCase) => (
              <CaseCard
                key={billingCase.id}
                billingCase={billingCase}
                onPress={() => router.push(`/(main)/billing/${billingCase.id}`)}
              />
            ))
          )}
        </View>
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(main)/billing/create')}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.filterChip, selected && styles.filterChipSelected]}
    >
      <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function CaseCard({
  billingCase,
  onPress,
}: {
  billingCase: BillingCaseWithDocCount;
  onPress: () => void;
}) {
  const statusColor = STATUS_COLORS[billingCase.status];
  const dimmed = !isActive(billingCase.status);

  const serviceDate = billingCase.service_date_start
    ? formatShortDate(billingCase.service_date_start)
    : null;

  // Key number, big and clear — matches the tone of the case detail view.
  const keyNumber = (() => {
    if (billingCase.status === 'resolved' || billingCase.status === 'closed') {
      return billingCase.total_paid > 0
        ? `Resolved — Paid $${billingCase.total_paid.toFixed(2)}`
        : 'Resolved';
    }
    if (billingCase.unresolved_findings_count > 0) {
      return 'Needs attention';
    }
    if (billingCase.total_patient_responsibility == null) {
      return 'Processing…';
    }
    const remaining =
      billingCase.total_patient_responsibility - billingCase.total_paid;
    if (remaining <= 0.01) {
      return 'Paid in full';
    }
    return `You owe: $${remaining.toFixed(2)}`;
  })();

  // Subtle stage icon derived from status
  const stageIcon = stageIconFor(billingCase);

  return (
    <Card style={dimmed ? { ...styles.caseCard, ...styles.caseCardDimmed } : styles.caseCard} onPress={onPress}>
      <View style={styles.caseRow}>
        <View style={styles.caseInfo}>
          <View style={styles.caseTitleRow}>
            <Ionicons
              name={stageIcon.name}
              size={14}
              color={COLORS.text.tertiary}
            />
            <Text style={styles.caseTitle} numberOfLines={2}>
              {billingCase.provider_name ?? billingCase.title}
            </Text>
          </View>
          {serviceDate && (
            <Text style={styles.caseDetail} numberOfLines={1}>
              {serviceDate}
            </Text>
          )}
          <Text style={styles.caseAmount}>{keyNumber}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusColor + '20' }]}>
          <Text style={[styles.statusPillText, { color: statusColor }]}>
            {BILLING_STATUS_LABELS[billingCase.status]}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function stageIconFor(c: BillingCaseWithDocCount): { name: 'hourglass-outline' | 'search-outline' | 'list-outline' | 'checkmark-done-outline' } {
  if (c.status === 'resolved' || c.status === 'closed') {
    return { name: 'checkmark-done-outline' };
  }
  if (c.status === 'in_progress' || c.status === 'action_plan') {
    return { name: 'list-outline' };
  }
  if (c.status === 'in_review') {
    return { name: 'search-outline' };
  }
  return { name: 'hourglass-outline' };
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
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
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },

  // Filter
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 24,
    marginTop: 12,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  filterChipSelected: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
    borderColor: COLORS.primary.DEFAULT,
  },
  filterChipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  filterChipTextSelected: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  section: {
    paddingHorizontal: 24,
    marginTop: 16,
  },

  // Empty state
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  emptyCta: {
    marginTop: 20,
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyCtaText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },

  // Case card
  caseCard: { marginBottom: 8 },
  caseCardDimmed: { opacity: 0.65 },
  caseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  caseInfo: { flex: 1, marginRight: 12 },
  caseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  caseTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flexShrink: 1,
  },
  caseDetail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  caseAmount: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginTop: 6,
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

  // FAB
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    fontSize: FONT_SIZES['2xl'],
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.bold,
    marginTop: -2,
  },
});
