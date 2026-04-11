import { useState, useCallback } from 'react';
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

export default function BillingCasesScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const { data: cases, isLoading, refetch } = useBillingCases(activeProfileId);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const activeCases = (cases ?? []).filter((c) => c.status !== 'closed' && c.status !== 'resolved');
  const closedCases = (cases ?? []).filter((c) => c.status === 'closed' || c.status === 'resolved');
  const [showClosed, setShowClosed] = useState(false);

  if (isLoading && !refreshing) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading billing cases...</Text>
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
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Bills & EOBs</Text>
        </View>

        {/* Active Cases */}
        <View style={styles.section}>
          {activeCases.length === 0 && closedCases.length === 0 ? (
            <Card>
              <View style={styles.emptyContainer}>
                <Ionicons
                  name="receipt-outline"
                  size={48}
                  color={COLORS.text.tertiary}
                  style={styles.emptyIcon}
                />
                <Text style={styles.emptyText}>No billing cases yet</Text>
                <Text style={styles.emptySubtext}>
                  Create a case to start tracking a bill, EOB, or insurance claim.
                </Text>
                <TouchableOpacity
                  style={styles.emptyCta}
                  onPress={() => router.push('/(main)/billing/create')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.emptyCtaText}>Start a Case</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ) : (
            <>
              {activeCases.length > 0 && (
                <Text style={styles.sectionTitle}>Active Cases</Text>
              )}
              {activeCases.map((billingCase) => (
                <CaseCard
                  key={billingCase.id}
                  billingCase={billingCase}
                  onPress={() => router.push(`/(main)/billing/${billingCase.id}`)}
                />
              ))}
            </>
          )}
        </View>

        {/* Closed Cases */}
        {closedCases.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              onPress={() => setShowClosed(!showClosed)}
              style={styles.toggleRow}
            >
              <Text style={styles.toggleText}>
                {showClosed ? 'Hide' : 'Show'} resolved/closed ({closedCases.length})
              </Text>
            </TouchableOpacity>
            {showClosed &&
              closedCases.map((billingCase) => (
                <CaseCard
                  key={billingCase.id}
                  billingCase={billingCase}
                  onPress={() => router.push(`/(main)/billing/${billingCase.id}`)}
                />
              ))}
          </View>
        )}
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

function CaseCard({
  billingCase,
  onPress,
}: {
  billingCase: BillingCaseWithDocCount;
  onPress: () => void;
}) {
  const statusColor = STATUS_COLORS[billingCase.status];

  const serviceDates = billingCase.service_date_start
    ? billingCase.service_date_end && billingCase.service_date_end !== billingCase.service_date_start
      ? `${formatShortDate(billingCase.service_date_start)} - ${formatShortDate(billingCase.service_date_end)}`
      : formatShortDate(billingCase.service_date_start)
    : null;

  const details = [
    billingCase.provider_name,
    billingCase.payer_name,
    serviceDates,
  ].filter(Boolean);

  return (
    <Card style={styles.caseCard} onPress={onPress}>
      <View style={styles.caseRow}>
        <View style={styles.caseInfo}>
          <Text style={styles.caseTitle} numberOfLines={2}>
            {billingCase.title}
          </Text>
          {details.length > 0 && (
            <Text style={styles.caseDetail} numberOfLines={1}>
              {details.join(' · ')}
            </Text>
          )}
          <View style={styles.caseMeta}>
            {billingCase.total_patient_responsibility != null && (
              <Text style={styles.caseAmount}>
                ${billingCase.total_patient_responsibility.toFixed(2)}
              </Text>
            )}
            <Text style={styles.caseDocCount}>
              <Ionicons name="document-text-outline" size={12} color={COLORS.text.tertiary} />
              {' '}{billingCase.document_count} doc{billingCase.document_count !== 1 ? 's' : ''}
            </Text>
          </View>
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
  },
  loadingText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backButton: {
    marginBottom: 8,
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
  section: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
  },
  toggleRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
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
  caseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  caseInfo: { flex: 1, marginRight: 12 },
  caseTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  caseDetail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  caseMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 12,
  },
  caseAmount: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  caseDocCount: {
    fontSize: FONT_SIZES.xs,
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
