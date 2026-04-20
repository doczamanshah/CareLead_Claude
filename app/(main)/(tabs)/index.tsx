import { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
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
import { usePostVisitBriefing } from '@/hooks/usePostVisitCapture';
import { usePreAppointmentBriefing } from '@/hooks/usePreAppointmentCheck';
import {
  useDismissReviewBriefing,
  useProfileReviewDue,
} from '@/hooks/useProfileReview';
import {
  useDataQualityBriefing,
  useDismissDataQualityBriefing,
} from '@/hooks/useDataQuality';
import type { BillingBriefingItem } from '@/services/billingBriefing';
import type { ResultsBriefingItem } from '@/services/resultsBriefing';
import type { PreventiveBriefingItem } from '@/services/preventiveBriefing';
import type { PostVisitBriefingItem } from '@/services/postVisitBriefing';
import type { PreAppointmentBriefingItem } from '@/services/preAppointmentCheck';
import { needsMedicationMigration, migrateMedicationFacts } from '@/services/medicationMigration';
import {
  enableBiometricForUser,
  getBiometricCapability,
  hasBeenPromptedForUser,
  isBiometricEnabledForUser,
  isPinSetForUser,
  markPromptedForUser,
  promptBiometric,
} from '@/services/biometric';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { Task } from '@/lib/types/tasks';
import { LifeEventPromptCard } from '@/components/LifeEventPromptCard';
import { useLifeEventStore } from '@/stores/lifeEventStore';
import { useWellnessVisitStore } from '@/stores/wellnessVisitStore';
import { WELLNESS_STEPS } from '@/lib/types/wellnessVisit';
import { useAddProfileFact, useDeleteProfileFact } from '@/hooks/useProfileDetail';
import type { LifeEventPrompt } from '@/lib/types/lifeEvents';
import {
  useCaregiverEnrichmentPrompts,
  useCaregiverOnboarded,
  useDismissCaregiverPrompt,
  useIsCaregiverForProfile,
} from '@/hooks/useCaregiverEnrichment';
import type { CaregiverEnrichmentPrompt } from '@/lib/types/caregivers';
import { useSmartEnrichment, getMilestone } from '@/hooks/useSmartEnrichment';
import { SmartNudgeCard, MilestoneBadgeCard } from '@/components/SmartNudgeCard';
import { DailyBriefingCard } from '@/components/DailyBriefingCard';
import { buildDailyBriefing } from '@/services/dailyBriefing';
import { usePatientPriorities } from '@/hooks/usePatientPriorities';
import {
  useTaskProgress,
  useStreakCelebration,
  useWeeklySummary,
  dismissWeeklySummary,
  dismissStreakCelebration,
} from '@/hooks/useTaskProgress';

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
  { key: 'catch-up', icon: 'albums' as const, label: 'Catch Up', route: '/(main)/capture/catch-up' },
  { key: 'snap-label', icon: 'camera-outline' as const, label: 'Snap a Label', route: '/(main)/medications/snap-label' },
  { key: 'import-summary', icon: 'cloud-download-outline' as const, label: 'Import Summary', route: '/(main)/capture/import-summary' },
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
  { key: 'billing', icon: 'receipt' as const, label: 'Bills & Insurance', route: '/(main)/billing' },
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

  // Wellness visit prep — briefing card when due or in progress
  const wellnessHydrated = useWellnessVisitStore((s) => s.hydrated);
  const wellnessHydrate = useWellnessVisitStore((s) => s.hydrate);
  const wellnessStepsCompleted = useWellnessVisitStore((s) => s.stepsCompleted);
  const wellnessPacketGenerated = useWellnessVisitStore((s) => s.packetGenerated);
  const wellnessFreeformLen = useWellnessVisitStore((s) => s.freeformInput.length);
  const wellnessSelectedCount = useWellnessVisitStore(
    (s) => s.selectedScreenings.length,
  );
  const wellnessQuestionCount = useWellnessVisitStore((s) => s.questions.length);
  useEffect(() => {
    if (!wellnessHydrated) void wellnessHydrate();
  }, [wellnessHydrated, wellnessHydrate]);
  const { data: postVisitBriefing } = usePostVisitBriefing(activeProfileId, 3);
  const { data: preAppointmentBriefing } = usePreAppointmentBriefing(
    activeProfileId,
    activeProfile?.household_id ?? null,
    2,
  );
  const { data: profileReviewDue } = useProfileReviewDue(activeProfileId);
  const dismissReviewBriefing = useDismissReviewBriefing();
  const dataQualityBriefing = useDataQualityBriefing(
    activeProfileId,
    activeProfile?.household_id ?? null,
  );
  const dismissDataQualityBriefing = useDismissDataQualityBriefing(activeProfileId);

  // Caregiver enrichment — only fires if current user is a caregiver (not owner)
  const { data: isCaregiver } = useIsCaregiverForProfile(activeProfileId);
  const { data: caregiverOnboarded } = useCaregiverOnboarded(activeProfileId);
  const { data: caregiverPrompts } = useCaregiverEnrichmentPrompts(
    isCaregiver ? activeProfileId : null,
    activeProfile?.household_id ?? null,
    2,
  );
  const dismissCaregiverPrompt = useDismissCaregiverPrompt();

  // Smart enrichment — top nudge surfaces in briefing, new milestones celebrate
  const {
    topNudge,
    unseenMilestones,
    dismiss: dismissNudge,
    markSeen: markMilestonesSeen,
  } = useSmartEnrichment(
    activeProfileId,
    activeProfile?.household_id ?? null,
  );

  // Patient priorities + progress — powers the synthesized briefing
  const { data: patientPriorities } = usePatientPriorities(activeProfileId);
  const { data: progressStats } = useTaskProgress(activeProfileId);
  const streakCelebration = useStreakCelebration(progressStats?.streakDays ?? 0);
  const weeklySummary = useWeeklySummary(activeProfileId);

  // First-time caregiver → contribute screen. One-shot per user+profile.
  const caregiverRedirectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isCaregiver || !activeProfileId) return;
    if (caregiverOnboarded !== false) return;
    if (caregiverRedirectRef.current === activeProfileId) return;
    caregiverRedirectRef.current = activeProfileId;
    router.push({
      pathname: '/(main)/caregivers/contribute',
      params: { profileId: activeProfileId },
    } as never);
  }, [isCaregiver, caregiverOnboarded, activeProfileId, router]);

  // Life-event prompts — top queued prompt for the active profile
  const lifeEventPrompts = useLifeEventStore((s) => s.pendingPrompts);
  const dismissLifeEventPrompt = useLifeEventStore((s) => s.dismissPrompt);
  const topLifeEventPrompt = useMemo<LifeEventPrompt | null>(() => {
    if (!activeProfileId) return null;
    return (
      lifeEventPrompts.find((p) => p.profileId === activeProfileId) ?? null
    );
  }, [lifeEventPrompts, activeProfileId]);
  const addProfileFactMutation = useAddProfileFact(activeProfileId ?? '');
  const deleteProfileFactMutation = useDeleteProfileFact(activeProfileId ?? '');

  // One-time biometric enrollment prompt per user on this device
  const biometricPromptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    if (biometricPromptRef.current === user.id) return;
    biometricPromptRef.current = user.id;

    let cancelled = false;
    (async () => {
      const [capability, alreadyEnabled, alreadyPrompted, pinSet] = await Promise.all([
        getBiometricCapability(),
        isBiometricEnabledForUser(user.id),
        hasBeenPromptedForUser(user.id),
        isPinSetForUser(user.id),
      ]);
      if (cancelled) return;
      if (alreadyPrompted) return;
      if (alreadyEnabled || pinSet) return;

      const biometricAvailable = capability.available && capability.enrolled;

      if (biometricAvailable) {
        const label = capability.label;
        Alert.alert(
          `Enable ${label}?`,
          `Use ${label} to quickly unlock CareLead and keep your health information secure.`,
          [
            {
              text: 'Not now',
              style: 'cancel',
              onPress: () => {
                markPromptedForUser(user.id);
              },
            },
            {
              text: 'Enable',
              onPress: async () => {
                const result = await promptBiometric(`Enable ${label} for CareLead`);
                if (result.success) {
                  await enableBiometricForUser(user.id);
                } else if (result.error && result.error !== 'user_cancel' && result.error !== 'cancelled') {
                  Alert.alert(
                    `Could not enable ${label}`,
                    `Error: ${result.error}\n\nYou can try again later from Settings.`,
                  );
                }
                await markPromptedForUser(user.id);
              },
            },
          ],
        );
        return;
      }

      // No biometrics available — offer to set a PIN instead.
      Alert.alert(
        'Set a PIN?',
        'Set a 4-digit PIN to protect your health information.',
        [
          {
            text: 'Not now',
            style: 'cancel',
            onPress: () => {
              markPromptedForUser(user.id);
            },
          },
          {
            text: 'Set PIN',
            onPress: async () => {
              await markPromptedForUser(user.id);
              router.push('/(auth)/setup-pin');
            },
          },
        ],
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, router]);

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
    const preventiveItemsBriefing: PreventiveBriefingItem[] = preventiveBriefing ?? [];

    // Wellness visit prep briefing — either "due" (not started) or "in progress"
    const annualWellness = (preventiveItems ?? []).find(
      (i) => i.rule.code === 'annual_wellness_visit',
    );
    const annualWellnessDue =
      annualWellness?.status === 'due' ||
      annualWellness?.status === 'due_soon' ||
      annualWellness?.status === 'needs_review';
    const wellnessCompletedCount = Object.values(wellnessStepsCompleted).filter(
      Boolean,
    ).length;
    const wellnessStarted =
      wellnessCompletedCount > 0 ||
      wellnessFreeformLen > 0 ||
      wellnessSelectedCount > 0 ||
      wellnessQuestionCount > 0;

    const wellnessPrepBriefing: {
      key: string;
      message: string;
      priority: 'high' | 'medium';
    } | null =
      wellnessPacketGenerated
        ? null
        : wellnessStarted
        ? {
            key: 'wellness_prep_in_progress',
            message: `Continue your wellness visit prep (${wellnessCompletedCount} of ${WELLNESS_STEPS.length} steps)`,
            priority: 'medium',
          }
        : annualWellnessDue
        ? {
            key: 'wellness_prep_due',
            message:
              'Your annual wellness visit is coming up. Start preparing?',
            priority: 'high',
          }
        : null;
    const postVisitItems: PostVisitBriefingItem[] = postVisitBriefing ?? [];
    const preAppointmentItems: PreAppointmentBriefingItem[] =
      preAppointmentBriefing ?? [];
    const caregiverEnrichmentItems: CaregiverEnrichmentPrompt[] =
      caregiverPrompts ?? [];
    const showProfileReview = !!profileReviewDue;
    const dataQualityItem = dataQualityBriefing;

    const nothingDue =
      !hasMeds &&
      !nextAppointment &&
      tasksDueCount === 0 &&
      overdueCount === 0 &&
      attentionCount === 0 &&
      billingItems.length === 0 &&
      resultsItems.length === 0 &&
      preventiveItemsBriefing.length === 0 &&
      !wellnessPrepBriefing &&
      postVisitItems.length === 0 &&
      preAppointmentItems.length === 0 &&
      caregiverEnrichmentItems.length === 0 &&
      !showProfileReview &&
      !dataQualityItem;

    const briefingLineCount =
      (hasMeds ? 1 : 0) +
      (nextAppointment ? 1 : 0) +
      (tasksDueCount > 0 || overdueCount > 0 ? 1 : 0) +
      (attentionCount > 0 ? 1 : 0) +
      billingItems.length +
      resultsItems.length +
      preventiveItemsBriefing.length +
      (wellnessPrepBriefing ? 1 : 0) +
      postVisitItems.length +
      preAppointmentItems.length +
      caregiverEnrichmentItems.length +
      (showProfileReview ? 1 : 0) +
      (dataQualityItem ? 1 : 0);

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
      preventiveItems: preventiveItemsBriefing,
      wellnessPrepBriefing,
      postVisitItems,
      preAppointmentItems,
      caregiverEnrichmentItems,
      showProfileReview,
      dataQualityItem,
      nothingDue,
      briefingLineCount,
    };
  }, [
    todaysDoses,
    allAppointments,
    openTasks,
    billingBriefing,
    resultsBriefing,
    preventiveBriefing,
    preventiveItems,
    postVisitBriefing,
    preAppointmentBriefing,
    profileReviewDue,
    caregiverPrompts,
    dataQualityBriefing,
    wellnessStepsCompleted,
    wellnessPacketGenerated,
    wellnessFreeformLen,
    wellnessSelectedCount,
    wellnessQuestionCount,
  ]);

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

  const handleLifeEventAction = (
    handlerId: string,
    payload: Record<string, unknown> | undefined,
    prompt: LifeEventPrompt,
  ) => {
    if (handlerId === 'add_condition') {
      const conditionName =
        typeof payload?.conditionName === 'string'
          ? (payload.conditionName as string)
          : null;
      if (!conditionName || !activeProfileId) return;
      addProfileFactMutation.mutate({
        category: 'condition',
        field_key: 'condition.name',
        value_json: { name: conditionName, status: 'active' },
      });
      return;
    }
    if (handlerId === 'archive_condition') {
      const factId = typeof payload?.factId === 'string' ? (payload.factId as string) : null;
      if (!factId) return;
      deleteProfileFactMutation.mutate(factId);
      return;
    }
    if (handlerId === 'add_care_team_from_appointment') {
      const providerName =
        typeof payload?.providerName === 'string'
          ? (payload.providerName as string)
          : null;
      if (!providerName || !activeProfileId) return;
      addProfileFactMutation.mutate({
        category: 'care_team',
        field_key: 'care_team.name',
        value_json: { name: providerName },
      });
      return;
    }
    // Unknown handler → just close, prompt logs will surface it if it matters.
    dismissLifeEventPrompt(prompt.id);
  };

  const todayDateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // Synthesize the conversational daily briefing. Kept separate from the
  // existing `briefing` memo so module-specific bullets remain below as
  // supporting detail.
  const dailyBriefing = useMemo(() => {
    const firstName = activeProfile?.display_name?.split(' ')[0] ?? null;
    const newMilestoneId = unseenMilestones[0];
    const milestone = newMilestoneId ? getMilestone(newMilestoneId) : null;
    return buildDailyBriefing({
      firstName,
      priorities: patientPriorities ?? null,
      todaysDoses: todaysDoses ?? [],
      upcomingAppointments: allAppointments ?? [],
      openTasks: openTasks ?? [],
      completedThisWeek: progressStats?.completedThisWeek ?? 0,
      streakDays: progressStats?.streakDays ?? 0,
      newMilestone: milestone ? { title: milestone.title } : null,
    });
  }, [
    activeProfile,
    patientPriorities,
    todaysDoses,
    allAppointments,
    openTasks,
    progressStats,
    unseenMilestones,
  ]);

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

          {isCaregiver && activeProfile && (
            <View style={styles.caregiverBadge}>
              <Ionicons name="heart" size={13} color="#FFFFFF" />
              <Text style={styles.caregiverBadgeText}>
                You're helping manage {activeProfile.display_name}'s profile
              </Text>
            </View>
          )}

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
          {/* Milestone celebration — first-view only, marked seen after display */}
          {unseenMilestones.length > 0 && (
            <View style={styles.lifeEventPromptWrap}>
              {(() => {
                const id = unseenMilestones[0];
                const meta = getMilestone(id);
                if (!meta) return null;
                // Fire-and-forget mark-seen so it doesn't repeat tomorrow.
                void markMilestonesSeen([id]);
                return (
                  <MilestoneBadgeCard
                    title={meta.title}
                    detail={meta.detail}
                    icon={meta.icon}
                  />
                );
              })()}
            </View>
          )}

          {/* Life-event prompt — surfaces contextually after a profile change */}
          {topLifeEventPrompt && (
            <View style={styles.lifeEventPromptWrap}>
              <LifeEventPromptCard
                prompt={topLifeEventPrompt}
                onDismiss={dismissLifeEventPrompt}
                onHandler={handleLifeEventAction}
              />
            </View>
          )}

          {/* ZONE 2: DAILY BRIEFING CARD (synthesized) */}
          <View style={styles.zone}>
            <DailyBriefingCard
              briefing={dailyBriefing}
              dateLabel={todayDateStr}
              onViewDetails={() => router.push('/(main)/today')}
              onAsk={() => router.push('/(main)/ask')}
              onPrioritiesPress={
                activeProfileId
                  ? () =>
                      router.push(
                        `/(main)/profile/${activeProfileId}/priorities`,
                      )
                  : undefined
              }
            />
          </View>

          {/* Weekly summary — Monday-first-visit, gated per user+week */}
          {weeklySummary && user?.id && (
            <View style={styles.zone}>
              <View style={styles.summaryCard}>
                <View style={styles.summaryHeader}>
                  <Ionicons
                    name="sparkles"
                    size={18}
                    color={COLORS.accent.dark}
                  />
                  <Text style={styles.summaryTitle}>Last week you completed {weeklySummary.totalCount} tasks</Text>
                  <TouchableOpacity
                    onPress={() => {
                      void dismissWeeklySummary(user.id, weeklySummary.weekStartIso);
                    }}
                    hitSlop={8}
                  >
                    <Ionicons
                      name="close"
                      size={18}
                      color={COLORS.text.tertiary}
                    />
                  </TouchableOpacity>
                </View>
                {weeklySummary.highlights.map((h) => (
                  <View key={h.id} style={styles.summaryLine}>
                    <Ionicons
                      name="checkmark"
                      size={14}
                      color={COLORS.success.DEFAULT}
                    />
                    <Text style={styles.summaryLineText} numberOfLines={1}>
                      {h.title}
                    </Text>
                  </View>
                ))}
                <Text style={styles.summaryFooter}>Keep it up.</Text>
              </View>
            </View>
          )}

          {/* Streak celebration — 3/7/30 day thresholds */}
          {streakCelebration && user?.id && (
            <View style={styles.zone}>
              <TouchableOpacity
                style={styles.streakCard}
                onPress={() => {
                  void dismissStreakCelebration(user.id, streakCelebration);
                }}
                activeOpacity={0.9}
              >
                <Ionicons
                  name="flame"
                  size={22}
                  color={COLORS.accent.dark}
                />
                <View style={styles.streakTextWrap}>
                  <Text style={styles.streakTitle}>
                    {streakCelebration === 30
                      ? 'A full month of staying on top of your health!'
                      : streakCelebration === 7
                        ? "7-day streak! You're on a roll."
                        : "3-day streak — nice start!"}
                  </Text>
                  <Text style={styles.streakHint}>Tap to dismiss</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* ZONE 2B: MODULE-SPECIFIC BRIEFING BULLETS (supporting detail) */}
          {!briefing.nothingDue &&
            briefing.postVisitItems.length +
              briefing.preAppointmentItems.length +
              briefing.billingItems.length +
              briefing.resultsItems.length +
              briefing.preventiveItems.length +
              briefing.caregiverEnrichmentItems.length +
              (briefing.attentionCount > 0 ? 1 : 0) +
              (briefing.showProfileReview ? 1 : 0) +
              (briefing.dataQualityItem ? 1 : 0) >
              0 && (
            <View style={styles.zone}>
              <Text style={styles.sectionTitle}>HAPPENING IN YOUR CARE</Text>
              <View style={styles.supportingCard}>
                <View style={styles.briefingLines}>
                  {/* Post-visit prompts come first — golden 24h recall window. */}
                  {briefing.postVisitItems.map((item) => {
                      const tintColor =
                        item.color === 'critical'
                          ? COLORS.error.DEFAULT
                          : COLORS.accent.dark;
                      return (
                        <TouchableOpacity
                          key={item.key}
                          style={styles.briefingLine}
                          activeOpacity={0.7}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            router.push(
                              `/(main)/appointments/${item.appointmentId}/post-visit-capture`,
                            );
                          }}
                        >
                          <Ionicons name="sparkles" size={18} color={tintColor} />
                          <Text
                            style={[styles.briefingLineText, { color: tintColor }]}
                            numberOfLines={2}
                          >
                            {item.message}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    {briefing.preAppointmentItems.map((item) => {
                      const tintColor =
                        item.color === 'critical'
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
                            router.push(
                              `/(main)/appointments/${item.appointmentId}/pre-check`,
                            );
                          }}
                        >
                          <Ionicons
                            name={item.icon as keyof typeof Ionicons.glyphMap}
                            size={18}
                            color={tintColor}
                          />
                          <Text
                            style={[styles.briefingLineText, { color: tintColor }]}
                            numberOfLines={2}
                          >
                            {item.message}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
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
                    {briefing.wellnessPrepBriefing && (
                      <TouchableOpacity
                        key={briefing.wellnessPrepBriefing.key}
                        style={styles.briefingLine}
                        activeOpacity={0.7}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          router.push('/(main)/preventive/wellness-visit');
                        }}
                      >
                        <Ionicons
                          name="clipboard-outline"
                          size={18}
                          color={
                            briefing.wellnessPrepBriefing.priority === 'high'
                              ? COLORS.primary.DEFAULT
                              : COLORS.text.secondary
                          }
                        />
                        <Text
                          style={styles.briefingLineText}
                          numberOfLines={2}
                        >
                          {briefing.wellnessPrepBriefing.message}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {briefing.caregiverEnrichmentItems.map((item) => {
                      const iconColor =
                        item.priority === 'high'
                          ? COLORS.primary.DEFAULT
                          : COLORS.text.secondary;
                      return (
                        <TouchableOpacity
                          key={item.id}
                          style={styles.briefingLine}
                          activeOpacity={0.7}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            const params = item.actionParams;
                            if (params) {
                              router.push({
                                pathname: item.actionRoute,
                                params,
                              } as never);
                            } else {
                              router.push(item.actionRoute as never);
                            }
                          }}
                          onLongPress={() => {
                            dismissCaregiverPrompt.mutate({
                              kind: item.kind,
                              profileId: item.profileId,
                            });
                          }}
                        >
                          <Ionicons
                            name="heart-outline"
                            size={18}
                            color={iconColor}
                          />
                          <Text
                            style={styles.briefingLineText}
                            numberOfLines={2}
                          >
                            {item.title}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    {briefing.showProfileReview && (
                      <TouchableOpacity
                        style={styles.briefingLine}
                        activeOpacity={0.7}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          if (activeProfileId) {
                            dismissReviewBriefing.mutate(activeProfileId);
                          }
                          router.push('/(main)/profile/review');
                        }}
                      >
                        <Ionicons
                          name="refresh-circle-outline"
                          size={18}
                          color={COLORS.text.secondary}
                        />
                        <Text
                          style={[
                            styles.briefingLineText,
                            { color: COLORS.text.secondary },
                          ]}
                          numberOfLines={2}
                        >
                          Time for a quick profile check-in. Keep your health info accurate.
                        </Text>
                      </TouchableOpacity>
                    )}
                    {briefing.dataQualityItem && activeProfileId && (
                      <TouchableOpacity
                        style={styles.briefingLine}
                        activeOpacity={0.7}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          dismissDataQualityBriefing.mutate();
                          router.push(`/(main)/profile/${activeProfileId}/data-quality`);
                        }}
                      >
                        <Ionicons
                          name={briefing.dataQualityItem.icon as keyof typeof Ionicons.glyphMap}
                          size={18}
                          color={COLORS.text.secondary}
                        />
                        <Text
                          style={[
                            styles.briefingLineText,
                            { color: COLORS.text.secondary },
                          ]}
                          numberOfLines={2}
                        >
                          {briefing.dataQualityItem.message}
                        </Text>
                      </TouchableOpacity>
                    )}
                </View>
              </View>
            </View>
          )}

          {/* SMART ENRICHMENT: top nudge + link to full suggestions */}
          {topNudge && activeProfileId && (
            <View style={styles.zone}>
              <View style={styles.nudgeHeader}>
                <Text style={styles.sectionTitle}>SUGGESTED FOR YOU</Text>
                <TouchableOpacity
                  onPress={() =>
                    router.push(`/(main)/profile/${activeProfileId}/strengthen`)
                  }
                  hitSlop={8}
                >
                  <Text style={styles.nudgeViewAll}>View all</Text>
                </TouchableOpacity>
              </View>
              <SmartNudgeCard
                nudge={topNudge}
                profileId={activeProfileId}
                onDismiss={() => dismissNudge(topNudge.id)}
              />
            </View>
          )}

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
  caregiverBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  caregiverBadgeText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: FONT_WEIGHTS.medium,
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
  lifeEventPromptWrap: {
    marginBottom: 16,
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
  supportingCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    ...CARD_SHADOW,
    shadowOpacity: 0.05,
  },
  // Weekly summary card
  summaryCard: {
    backgroundColor: COLORS.accent.DEFAULT + '14',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.accent.DEFAULT + '33',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  summaryTitle: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  summaryLineText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
  },
  summaryFooter: {
    marginTop: 10,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.accent.dark,
    fontStyle: 'italic',
  },
  // Streak celebration
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.accent.DEFAULT + '20',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.accent.DEFAULT + '40',
  },
  streakTextWrap: {
    flex: 1,
  },
  streakTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  streakHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },

  // Smart enrichment
  nudgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  nudgeViewAll: {
    fontSize: 13,
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
