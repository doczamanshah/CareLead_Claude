import { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAuth } from '@/hooks/useAuth';
import { useTasks } from '@/hooks/useTasks';
import { useAppointments } from '@/hooks/useAppointments';
import { useTodaysDoses, useRefillStatus, useMedications } from '@/hooks/useMedications';
import { useArtifacts } from '@/hooks/useArtifacts';
import {
  useBillingCases,
  useBillingBriefing,
  useBillingActiveCriticalCount,
} from '@/hooks/useBilling';
import { useResults, useResultsBriefing } from '@/hooks/useResults';
import { usePreventiveItems, usePreventiveBriefing } from '@/hooks/usePreventive';
import type { BillingBriefingItem } from '@/services/billingBriefing';
import type { ResultsBriefingItem } from '@/services/resultsBriefing';
import type { PreventiveBriefingItem } from '@/services/preventiveBriefing';
import { needsMedicationMigration, migrateMedicationFacts } from '@/services/medicationMigration';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { Task } from '@/lib/types/tasks';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false;
  return new Date(task.due_date) < new Date();
}

function isDueToday(task: Task): boolean {
  if (!task.due_date) return false;
  const due = new Date(task.due_date);
  const now = new Date();
  return (
    due.getDate() === now.getDate() &&
    due.getMonth() === now.getMonth() &&
    due.getFullYear() === now.getFullYear()
  );
}

const QUICK_ACTIONS = [
  { key: 'camera', icon: 'camera' as const, label: 'Take Photo', route: '/(main)/capture/camera' },
  { key: 'document', icon: 'document-text' as const, label: 'Add Document', route: '/(main)/capture/upload' },
  { key: 'voice', icon: 'mic' as const, label: 'Voice Note', route: '/(main)/capture/voice' },
  { key: 'task', icon: 'checkmark-circle' as const, label: 'New Task', route: '/(main)/tasks/create' },
  { key: 'appointment', icon: 'calendar' as const, label: 'New Appt', route: '/(main)/appointments/create' },
];

const MODULE_CARDS = [
  { key: 'ask', icon: 'chatbubble-ellipses-outline' as const, label: 'Ask', route: '/(main)/ask' },
  { key: 'medications', icon: 'medkit' as const, label: 'Meds', route: '/(main)/medications' },
  { key: 'appointments', icon: 'calendar' as const, label: 'Appts', route: '/(main)/appointments' },
  { key: 'results', icon: 'flask-outline' as const, label: 'Results', route: '/(main)/results' },
  { key: 'billing', icon: 'receipt' as const, label: 'Bills', route: '/(main)/billing' },
  { key: 'preventive', icon: 'shield-checkmark-outline' as const, label: 'Preventive', route: '/(main)/preventive' },
  { key: 'caregivers', icon: 'people' as const, label: 'Care Team', route: '/(main)/caregivers' },
  { key: 'documents', icon: 'document-text' as const, label: 'Docs', route: '/(main)/(tabs)/documents' },
];

export default function HomeScreen() {
  const { activeProfile, activeProfileId, profiles, switchProfile } = useActiveProfile();
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Data fetching
  const { data: medications } = useMedications(activeProfileId);
  const { data: openTasks } = useTasks(activeProfileId, { status: ['pending', 'in_progress'] });
  const { data: allAppointments } = useAppointments(activeProfileId);
  const { data: todaysDoses } = useTodaysDoses(activeProfileId);
  const { data: artifacts } = useArtifacts(activeProfileId ?? undefined);
  const { data: billingCases } = useBillingCases(activeProfileId);
  const { data: billingBriefing } = useBillingBriefing(activeProfileId, 3);
  const { data: billingCriticalCount } = useBillingActiveCriticalCount(activeProfileId);
  const { data: results } = useResults(activeProfileId);
  const { data: resultsBriefing } = useResultsBriefing(activeProfileId, 2);
  const { data: preventiveItems } = usePreventiveItems(activeProfileId);
  const { data: preventiveBriefing } = usePreventiveBriefing(activeProfileId, 2);

  // Auto-migrate medication profile_facts → med_medications on first load
  const migrationRanRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeProfileId || !user?.id) return;
    if (migrationRanRef.current === activeProfileId) return;

    let cancelled = false;
    (async () => {
      const needed = await needsMedicationMigration(activeProfileId);
      if (cancelled || !needed) return;
      migrationRanRef.current = activeProfileId;
      const result = await migrateMedicationFacts(activeProfileId, user.id);
      if (!cancelled && result.success && result.data.migrated > 0) {
        queryClient.invalidateQueries({ queryKey: ['medications'] });
      }
    })();
    return () => { cancelled = true; };
  }, [activeProfileId, user?.id, queryClient]);

  // Briefing data
  const briefing = useMemo(() => {
    const nowIso = new Date().toISOString();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);
    const tomorrowIso = tomorrow.toISOString();

    // Medications
    const scheduled = (todaysDoses ?? []).filter((d) => !d.medication.prn_flag);
    const takenCount = scheduled.filter((d) => d.adherenceToday === 'taken').length;
    const hasMeds = scheduled.length > 0;

    // Appointments today/tomorrow
    const upcomingSoon = (allAppointments ?? []).filter(
      (a) =>
        (a.status === 'scheduled' || a.status === 'preparing' || a.status === 'ready') &&
        a.start_time >= nowIso &&
        a.start_time <= tomorrowIso,
    );
    const nextAppointment = upcomingSoon.length > 0 ? upcomingSoon[0] : null;

    // Tasks
    const activeTasks = (openTasks ?? []).filter((t) => t.dependency_status !== 'blocked');
    const overdue = activeTasks.filter(isOverdue);
    const dueToday = activeTasks.filter((t) => isDueToday(t) && !isOverdue(t));
    const tasksDueCount = dueToday.length;
    const overdueCount = overdue.length;

    // Attention items (closeout prompts for past appointments)
    const needsCloseout = (allAppointments ?? []).filter(
      (a) =>
        (a.status === 'scheduled' || a.status === 'preparing' || a.status === 'ready') &&
        a.start_time < nowIso,
    );
    const attentionCount = needsCloseout.length;

    const billingItems: BillingBriefingItem[] = billingBriefing ?? [];
    const resultsItems: ResultsBriefingItem[] = resultsBriefing ?? [];
    const preventiveItems: PreventiveBriefingItem[] = preventiveBriefing ?? [];

    const nothingDue =
      !hasMeds &&
      !nextAppointment &&
      tasksDueCount === 0 &&
      overdueCount === 0 &&
      attentionCount === 0 &&
      billingItems.length === 0 &&
      resultsItems.length === 0 &&
      preventiveItems.length === 0;

    const briefingLineCount =
      (hasMeds ? 1 : 0) +
      (nextAppointment ? 1 : 0) +
      (tasksDueCount > 0 || overdueCount > 0 ? 1 : 0) +
      (attentionCount > 0 ? 1 : 0) +
      billingItems.length +
      resultsItems.length +
      preventiveItems.length;

    return {
      hasMeds,
      medTotal: scheduled.length,
      medTaken: takenCount,
      nextAppointment,
      tasksDueCount,
      overdueCount,
      attentionCount,
      billingItems,
      resultsItems,
      preventiveItems,
      nothingDue,
      briefingLineCount,
    };
  }, [todaysDoses, allAppointments, openTasks, billingBriefing, resultsBriefing, preventiveBriefing]);

  // Module stats
  const moduleStats = useMemo(() => {
    const medCount = (medications ?? []).filter((m) => m.status === 'active').length;
    const nowIso = new Date().toISOString();
    const upcomingApts = (allAppointments ?? []).filter(
      (a) => (a.status === 'scheduled' || a.status === 'preparing' || a.status === 'ready') && a.start_time >= nowIso,
    ).length;
    const docCount = (artifacts ?? []).length;
    const activeBillingCount = (billingCases ?? []).filter(
      (c) => c.status !== 'resolved' && c.status !== 'closed',
    ).length;
    const resultsCount = (results ?? []).filter((r) => r.status !== 'archived').length;
    const preventiveDueCount = (preventiveItems ?? []).filter(
      (p) => p.status === 'due' || p.status === 'due_soon',
    ).length;
    const preventiveHasItems = (preventiveItems ?? []).length > 0;

    return {
      ask: 'Ask about your health profile',
      medications: medCount > 0 ? `${medCount} active` : 'None yet',
      appointments: upcomingApts > 0 ? `${upcomingApts} upcoming` : 'None yet',
      results: resultsCount > 0 ? `${resultsCount} saved` : 'None yet',
      billing: activeBillingCount > 0 ? `${activeBillingCount} active` : 'None yet',
      preventive:
        preventiveDueCount > 0
          ? `${preventiveDueCount} due`
          : preventiveHasItems
          ? 'All up to date'
          : 'Run check',
      caregivers: 'Manage',
      documents: docCount > 0 ? `${docCount} saved` : 'None yet',
    };
  }, [medications, allAppointments, artifacts, billingCases, results, preventiveItems]);

  const preventiveDueCount = useMemo(
    () =>
      (preventiveItems ?? []).filter(
        (p) => p.status === 'due' || p.status === 'due_soon',
      ).length,
    [preventiveItems],
  );

  const preventiveAllUpToDate = useMemo(
    () => (preventiveItems ?? []).length > 0 && preventiveDueCount === 0,
    [preventiveItems, preventiveDueCount],
  );

  const resultsNeedsReviewCount = useMemo(
    () => (results ?? []).filter((r) => r.status === 'needs_review').length,
    [results],
  );

  const todayDateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ZONE 1: HERO HEADER + PROFILE SWITCHER */}
        <LinearGradient
          colors={[COLORS.primary.DEFAULT, COLORS.primary.light, COLORS.secondary.dark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerGradient}
        >
          <Text style={styles.greeting}>{getGreeting()}</Text>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.profileButton}
            onPress={() => {
              if (activeProfileId) {
                router.push(`/(main)/profile/${activeProfileId}`);
              }
            }}
          >
            <Text style={styles.profileName}>
              {activeProfile?.display_name ?? 'User'}
            </Text>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
          <Text style={styles.tagline}>Your care. In your hands.</Text>

          {/* Profile Switcher Avatars — inside gradient */}
          {profiles.length > 1 && (
            <View style={styles.profileSwitcher}>
              {profiles.map((profile) => {
                const isActive = profile.id === activeProfileId;
                return (
                  <TouchableOpacity
                    key={profile.id}
                    style={[
                      styles.switcherAvatar,
                      isActive && styles.switcherAvatarActive,
                    ]}
                    onPress={() => {
                      if (isActive) {
                        router.push(`/(main)/profile/${activeProfileId}`);
                      } else {
                        switchProfile(profile.id);
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.switcherInitials,
                        !isActive && styles.switcherInitialsInactive,
                      ]}
                    >
                      {getInitials(profile.display_name)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </LinearGradient>

        <View style={styles.body}>
          {/* ZONE 2: TODAY'S BRIEFING CARD */}
          <View style={styles.zone}>
            <TouchableOpacity
              style={styles.briefingCard}
              activeOpacity={0.7}
              onPress={() => router.push('/(main)/today')}
            >
              <View style={styles.briefingAccent} />
              <View style={styles.briefingContent}>
                <View style={styles.briefingHeader}>
                  <Text style={styles.briefingTitle}>Today's Briefing</Text>
                  <Text style={styles.briefingDate}>{todayDateStr}</Text>
                </View>

                {briefing.nothingDue ? (
                  <>
                    <View style={styles.briefingAllClear}>
                      <Ionicons name="checkmark-circle" size={24} color={COLORS.success.DEFAULT} />
                      <Text style={styles.briefingAllClearText}>
                        All caught up — nothing due today
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.briefingAskPrompt}
                      activeOpacity={0.7}
                      onPress={(e) => {
                        e.stopPropagation?.();
                        router.push('/(main)/ask');
                      }}
                    >
                      <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={16}
                        color={COLORS.primary.DEFAULT}
                      />
                      <Text style={styles.briefingAskPromptText}>
                        Need something? Ask CareLead anything about your profile.
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={styles.briefingLines}>
                    {briefing.hasMeds && (
                      <View style={styles.briefingLine}>
                        <Ionicons name="medical" size={18} color={COLORS.primary.DEFAULT} />
                        <Text style={styles.briefingLineText}>
                          {briefing.medTotal} medications due ({briefing.medTaken} taken)
                        </Text>
                      </View>
                    )}
                    {briefing.nextAppointment && (
                      <View style={styles.briefingLine}>
                        <Ionicons name="calendar" size={18} color={COLORS.primary.DEFAULT} />
                        <Text style={styles.briefingLineText} numberOfLines={1}>
                          {briefing.nextAppointment.provider_name
                            ? `Appointment with ${briefing.nextAppointment.provider_name}`
                            : briefing.nextAppointment.title}
                          {' at '}
                          {new Date(briefing.nextAppointment.start_time).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </Text>
                      </View>
                    )}
                    {(briefing.tasksDueCount > 0 || briefing.overdueCount > 0) && (
                      <View style={styles.briefingLine}>
                        <Ionicons
                          name={briefing.overdueCount > 0 ? 'warning' : 'checkmark-circle'}
                          size={18}
                          color={briefing.overdueCount > 0 ? COLORS.error.DEFAULT : COLORS.primary.DEFAULT}
                        />
                        <Text
                          style={[
                            styles.briefingLineText,
                            briefing.overdueCount > 0 && styles.briefingLineTextWarning,
                          ]}
                        >
                          {briefing.overdueCount > 0
                            ? `${briefing.overdueCount} overdue`
                            : `${briefing.tasksDueCount} tasks due today`}
                        </Text>
                      </View>
                    )}
                    {briefing.attentionCount > 0 && (
                      <View style={styles.briefingLine}>
                        <Ionicons name="notifications" size={18} color={COLORS.accent.dark} />
                        <Text style={styles.briefingLineText}>
                          {briefing.attentionCount} {briefing.attentionCount === 1 ? 'item needs' : 'items need'} your review
                        </Text>
                      </View>
                    )}
                    {briefing.billingItems.map((item) => {
                      const isCritical = item.color === 'critical';
                      const iconColor = isCritical
                        ? COLORS.error.DEFAULT
                        : item.color === 'warning'
                        ? COLORS.accent.dark
                        : COLORS.primary.DEFAULT;
                      return (
                        <TouchableOpacity
                          key={item.key}
                          style={styles.briefingLine}
                          activeOpacity={0.7}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            router.push(`/(main)/billing/${item.caseId}`);
                          }}
                        >
                          <Ionicons
                            name={item.icon as keyof typeof Ionicons.glyphMap}
                            size={18}
                            color={iconColor}
                          />
                          <Text
                            style={[
                              styles.briefingLineText,
                              isCritical && styles.briefingLineTextWarning,
                            ]}
                            numberOfLines={2}
                          >
                            {item.message}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    {briefing.resultsItems.map((item) => {
                      const iconColor =
                        item.color === 'warning'
                          ? COLORS.accent.dark
                          : item.color === 'info'
                          ? COLORS.primary.DEFAULT
                          : COLORS.primary.DEFAULT;
                      const destination = item.resultId
                        ? `/(main)/results/${item.resultId}`
                        : '/(main)/results';
                      return (
                        <TouchableOpacity
                          key={item.key}
                          style={styles.briefingLine}
                          activeOpacity={0.7}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            router.push(destination);
                          }}
                        >
                          <Ionicons
                            name={item.icon as keyof typeof Ionicons.glyphMap}
                            size={18}
                            color={iconColor}
                          />
                          <Text style={styles.briefingLineText} numberOfLines={2}>
                            {item.message}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    {briefing.preventiveItems.map((item) => {
                      const isCritical = item.color === 'critical';
                      const iconColor =
                        item.color === 'critical'
                          ? COLORS.error.DEFAULT
                          : item.color === 'warning'
                          ? COLORS.accent.dark
                          : item.color === 'success'
                          ? COLORS.success.DEFAULT
                          : COLORS.primary.DEFAULT;
                      const destination = item.itemId
                        ? `/(main)/preventive/${item.itemId}`
                        : '/(main)/preventive';
                      return (
                        <TouchableOpacity
                          key={item.key}
                          style={styles.briefingLine}
                          activeOpacity={0.7}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            router.push(destination);
                          }}
                        >
                          <Ionicons
                            name={item.icon as keyof typeof Ionicons.glyphMap}
                            size={18}
                            color={iconColor}
                          />
                          <Text
                            style={[
                              styles.briefingLineText,
                              isCritical && styles.briefingLineTextWarning,
                            ]}
                            numberOfLines={2}
                          >
                            {item.message}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    {briefing.briefingLineCount < 3 && (
                      <TouchableOpacity
                        style={styles.briefingAskPrompt}
                        activeOpacity={0.7}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          router.push('/(main)/ask');
                        }}
                      >
                        <Ionicons
                          name="chatbubble-ellipses-outline"
                          size={16}
                          color={COLORS.primary.DEFAULT}
                        />
                        <Text style={styles.briefingAskPromptText}>
                          Need something? Ask CareLead anything about your profile.
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                <View style={styles.briefingFooter}>
                  <Text style={styles.briefingFooterText}>View details</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.primary.DEFAULT} />
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* ZONE 3: QUICK ACTIONS */}
          <View style={styles.zone}>
            <Text style={styles.sectionTitle}>QUICK ACTIONS</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickActionsContent}
            >
              {QUICK_ACTIONS.map((action) => (
                <TouchableOpacity
                  key={action.key}
                  style={styles.quickActionCard}
                  activeOpacity={0.7}
                  onPress={() => router.push(action.route as string)}
                >
                  <View style={styles.quickActionIconWrap}>
                    <Ionicons name={action.icon} size={24} color={COLORS.primary.DEFAULT} />
                  </View>
                  <Text style={styles.quickActionLabel}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* ZONE 4: MODULE SHORTCUTS */}
          <View style={styles.zone}>
            <Text style={styles.sectionTitle}>YOUR CARE</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.modulesContent}
            >
              {MODULE_CARDS.map((mod) => {
                const badgeCount =
                  mod.key === 'billing'
                    ? billingCriticalCount ?? 0
                    : mod.key === 'results'
                    ? resultsNeedsReviewCount
                    : mod.key === 'preventive'
                    ? preventiveDueCount
                    : 0;
                const showBadge = badgeCount > 0;
                const statColor =
                  mod.key === 'preventive' && preventiveAllUpToDate
                    ? COLORS.success.DEFAULT
                    : mod.key === 'preventive' && preventiveDueCount > 0
                    ? COLORS.error.DEFAULT
                    : COLORS.text.secondary;
                return (
                  <TouchableOpacity
                    key={mod.key}
                    style={styles.moduleCard}
                    activeOpacity={0.7}
                    onPress={() => router.push(mod.route as string)}
                  >
                    <View style={styles.moduleIconRow}>
                      <Ionicons name={mod.icon} size={22} color={COLORS.primary.DEFAULT} />
                      {showBadge && (
                        <View style={styles.moduleBadge}>
                          <Text style={styles.moduleBadgeText}>{badgeCount}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.moduleLabel}>{mod.label}</Text>
                    <Text
                      style={[styles.moduleStat, { color: statColor }]}
                      numberOfLines={2}
                    >
                      {moduleStats[mod.key as keyof typeof moduleStats]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </ScrollView>

      {/* Floating Ask FAB */}
      <TouchableOpacity
        style={styles.askFab}
        activeOpacity={0.85}
        onPress={() => router.push('/(main)/ask')}
        accessibilityLabel="Ask CareLead"
      >
        <Ionicons name="chatbubble-ellipses" size={26} color="#FFFFFF" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 8,
  elevation: 3,
} as const;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },

  // ZONE 1: Hero Header
  headerGradient: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 30,
    alignItems: 'center',
  },
  greeting: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 10,
    textAlign: 'center',
  },
  profileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  profileName: {
    fontSize: FONT_SIZES['3xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: '#FFFFFF',
  },
  tagline: {
    fontSize: 16,
    color: '#FFFFFF',
    marginTop: 10,
    textAlign: 'center',
    letterSpacing: 0.5,
  },

  // Profile switcher (inside gradient)
  profileSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    gap: 12,
  },
  switcherAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  switcherAvatarActive: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  switcherInitials: {
    fontSize: 15,
    fontWeight: FONT_WEIGHTS.bold,
    color: '#FFFFFF',
  },
  switcherInitialsInactive: {
    opacity: 0.7,
  },

  // Body
  body: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  zone: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },

  // ZONE 2: Briefing card
  briefingCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    flexDirection: 'row',
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  briefingAccent: {
    width: 4,
    backgroundColor: COLORS.secondary.DEFAULT,
  },
  briefingContent: {
    flex: 1,
    padding: 20,
  },
  briefingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  briefingTitle: {
    fontSize: 18,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  briefingDate: {
    fontSize: 13,
    color: COLORS.text.tertiary,
  },
  briefingAllClear: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success.light,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  briefingAllClearText: {
    fontSize: 15,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.success.DEFAULT,
    flex: 1,
  },
  briefingLines: {
    gap: 12,
  },
  briefingLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  briefingLineText: {
    fontSize: 15,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
  briefingLineTextWarning: {
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  briefingAskPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '20',
  },
  briefingAskPromptText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  briefingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 4,
  },
  briefingFooterText: {
    fontSize: 14,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // ZONE 3: Quick actions
  quickActionsContent: {
    gap: 10,
  },
  quickActionCard: {
    width: (SCREEN_WIDTH - 48 - 40) / 5,
    minWidth: 64,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    backgroundColor: COLORS.secondary.DEFAULT + '14',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.secondary.DEFAULT + '20',
    ...CARD_SHADOW,
    shadowOpacity: 0.05,
  },
  quickActionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.primary.DEFAULT + '0A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  quickActionLabel: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },

  // ZONE 4: Module shortcuts
  modulesContent: {
    gap: 10,
  },
  moduleCard: {
    width: (SCREEN_WIDTH - 48 - 30) / 4,
    minWidth: 80,
    backgroundColor: COLORS.secondary.DEFAULT + '14',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.secondary.DEFAULT + '20',
    padding: 14,
    gap: 6,
  },
  moduleIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moduleBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: COLORS.error.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleBadgeText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: FONT_WEIGHTS.bold,
  },
  moduleLabel: {
    fontSize: 14,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  moduleStat: {
    fontSize: 12,
    color: COLORS.text.secondary,
  },

  // Floating Ask FAB
  askFab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
});
