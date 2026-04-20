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
  Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { DatePicker } from '@/components/ui/DatePicker';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAuth } from '@/hooks/useAuth';
import { useProfileStore } from '@/stores/profileStore';
import {
  usePreventiveItems,
  useRunScan,
  useCreateIntentSheet,
  usePreventiveMetrics,
  usePreventiveReport,
  useWellnessBundle,
} from '@/hooks/usePreventive';
import { complianceBand } from '@/services/preventiveMetrics';
import { generatePreventiveIntentSheet } from '@/services/preventiveIntentSheet';
import { updateProfileBasics, fetchUserProfiles } from '@/services/profiles';
import { getDisplayGroup, sortedDisplayGroups } from '@/lib/utils/preventiveDisplayGroup';
import { useWellnessVisitStore } from '@/stores/wellnessVisitStore';
import { WELLNESS_STEPS } from '@/lib/types/wellnessVisit';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  PREVENTIVE_STATUS_LABELS,
  PREVENTIVE_STATUS_COLORS,
} from '@/lib/types/preventive';
import type {
  PreventiveItemWithRule,
  PreventiveStatus,
  PreventiveDisplayGroup,
  PreventiveDisplayGroupKey,
} from '@/lib/types/preventive';

const SCAN_STALENESS_HOURS = 24;

function isUpToDate(status: PreventiveStatus): boolean {
  return status === 'up_to_date' || status === 'completed';
}

function isActionable(status: PreventiveStatus): boolean {
  return status === 'due' || status === 'due_soon' || status === 'needs_review';
}

function formatShortDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function monthLabel(month: number): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[Math.max(0, Math.min(11, month - 1))];
}

function friendlyConditionLabel(triggers: string[]): string {
  if (triggers.length === 0) return 'a chronic condition';
  const primary = triggers[0];
  if (primary.toLowerCase().includes('diabetes')) return 'diabetes management';
  if (primary.toLowerCase().includes('smok') || primary.toLowerCase() === 'tobacco use')
    return 'smoking history';
  if (primary.toLowerCase().includes('heart') || primary.toLowerCase().includes('cardio'))
    return 'heart health';
  if (primary.toLowerCase().includes('ckd') || primary.toLowerCase().includes('kidney'))
    return 'kidney health';
  return primary;
}

function statusOrder(status: PreventiveStatus): number {
  if (status === 'due') return 0;
  if (status === 'due_soon') return 1;
  if (status === 'needs_review') return 2;
  if (status === 'scheduled') return 3;
  if (status === 'up_to_date' || status === 'completed') return 4;
  return 5;
}

interface GroupedItems {
  group: PreventiveDisplayGroup;
  items: PreventiveItemWithRule[];
  actionableCount: number;
  upToDateCount: number;
  overdueCount: number;
}

export default function PreventiveCareScreen() {
  const router = useRouter();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const { user } = useAuth();
  const setProfiles = useProfileStore((s) => s.setProfiles);
  const { data: items, isLoading, refetch, error } = usePreventiveItems(activeProfileId);
  const runScan = useRunScan();
  const createIntentSheet = useCreateIntentSheet();
  const { data: metrics } = usePreventiveMetrics(activeProfileId);
  const { data: wellnessBundle } = useWellnessBundle(activeProfileId);
  const report = usePreventiveReport();
  const [refreshing, setRefreshing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<
    Partial<Record<PreventiveDisplayGroupKey, boolean>>
  >({});

  const autoScanRanRef = useRef<string | null>(null);

  const needsDOB = !activeProfile?.date_of_birth;
  const needsSex = !activeProfile?.gender;
  const demographicsIncomplete = needsDOB || needsSex;

  // Hide archived items from the dashboard — they no longer apply.
  const applicableItems = useMemo(
    () => (items ?? []).filter((i) => i.status !== 'archived'),
    [items],
  );

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

  const handleShareReport = useCallback(async () => {
    if (!activeProfileId || !applicableItems || !activeProfile) return;
    try {
      const result = await report.mutateAsync({
        profileId: activeProfileId,
        profileName: activeProfile.display_name ?? 'Patient',
        items: applicableItems,
      });
      await Share.share({
        message: result.text,
        title: result.title,
      });
    } catch (err) {
      Alert.alert(
        'Could not share report',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  }, [activeProfileId, activeProfile, applicableItems, report]);

  const handleSaveDemographics = useCallback(
    async (dob: Date | null, sex: 'male' | 'female' | null) => {
      if (!activeProfileId || !activeProfile?.household_id || !user?.id) return;
      const updates: { dateOfBirth?: string; gender?: string } = {};
      if (dob) updates.dateOfBirth = dob.toISOString().slice(0, 10);
      if (sex) updates.gender = sex;
      if (Object.keys(updates).length === 0) return;

      const res = await updateProfileBasics(activeProfileId, updates);
      if (!res.success) {
        Alert.alert('Could not save', res.error);
        return;
      }

      // Refresh the profile store so activeProfile picks up the new values.
      const refreshed = await fetchUserProfiles(user.id);
      if (refreshed.success) setProfiles(refreshed.data);

      // Re-run scan — with demographics known, previously-skipped rules
      // are now evaluated and ineligible items are archived.
      runScan.mutate({
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
      });
    },
    [activeProfileId, activeProfile?.household_id, user?.id, setProfiles, runScan],
  );

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

  // Group applicable items by display group, filter empty groups, pre-sort.
  const groupedItems = useMemo<GroupedItems[]>(() => {
    const byGroup = new Map<PreventiveDisplayGroupKey, PreventiveItemWithRule[]>();
    for (const item of applicableItems) {
      const group = getDisplayGroup({
        code: item.rule.code,
        category: item.rule.category,
        condition_triggers: item.rule.condition_triggers,
        is_condition_dependent: item.rule.is_condition_dependent,
      });
      const arr = byGroup.get(group.key) ?? [];
      arr.push(item);
      byGroup.set(group.key, arr);
    }

    const result: GroupedItems[] = [];
    for (const group of sortedDisplayGroups()) {
      const items = byGroup.get(group.key);
      if (!items || items.length === 0) continue; // Hide empty categories

      // Sort items within a group by status urgency, then title.
      const sorted = [...items].sort((a, b) => {
        const d = statusOrder(a.status) - statusOrder(b.status);
        if (d !== 0) return d;
        return a.rule.title.localeCompare(b.rule.title);
      });

      const actionableCount = sorted.filter((i) => isActionable(i.status)).length;
      const upToDateCount = sorted.filter((i) => isUpToDate(i.status)).length;
      const overdueCount = sorted.filter((i) => i.status === 'due').length;

      result.push({
        group,
        items: sorted,
        actionableCount,
        upToDateCount,
        overdueCount,
      });
    }
    return result;
  }, [applicableItems]);

  // Default expansion: expand groups that have actionable items, collapse
  // the rest. Don't overwrite a user's explicit toggle.
  useEffect(() => {
    setExpandedGroups((prior) => {
      const next = { ...prior };
      for (const g of groupedItems) {
        if (next[g.group.key] === undefined) {
          next[g.group.key] = g.actionableCount > 0;
        }
      }
      return next;
    });
  }, [groupedItems]);

  const toggleGroup = useCallback((key: PreventiveDisplayGroupKey) => {
    setExpandedGroups((prior) => ({ ...prior, [key]: !prior[key] }));
  }, []);

  const actionableItems = useMemo(
    () =>
      applicableItems.filter((i) => i.status === 'due' || i.status === 'due_soon'),
    [applicableItems],
  );

  const totalActionable = groupedItems.reduce(
    (acc, g) => acc + g.actionableCount,
    0,
  );
  const isScanning = runScan.isPending;
  const totalItems = applicableItems.length;
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
          onShare={handleShareReport}
          shareDisabled={report.isPending || applicableItems.length === 0}
          scanDisabled={isScanning}
          scanning={isScanning}
        />

        {/* Personalization prompt when demographics incomplete */}
        {demographicsIncomplete && (
          <PersonalizePrompt
            needsDOB={needsDOB}
            needsSex={needsSex}
            currentDOB={activeProfile?.date_of_birth ?? null}
            currentSex={activeProfile?.gender ?? null}
            onSave={handleSaveDemographics}
          />
        )}

        {/* Preventive Health Score (only once demographics are in) */}
        {!demographicsIncomplete && metrics && metrics.totalMeasures > 0 && (
          <HealthScoreCard metrics={metrics} />
        )}

        {/* Wellness visit prep entry card */}
        {!demographicsIncomplete && (
          <WellnessVisitPrepCard
            items={applicableItems}
            onStart={() => router.push('/(main)/preventive/wellness-visit')}
          />
        )}

        {/* Wellness visit agenda */}
        {!demographicsIncomplete && wellnessBundle && wellnessBundle.totalGaps >= 2 && (
          <WellnessAgendaCard bundle={wellnessBundle} />
        )}

        {/* Initial scan indicator */}
        {showInitialScan ? (
          <View style={styles.initialScan}>
            <ActivityIndicator color={COLORS.primary.DEFAULT} />
            <Text style={styles.initialScanText}>
              Checking your preventive care status...
            </Text>
          </View>
        ) : totalItems === 0 && !demographicsIncomplete ? (
          <EmptyState onRunScan={handleManualScan} scanning={isScanning} />
        ) : totalItems === 0 && demographicsIncomplete ? (
          <View style={styles.limitedWrap}>
            <Text style={styles.limitedText}>
              Complete your details above to see personalized recommendations.
            </Text>
          </View>
        ) : (
          <>
            {/* Hint when we could only show age-neutral rules */}
            {demographicsIncomplete && (
              <View style={styles.limitedWrap}>
                <Text style={styles.limitedText}>
                  Some general screenings shown below. Complete your details above for
                  personalized recommendations.
                </Text>
              </View>
            )}

            {/* Top-level summary */}
            <View style={styles.summaryBar}>
              {!demographicsIncomplete && totalActionable === 0 ? (
                <View style={styles.summaryAllClear}>
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={COLORS.success.DEFAULT}
                  />
                  <Text style={styles.summaryAllClearText}>
                    Outstanding! All your screenings are current.
                  </Text>
                </View>
              ) : totalActionable > 0 ? (
                <View style={styles.summaryRow}>
                  <View style={styles.summaryPill}>
                    <Text style={styles.summaryPillText}>
                      {totalActionable} {totalActionable === 1 ? 'screening needs' : 'screenings need'}{' '}
                      attention
                    </Text>
                  </View>
                  {actionableItems.length > 0 && (
                    <TouchableOpacity
                      style={[
                        styles.planButton,
                        createIntentSheet.isPending && styles.planButtonDisabled,
                      ]}
                      onPress={() => handleCreatePlan(actionableItems)}
                      disabled={createIntentSheet.isPending}
                      activeOpacity={0.8}
                    >
                      {createIntentSheet.isPending ? (
                        <ActivityIndicator color={COLORS.text.inverse} size="small" />
                      ) : (
                        <>
                          <Ionicons name="add-circle" size={16} color={COLORS.text.inverse} />
                          <Text style={styles.planButtonText}>Create Plan</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              ) : null}
            </View>

            {/* Categorized groups */}
            {groupedItems.map((g) => (
              <CategorySection
                key={g.group.key}
                grouped={g}
                expanded={expandedGroups[g.group.key] ?? false}
                onToggle={() => toggleGroup(g.group.key)}
                onOpenItem={(id) => router.push(`/(main)/preventive/${id}`)}
              />
            ))}
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
  onShare,
  scanDisabled,
  scanning,
  shareDisabled,
}: {
  onBack: () => void;
  onScan: () => void;
  onAsk: () => void;
  onShare?: () => void;
  scanDisabled: boolean;
  scanning: boolean;
  shareDisabled?: boolean;
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
          {onShare && (
            <TouchableOpacity
              onPress={onShare}
              disabled={!!shareDisabled}
              style={[styles.scanButton, shareDisabled && styles.scanButtonDisabled]}
              activeOpacity={0.7}
              accessibilityLabel="Share preventive care report"
            >
              <Ionicons
                name="share-outline"
                size={20}
                color={COLORS.primary.DEFAULT}
              />
            </TouchableOpacity>
          )}
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

function PersonalizePrompt({
  needsDOB,
  needsSex,
  currentDOB,
  currentSex,
  onSave,
}: {
  needsDOB: boolean;
  needsSex: boolean;
  currentDOB: string | null;
  currentSex: string | null;
  onSave: (dob: Date | null, sex: 'male' | 'female' | null) => Promise<void> | void;
}) {
  const [dob, setDob] = useState<Date | null>(
    currentDOB ? new Date(currentDOB + 'T00:00:00') : null,
  );
  const [sex, setSex] = useState<'male' | 'female' | null>(
    currentSex === 'male' || currentSex === 'female' ? currentSex : null,
  );
  const [saving, setSaving] = useState(false);

  const canSave =
    (needsDOB ? !!dob : true) && (needsSex ? !!sex : true) && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(needsDOB ? dob : null, needsSex ? sex : null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.section}>
      <Card style={promptStyles.card}>
        <View style={promptStyles.headerRow}>
          <Ionicons
            name="sparkles-outline"
            size={20}
            color={COLORS.primary.DEFAULT}
          />
          <Text style={promptStyles.title}>Let's find the right screenings for you</Text>
        </View>
        <Text style={promptStyles.subtitle}>
          We need a couple of details to recommend the right preventive care.
        </Text>

        {needsDOB && (
          <View style={promptStyles.field}>
            <DatePicker
              label="Date of birth"
              value={dob}
              onChange={setDob}
              mode="date"
              maximumDate={new Date()}
              placeholder="Select your date of birth"
            />
          </View>
        )}

        {needsSex && (
          <View style={promptStyles.field}>
            <Text style={promptStyles.fieldLabel}>Sex</Text>
            <View style={promptStyles.sexRow}>
              <TouchableOpacity
                style={[
                  promptStyles.sexButton,
                  sex === 'female' && promptStyles.sexButtonActive,
                ]}
                onPress={() => setSex('female')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    promptStyles.sexButtonText,
                    sex === 'female' && promptStyles.sexButtonTextActive,
                  ]}
                >
                  Female
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  promptStyles.sexButton,
                  sex === 'male' && promptStyles.sexButtonActive,
                ]}
                onPress={() => setSex('male')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    promptStyles.sexButtonText,
                    sex === 'male' && promptStyles.sexButtonTextActive,
                  ]}
                >
                  Male
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave}
          style={[promptStyles.saveButton, !canSave && promptStyles.saveButtonDisabled]}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={COLORS.text.inverse} size="small" />
          ) : (
            <Text style={promptStyles.saveButtonText}>Update</Text>
          )}
        </TouchableOpacity>
      </Card>
    </View>
  );
}

function HealthScoreCard({
  metrics,
}: {
  metrics: import('@/lib/types/preventive').PreventiveMetrics;
}) {
  const band = complianceBand(metrics.complianceRate);
  const bandColor =
    band === 'green'
      ? COLORS.success.DEFAULT
      : band === 'amber'
      ? COLORS.warning.DEFAULT
      : COLORS.error.DEFAULT;

  const categoryEntries = Object.entries(metrics.byCategory).filter(
    ([, stat]) => stat.total > 0,
  );

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>YOUR PREVENTIVE HEALTH SCORE</Text>
      <Card>
        <View style={scoreStyles.topRow}>
          <View style={scoreStyles.scoreCircle}>
            <Text style={[scoreStyles.scoreValue, { color: bandColor }]}>
              {metrics.complianceRate}%
            </Text>
          </View>
          <View style={scoreStyles.scoreText}>
            <Text style={scoreStyles.scoreHeadline}>
              {metrics.upToDate} of {metrics.totalMeasures} screenings current
            </Text>
            {metrics.gapsClosed30Days > 0 ? (
              <Text style={scoreStyles.scoreSub}>
                {metrics.gapsClosed30Days} closed in the last 30 days — keep going!
              </Text>
            ) : metrics.gaps > 0 ? (
              <Text style={scoreStyles.scoreSub}>
                {metrics.gaps} {metrics.gaps === 1 ? 'gap' : 'gaps'} to close when you're ready.
              </Text>
            ) : (
              <Text style={scoreStyles.scoreSub}>Nothing outstanding. Great job.</Text>
            )}
          </View>
        </View>

        {categoryEntries.length > 0 && (
          <View style={scoreStyles.categoryRow}>
            {categoryEntries.map(([label, stat]) => (
              <View key={label} style={scoreStyles.categoryChipScore}>
                <Text style={scoreStyles.categoryChipLabel}>{label}</Text>
                <Text style={scoreStyles.categoryChipStat}>
                  {stat.upToDate}/{stat.total}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

function WellnessAgendaCard({
  bundle,
}: {
  bundle: import('@/lib/types/preventive').WellnessBundle;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>WELLNESS VISIT AGENDA</Text>
      <Card>
        <Text style={scoreStyles.wellnessHeadline}>
          {bundle.totalGaps} {bundle.totalGaps === 1 ? 'item' : 'items'} to bring up at your next wellness visit
        </Text>
        {bundle.canCloseAtVisit.length > 0 && (
          <View style={scoreStyles.wellnessSubsection}>
            <Text style={scoreStyles.wellnessSubtitle}>Can close at the visit</Text>
            {bundle.canCloseAtVisit.map((it) => (
              <Text key={it.id} style={scoreStyles.wellnessLine}>
                • {it.rule.title}
              </Text>
            ))}
          </View>
        )}
        {bundle.needsSeparateScheduling.length > 0 && (
          <View style={scoreStyles.wellnessSubsection}>
            <Text style={scoreStyles.wellnessSubtitle}>Needs separate scheduling</Text>
            {bundle.needsSeparateScheduling.map((it) => (
              <Text key={it.id} style={scoreStyles.wellnessLine}>
                • {it.rule.title}
              </Text>
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

function CategorySection({
  grouped,
  expanded,
  onToggle,
  onOpenItem,
}: {
  grouped: GroupedItems;
  expanded: boolean;
  onToggle: () => void;
  onOpenItem: (id: string) => void;
}) {
  const { group, items, actionableCount, upToDateCount, overdueCount } = grouped;

  // Badge intent: red if any overdue; amber if any actionable; green if all current.
  let badgeBg: string = COLORS.success.light;
  let badgeColor: string = COLORS.success.DEFAULT;
  let badgeText = 'All current';
  if (overdueCount > 0) {
    badgeBg = COLORS.error.light;
    badgeColor = COLORS.error.DEFAULT;
    badgeText = `${overdueCount} overdue`;
  } else if (actionableCount > 0) {
    badgeBg = COLORS.warning.light;
    badgeColor = COLORS.warning.DEFAULT;
    badgeText =
      actionableCount === 1 ? '1 gap' : `${actionableCount} gaps`;
  } else {
    badgeText = `${upToDateCount} of ${items.length} current`;
  }

  return (
    <View style={styles.section}>
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        style={groupStyles.header}
      >
        <View style={groupStyles.headerLeft}>
          <View style={groupStyles.iconBubble}>
            <Ionicons
              name={group.icon as keyof typeof Ionicons.glyphMap}
              size={18}
              color={COLORS.primary.DEFAULT}
            />
          </View>
          <Text style={groupStyles.headerTitle}>{group.label}</Text>
        </View>
        <View style={groupStyles.headerRight}>
          <View style={[groupStyles.summaryBadge, { backgroundColor: badgeBg }]}>
            <Text style={[groupStyles.summaryBadgeText, { color: badgeColor }]}>
              {badgeText}
            </Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={COLORS.text.tertiary}
          />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.sectionBody}>
          {items.map((item) => (
            <PreventiveItemCard
              key={item.id}
              item={item}
              onPress={() => onOpenItem(item.id)}
            />
          ))}
        </View>
      )}
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

          {upToDate && (lastDone || nextDue) && (
            <Text style={styles.itemMeta}>
              {(() => {
                const methods = item.rule.screening_methods ?? null;
                const method =
                  methods && item.selected_method
                    ? methods.find((m) => m.method_id === item.selected_method) ?? null
                    : null;
                const prefix = method ? method.name : lastDone ? 'Last done' : 'Completed';
                const datePart = lastDone
                  ? method
                    ? ` — last done ${lastDone}`
                    : `: ${lastDone}`
                  : '';
                const nextPart = nextDue ? `  ·  Next due: ${nextDue}` : '';
                return `${prefix}${datePart}${nextPart}`;
              })()}
            </Text>
          )}

          {dimmed && item.declined_reason && (
            <Text style={styles.itemMeta} numberOfLines={2}>
              {item.declined_reason}
            </Text>
          )}

          {(item.rule.seasonal_window || (item.rule.is_condition_dependent && item.rule.condition_triggers)) && (
            <View style={styles.badgeRow}>
              {item.rule.seasonal_window && (
                <View style={styles.seasonalBadge}>
                  <Ionicons name="sunny-outline" size={11} color={COLORS.accent.dark} />
                  <Text style={styles.seasonalBadgeText}>
                    {item.rule.seasonal_window.label}: {monthLabel(item.rule.seasonal_window.start_month)}-
                    {monthLabel(item.rule.seasonal_window.end_month)}
                  </Text>
                </View>
              )}
              {item.rule.is_condition_dependent && item.rule.condition_triggers && (
                <View style={styles.conditionBadge}>
                  <Ionicons name="pulse-outline" size={11} color={COLORS.primary.DEFAULT} />
                  <Text style={styles.conditionBadgeText}>
                    For {friendlyConditionLabel(item.rule.condition_triggers)}
                  </Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.itemFooter}>
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
    case 'selected_method':
      return 'Pick a screening type';
    default:
      return 'More info needed';
  }
}

function WellnessVisitPrepCard({
  items,
  onStart,
}: {
  items: PreventiveItemWithRule[];
  onStart: () => void;
}) {
  const hydrated = useWellnessVisitStore((s) => s.hydrated);
  const hydrate = useWellnessVisitStore((s) => s.hydrate);
  const stepsCompleted = useWellnessVisitStore((s) => s.stepsCompleted);
  const packetGenerated = useWellnessVisitStore((s) => s.packetGenerated);
  const freeformLen = useWellnessVisitStore((s) => s.freeformInput.length);
  const selectedCount = useWellnessVisitStore((s) => s.selectedScreenings.length);
  const questionCount = useWellnessVisitStore((s) => s.questions.length);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const completedCount = Object.values(stepsCompleted).filter(Boolean).length;
  const total = WELLNESS_STEPS.length;
  const started =
    completedCount > 0 ||
    freeformLen > 0 ||
    selectedCount > 0 ||
    questionCount > 0;
  const wellnessItem = items.find(
    (i) => i.rule.code === 'annual_wellness_visit',
  );
  const wellnessDue =
    wellnessItem?.status === 'due' ||
    wellnessItem?.status === 'due_soon' ||
    wellnessItem?.status === 'needs_review';

  // Don't show the card if packet is already generated and wellness visit
  // isn't due — prevents lingering UI after the user has finished prep.
  if (!started && !wellnessDue) return null;
  if (packetGenerated && !wellnessDue) return null;

  const headline = started
    ? 'Continue your wellness visit prep'
    : 'Time for your annual wellness visit';
  const body = started
    ? `${completedCount} of ${total} steps done. Pick up where you left off.`
    : 'Prepare now to get the most out of it — about 15–20 minutes.';

  return (
    <View style={styles.section}>
      <Card style={wellnessCardStyles.card} onPress={onStart}>
        <View style={wellnessCardStyles.row}>
          <View style={wellnessCardStyles.iconBubble}>
            <Ionicons
              name="clipboard-outline"
              size={22}
              color={COLORS.primary.DEFAULT}
            />
          </View>
          <View style={wellnessCardStyles.body}>
            <Text style={wellnessCardStyles.title}>{headline}</Text>
            <Text style={wellnessCardStyles.subtitle}>{body}</Text>
            {started && (
              <View style={wellnessCardStyles.progressBar}>
                <View
                  style={[
                    wellnessCardStyles.progressFill,
                    { width: `${(completedCount / total) * 100}%` },
                  ]}
                />
              </View>
            )}
          </View>
          <View style={wellnessCardStyles.cta}>
            <Text style={wellnessCardStyles.ctaText}>
              {started ? 'Continue' : 'Start Prep'}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={COLORS.text.inverse}
            />
          </View>
        </View>
      </Card>
    </View>
  );
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

const wellnessCardStyles = StyleSheet.create({
  card: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary.DEFAULT,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBubble: {
    width: 42,
    height: 42,
    borderRadius: 21,
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
    lineHeight: 18,
  },
  progressBar: {
    marginTop: 6,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.surface.muted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary.DEFAULT,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  ctaText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
});

const scoreStyles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  scoreCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    borderColor: COLORS.border.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreValue: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
  },
  scoreText: { flex: 1, gap: 4 },
  scoreHeadline: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  scoreSub: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  categoryChipScore: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: COLORS.surface.muted,
    flexDirection: 'row',
    gap: 6,
  },
  categoryChipLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  categoryChipStat: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  wellnessHeadline: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  wellnessSubsection: { marginTop: 12 },
  wellnessSubtitle: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: COLORS.text.tertiary,
    marginBottom: 4,
  },
  wellnessLine: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
});

const promptStyles = StyleSheet.create({
  card: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary.DEFAULT,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 6,
    lineHeight: 20,
  },
  field: {
    marginTop: 16,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
    marginBottom: 8,
  },
  sexRow: {
    flexDirection: 'row',
    gap: 10,
  },
  sexButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    alignItems: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
  },
  sexButtonActive: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  sexButtonText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  sexButtonTextActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  saveButton: {
    marginTop: 16,
    backgroundColor: COLORS.primary.DEFAULT,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});

const groupStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  headerTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flexShrink: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  summaryBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});

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

  limitedWrap: {
    paddingHorizontal: 24,
    marginTop: 16,
  },
  limitedText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },

  summaryBar: {
    paddingHorizontal: 24,
    marginTop: 16,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
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
  planButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  planButtonDisabled: {
    opacity: 0.6,
  },
  planButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  section: {
    paddingHorizontal: 24,
    marginTop: 16,
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
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  seasonalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.accent.DEFAULT + '1F',
  },
  seasonalBadgeText: {
    fontSize: 11,
    color: COLORS.accent.dark,
    fontWeight: FONT_WEIGHTS.medium,
  },
  conditionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  conditionBadgeText: {
    fontSize: 11,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
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
