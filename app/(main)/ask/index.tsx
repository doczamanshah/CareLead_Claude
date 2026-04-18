import { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import {
  useProfileIndex,
  useAskProfile,
  useVerifyFact,
  useResolveConflict,
} from '@/hooks/useAsk';
import { AnswerCard } from '@/components/AnswerCard';
import { LabTableCard } from '@/components/LabTableCard';
import { TrendChartCard } from '@/components/TrendChartCard';
import { ComparisonTableCard } from '@/components/ComparisonTableCard';
import { SummaryListCard } from '@/components/SummaryListCard';
import { TimelineCard } from '@/components/TimelineCard';
import {
  ConflictResolutionModal,
  type ConflictResolutionChoice,
} from '@/components/ConflictResolution';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  AnswerCardAction,
  AskResponse,
  CanonicalFact,
  FactDomain,
  ProfileIndex,
} from '@/lib/types/ask';

interface Exchange {
  id: string;
  query: string;
  response: AskResponse | null;
  error: string | null;
  pending: boolean;
  expanded: boolean;
}

const MAX_CHIPS = 8;

type AskRouteDomain =
  | 'medications'
  | 'results'
  | 'labs'
  | 'preventive'
  | 'billing'
  | 'appointments'
  | 'conditions'
  | 'allergies';

interface QuickChip {
  id: string;
  label: string;
  query: string;
}

const GENERIC_CHIP_SOURCES: Record<FactDomain, QuickChip | null> = {
  medications: { id: 'meds', label: 'My medications', query: 'What medications am I taking?' },
  labs: { id: 'labs', label: 'Latest labs', query: 'Show my latest lab results' },
  results: { id: 'results', label: 'Latest results', query: 'Show my latest test results' },
  allergies: { id: 'allergies', label: 'Any allergies?', query: 'What are my allergies?' },
  conditions: { id: 'conditions', label: 'My conditions', query: 'What are my health conditions?' },
  appointments: {
    id: 'next-appt',
    label: 'Next appointment',
    query: 'When is my next appointment?',
  },
  insurance: { id: 'insurance', label: 'Insurance info', query: 'What is my insurance information?' },
  care_team: { id: 'care-team', label: 'Care team', query: 'Who is on my care team?' },
  preventive: { id: 'screenings', label: 'Screenings due', query: 'What screenings are due?' },
  billing: { id: 'bills', label: 'My bills', query: 'Show my active bills' },
  surgeries: { id: 'surgeries', label: 'Past surgeries', query: 'What surgeries have I had?' },
  immunizations: { id: 'immunizations', label: 'Vaccines', query: 'What vaccines have I received?' },
  vitals: null,
};

// Map a route "domain" hint to one or more FactDomains for chip prioritization.
const DOMAIN_HINT_MAP: Record<AskRouteDomain, FactDomain[]> = {
  medications: ['medications'],
  results: ['results', 'labs'],
  labs: ['labs', 'results'],
  preventive: ['preventive'],
  billing: ['billing'],
  appointments: ['appointments'],
  conditions: ['conditions'],
  allergies: ['allergies'],
};

function normalizeDomainHint(raw: string | null | undefined): AskRouteDomain | null {
  if (!raw) return null;
  if (raw in DOMAIN_HINT_MAP) return raw as AskRouteDomain;
  return null;
}

function buildQuickChips(
  profileIndex: ProfileIndex | undefined,
  domainHint: AskRouteDomain | null,
): QuickChip[] {
  if (!profileIndex) return [];

  const chips: QuickChip[] = [];
  const seen = new Set<string>();
  const addChip = (chip: QuickChip | null | undefined): void => {
    if (!chip) return;
    if (seen.has(chip.id)) return;
    if (chips.length >= MAX_CHIPS) return;
    seen.add(chip.id);
    chips.push(chip);
  };

  const facts = profileIndex.facts;
  const counts = profileIndex.factCounts;
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const sevenDays = 7 * oneDay;

  // ── 1) Contextual / time-sensitive chips first ──────────────────────────
  const upcomingAppt = facts
    .filter((f) => f.domain === 'appointments' && f.dateRelevant)
    .map((f) => ({ fact: f, time: new Date(f.dateRelevant as string).getTime() }))
    .filter(({ time }) => !isNaN(time) && time >= now && time <= now + 2 * oneDay)
    .sort((a, b) => a.time - b.time)[0];
  if (upcomingAppt) {
    const t = upcomingAppt.time;
    const isToday = t - now < oneDay && new Date(t).getDate() === new Date(now).getDate();
    addChip({
      id: 'ctx-next-appt',
      label: isToday ? "Prepare for today's appointment" : "Prepare for tomorrow's appointment",
      query: isToday
        ? "What do I need for today's appointment?"
        : "What do I need for tomorrow's appointment?",
    });
  }

  const dueScreening = facts.find(
    (f) =>
      f.domain === 'preventive' &&
      typeof f.value === 'object' &&
      f.value !== null &&
      ((f.value as { status?: string }).status === 'due' ||
        (f.value as { status?: string }).status === 'due_soon'),
  );
  if (dueScreening) {
    addChip({
      id: 'ctx-screening',
      label: `${dueScreening.displayName} is due`,
      query: `Tell me about ${dueScreening.displayName}`,
    });
  }

  const recentLab = facts
    .filter((f) => f.domain === 'labs')
    .map((f) => ({ fact: f, t: new Date(f.updatedAt).getTime() }))
    .filter(({ t }) => !isNaN(t) && now - t < sevenDays)
    .sort((a, b) => b.t - a.t)[0];
  if (recentLab) {
    const parent = (recentLab.fact.value as { parentTestName?: string | null }).parentTestName
      ?? recentLab.fact.displayName;
    addChip({
      id: 'ctx-recent-lab',
      label: `Latest ${parent} results`,
      query: `Show my latest ${parent} results`,
    });
  }

  // ── 2) Domain-hint chip(s) before other domain chips ────────────────────
  if (domainHint) {
    for (const d of DOMAIN_HINT_MAP[domainHint]) {
      if ((counts[d] ?? 0) > 0) addChip(GENERIC_CHIP_SOURCES[d]);
    }
  }

  // ── 3) Populated-domain chips in a stable priority order ─────────────────
  const DOMAIN_PRIORITY: FactDomain[] = [
    'medications',
    'labs',
    'results',
    'appointments',
    'preventive',
    'conditions',
    'allergies',
    'billing',
    'insurance',
    'care_team',
    'surgeries',
    'immunizations',
  ];
  for (const d of DOMAIN_PRIORITY) {
    if ((counts[d] ?? 0) > 0) addChip(GENERIC_CHIP_SOURCES[d]);
  }

  // ── 4) Generic fallbacks if we're still thin ─────────────────────────────
  if (chips.length === 0) {
    addChip({ id: 'g-meds', label: 'My medications', query: 'What medications am I taking?' });
    addChip({ id: 'g-allergies', label: 'Any allergies?', query: 'What are my allergies?' });
    addChip({ id: 'g-next-appt', label: 'Next appointment', query: 'When is my next appointment?' });
    addChip({ id: 'g-care-team', label: 'Care team', query: 'Who is on my care team?' });
  }

  return chips.slice(0, MAX_CHIPS);
}

function buildExampleQuestions(profileIndex: ProfileIndex | undefined): string[] {
  if (!profileIndex) {
    return [
      'What medications am I taking?',
      'What was my last A1c?',
      'When is my next appointment?',
      'Do I have any allergies?',
      'Who is on my care team?',
    ];
  }
  const counts = profileIndex.factCounts;
  const examples: string[] = [];
  if ((counts.medications ?? 0) > 0) examples.push('What medications am I taking?');
  if ((counts.labs ?? 0) > 0) examples.push('What was my last A1c?');
  if ((counts.appointments ?? 0) > 0) examples.push('When is my next appointment?');
  if ((counts.allergies ?? 0) > 0) examples.push('Do I have any allergies?');
  if ((counts.preventive ?? 0) > 0) examples.push('What screenings are due?');
  if ((counts.care_team ?? 0) > 0) examples.push('Who is on my care team?');
  if ((counts.billing ?? 0) > 0) examples.push('What bills are open?');

  // Fill with generics if sparse.
  const generics = [
    'What medications am I taking?',
    'When is my next appointment?',
    'Do I have any allergies?',
    'Who is on my care team?',
    'What was my last A1c?',
  ];
  for (const g of generics) {
    if (examples.length >= 5) break;
    if (!examples.includes(g)) examples.push(g);
  }
  return examples.slice(0, 5);
}

const MAX_VISIBLE_CARDS = 5;

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function genExchangeId(): string {
  return `ex:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export default function AskScreen() {
  const router = useRouter();
  const { domain: domainParam } = useLocalSearchParams<{ domain?: string }>();
  const domainHint = normalizeDomainHint(domainParam);
  const { activeProfile, activeProfileId, profiles, switchProfile } = useActiveProfile();
  const householdId = activeProfile?.household_id ?? null;

  const { data: profileIndex, isLoading: indexLoading } = useProfileIndex(
    activeProfileId,
    householdId,
  );
  const askMutation = useAskProfile();
  const verifyMutation = useVerifyFact();
  const resolveMutation = useResolveConflict();

  const [input, setInput] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [showProfileSwitcher, setShowProfileSwitcher] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [micHintVisible, setMicHintVisible] = useState(false);
  const [conflictFacts, setConflictFacts] = useState<CanonicalFact[]>([]);
  const [conflictModalVisible, setConflictModalVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const micHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset session when active profile changes
  useEffect(() => {
    setExchanges([]);
    setShowProfileSwitcher(false);
  }, [activeProfileId]);

  useEffect(() => {
    return () => {
      if (micHintTimerRef.current) clearTimeout(micHintTimerRef.current);
    };
  }, []);

  // Auto-scroll to bottom whenever an exchange changes (new one appended or
  // a response arrives for the latest one).
  useEffect(() => {
    if (exchanges.length === 0) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(t);
  }, [exchanges]);

  function handleMicPress() {
    inputRef.current?.focus();
    setMicHintVisible(true);
    if (micHintTimerRef.current) clearTimeout(micHintTimerRef.current);
    micHintTimerRef.current = setTimeout(() => {
      setMicHintVisible(false);
    }, 4000);
  }

  const canSend = input.trim().length > 0 && !!profileIndex && !askMutation.isPending;
  const hasExchanges = exchanges.length > 0;

  const profileSwitchable = profiles.length > 1;

  function sendQuery(rawQuery: string) {
    const query = rawQuery.trim();
    if (!query || !profileIndex || !activeProfileId || !householdId) return;

    const exchangeId = genExchangeId();
    setExchanges((prev) => [
      ...prev,
      { id: exchangeId, query, response: null, error: null, pending: true, expanded: false },
    ]);
    setInput('');

    askMutation.mutate(
      {
        query,
        profileIndex,
        profileId: activeProfileId,
        householdId,
      },
      {
        onSuccess: (response) => {
          setExchanges((prev) =>
            prev.map((ex) =>
              ex.id === exchangeId
                ? { ...ex, response, pending: false, error: null }
                : ex,
            ),
          );
        },
        onError: (err) => {
          setExchanges((prev) =>
            prev.map((ex) =>
              ex.id === exchangeId
                ? {
                    ...ex,
                    pending: false,
                    error: err.message ?? 'Something went wrong',
                    response: null,
                  }
                : ex,
            ),
          );
        },
      },
    );
  }

  function retryExchange(exchangeId: string) {
    const ex = exchanges.find((e) => e.id === exchangeId);
    if (!ex || !profileIndex || !activeProfileId || !householdId) return;
    setExchanges((prev) =>
      prev.map((e) =>
        e.id === exchangeId ? { ...e, pending: true, error: null, response: null } : e,
      ),
    );
    askMutation.mutate(
      {
        query: ex.query,
        profileIndex,
        profileId: activeProfileId,
        householdId,
      },
      {
        onSuccess: (response) => {
          setExchanges((prev) =>
            prev.map((e) =>
              e.id === exchangeId
                ? { ...e, response, pending: false, error: null }
                : e,
            ),
          );
        },
        onError: (err) => {
          setExchanges((prev) =>
            prev.map((e) =>
              e.id === exchangeId
                ? {
                    ...e,
                    pending: false,
                    error: err.message ?? 'Something went wrong',
                    response: null,
                  }
                : e,
            ),
          );
        },
      },
    );
  }

  function handleActionPress(action: AnswerCardAction) {
    if (action.type === 'view_source' && action.targetRoute) {
      router.push(action.targetRoute as never);
      return;
    }

    if (action.type === 'verify') {
      if (!activeProfileId || !householdId) return;
      if (!action.targetId || !action.sourceType) return;
      verifyMutation.mutate({
        factSourceType: action.sourceType,
        factSourceId: action.targetId,
        profileId: activeProfileId,
        householdId,
      });
      return;
    }

    if (action.type === 'resolve_conflict') {
      if (!profileIndex || !action.conflictGroupId) return;
      const groupFacts = profileIndex.facts.filter(
        (f) => f.conflictGroupId === action.conflictGroupId,
      );
      if (groupFacts.length === 0) return;
      setConflictFacts(groupFacts);
      setConflictModalVisible(true);
    }
  }

  function handleResolveKeepOne(choice: ConflictResolutionChoice) {
    if (!activeProfileId || !householdId) return;
    resolveMutation.mutate(
      {
        keepFactSourceId: choice.keepFactSourceId,
        keepFactSourceType: choice.keepFactSourceType,
        archiveFactSourceIds: choice.archiveFactSourceIds,
        profileId: activeProfileId,
        householdId,
      },
      {
        onSuccess: () => {
          setConflictModalVisible(false);
          setConflictFacts([]);
        },
      },
    );
  }

  function handleResolveKeepAll() {
    // "Keep all" means the user rejects the conflict flag. We verify each fact
    // so they stop surfacing as conflicted on the next index rebuild.
    if (!activeProfileId || !householdId) return;
    for (const fact of conflictFacts) {
      if (!fact.sourceId || !fact.sourceType) continue;
      verifyMutation.mutate({
        factSourceType: fact.sourceType,
        factSourceId: fact.sourceId,
        profileId: activeProfileId,
        householdId,
      });
    }
    setConflictModalVisible(false);
    setConflictFacts([]);
  }

  function handleResolveCancel() {
    setConflictModalVisible(false);
    setConflictFacts([]);
  }

  function toggleExpanded(exchangeId: string) {
    setExchanges((prev) =>
      prev.map((ex) => (ex.id === exchangeId ? { ...ex, expanded: !ex.expanded } : ex)),
    );
  }

  const profileInitials = useMemo(
    () => getInitials(activeProfile?.display_name),
    [activeProfile?.display_name],
  );

  const quickChips = useMemo(
    () => buildQuickChips(profileIndex, domainHint),
    [profileIndex, domainHint],
  );

  const exampleQuestions = useMemo(
    () => buildExampleQuestions(profileIndex),
    [profileIndex],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            activeOpacity={0.7}
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={24} color={COLORS.text.DEFAULT} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Ask CareLead</Text>
          </View>
          <TouchableOpacity
            style={styles.profilePill}
            activeOpacity={0.7}
            onPress={() => {
              if (profileSwitchable) setShowProfileSwitcher((v) => !v);
            }}
            disabled={!profileSwitchable}
          >
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>{profileInitials}</Text>
            </View>
            <Text style={styles.profilePillName} numberOfLines={1}>
              {activeProfile?.display_name ?? 'Profile'}
            </Text>
            {profileSwitchable && (
              <Ionicons name="chevron-down" size={14} color={COLORS.text.secondary} />
            )}
          </TouchableOpacity>
        </View>

        {/* Profile switcher dropdown */}
        {showProfileSwitcher && profileSwitchable && (
          <View style={styles.profileDropdown}>
            {profiles.map((p) => {
              const isActive = p.id === activeProfileId;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.profileDropdownItem, isActive && styles.profileDropdownItemActive]}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (!isActive) switchProfile(p.id);
                    setShowProfileSwitcher(false);
                  }}
                >
                  <View style={styles.profileAvatar}>
                    <Text style={styles.profileAvatarText}>{getInitials(p.display_name)}</Text>
                  </View>
                  <Text style={styles.profileDropdownName}>{p.display_name}</Text>
                  {isActive && (
                    <Ionicons name="checkmark" size={18} color={COLORS.primary.DEFAULT} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Quick-ask chips */}
        {quickChips.length > 0 && (
          <View style={styles.chipsContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsContent}
              keyboardShouldPersistTaps="handled"
            >
              {quickChips.map((chip) => (
                <TouchableOpacity
                  key={chip.id}
                  style={styles.chip}
                  activeOpacity={0.7}
                  onPress={() => sendQuery(chip.query)}
                  disabled={!profileIndex || askMutation.isPending}
                >
                  <Text style={styles.chipText}>{chip.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Conversation area */}
        <ScrollView
          ref={scrollRef}
          style={styles.conversation}
          contentContainerStyle={styles.conversationContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {!hasExchanges && (
            <View style={styles.emptyState}>
              {indexLoading ? (
                <View style={styles.emptyLoading}>
                  <ActivityIndicator size="small" color={COLORS.primary.DEFAULT} />
                  <Text style={styles.emptyLoadingText}>Loading your profile…</Text>
                </View>
              ) : (
                <>
                  <View style={styles.emptyIconCluster}>
                    <View style={[styles.clusterIcon, styles.clusterIconLeft]}>
                      <Ionicons name="medkit" size={18} color={COLORS.primary.DEFAULT} />
                    </View>
                    <View style={[styles.clusterIcon, styles.clusterIconTop]}>
                      <Ionicons name="flask" size={18} color={COLORS.secondary.DEFAULT} />
                    </View>
                    <View style={styles.emptyIconWrap}>
                      <Ionicons
                        name="chatbubble-ellipses"
                        size={28}
                        color={COLORS.primary.DEFAULT}
                      />
                    </View>
                    <View style={[styles.clusterIcon, styles.clusterIconBottom]}>
                      <Ionicons name="calendar" size={18} color={COLORS.accent.dark} />
                    </View>
                    <View style={[styles.clusterIcon, styles.clusterIconRight]}>
                      <Ionicons name="heart" size={18} color={COLORS.error.DEFAULT} />
                    </View>
                  </View>
                  <Text style={styles.emptyTitle}>Ask CareLead</Text>
                  <Text style={styles.emptySubtitle}>
                    Your health profile, instantly accessible
                  </Text>
                  <Text style={styles.emptyBody}>
                    Try asking about {activeProfile?.display_name ?? 'this profile'}:
                  </Text>
                  <View style={styles.exampleList}>
                    {exampleQuestions.map((q) => (
                      <TouchableOpacity
                        key={q}
                        style={styles.exampleRow}
                        activeOpacity={0.6}
                        onPress={() => sendQuery(q)}
                      >
                        <Ionicons
                          name="arrow-forward-outline"
                          size={14}
                          color={COLORS.text.tertiary}
                        />
                        <Text style={styles.exampleText}>{q}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.emptyVoiceHint}>
                    <Ionicons
                      name="mic-outline"
                      size={14}
                      color={COLORS.text.tertiary}
                    />
                    <Text style={styles.emptyVoiceHintText}>
                      Or tap the mic to ask with your voice
                    </Text>
                  </View>
                </>
              )}
            </View>
          )}

          {exchanges.map((ex) => (
            <ExchangeBlock
              key={ex.id}
              exchange={ex}
              onActionPress={handleActionPress}
              onFollowUpPress={sendQuery}
              onToggleExpand={() => toggleExpanded(ex.id)}
              onRetry={() => retryExchange(ex.id)}
            />
          ))}
        </ScrollView>

        {/* Dictation hint banner */}
        {micHintVisible && (
          <View style={styles.micHint}>
            <Ionicons name="mic" size={14} color={COLORS.primary.DEFAULT} />
            <Text style={styles.micHintText}>
              Tap the microphone on your keyboard to dictate
            </Text>
          </View>
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <View style={styles.inputWrap}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Ask about your health profile..."
              placeholderTextColor={COLORS.text.tertiary}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={() => {
                if (canSend) sendQuery(input);
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              blurOnSubmit
            />
          </View>
          <TouchableOpacity
            style={[styles.micButton, inputFocused && styles.micActive]}
            activeOpacity={0.7}
            onPress={handleMicPress}
            accessibilityLabel="Dictate your question"
          >
            <Ionicons
              name={inputFocused ? 'mic' : 'mic-outline'}
              size={20}
              color={inputFocused ? '#FFFFFF' : COLORS.primary.DEFAULT}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sendButton, !canSend && styles.sendDisabled]}
            activeOpacity={0.7}
            disabled={!canSend}
            onPress={() => sendQuery(input)}
          >
            <Ionicons
              name="send"
              size={18}
              color={canSend ? '#FFFFFF' : COLORS.text.tertiary}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <ConflictResolutionModal
        visible={conflictModalVisible}
        facts={conflictFacts}
        busy={resolveMutation.isPending || verifyMutation.isPending}
        onCancel={handleResolveCancel}
        onKeepOne={handleResolveKeepOne}
        onKeepAll={handleResolveKeepAll}
      />
    </SafeAreaView>
  );
}

interface ExchangeBlockProps {
  exchange: Exchange;
  onActionPress: (action: AnswerCardAction) => void;
  onFollowUpPress: (q: string) => void;
  onToggleExpand: () => void;
  onRetry: () => void;
}

function ExchangeBlock({
  exchange,
  onActionPress,
  onFollowUpPress,
  onToggleExpand,
  onRetry,
}: ExchangeBlockProps) {
  const { query, response, pending, error, expanded } = exchange;

  const cards = response?.cards ?? [];
  const tableCards = response?.tableCards ?? [];
  const trendCharts = response?.trendCharts ?? [];
  const comparisonTables = response?.comparisonTables ?? [];
  const summaryLists = response?.summaryLists ?? [];
  const timelines = response?.timelines ?? [];

  const hasRichFormat =
    tableCards.length > 0 ||
    trendCharts.length > 0 ||
    comparisonTables.length > 0 ||
    summaryLists.length > 0 ||
    timelines.length > 0;

  const hasAnyContent = hasRichFormat || cards.length > 0;

  const hasMore = cards.length > MAX_VISIBLE_CARDS;
  const visibleCards = expanded ? cards : cards.slice(0, MAX_VISIBLE_CARDS);

  return (
    <View style={styles.exchange}>
      {/* User query bubble */}
      <View style={styles.userBubbleWrap}>
        <View style={styles.userBubble}>
          <Text style={styles.userBubbleText}>{query}</Text>
        </View>
      </View>

      {/* Assistant response */}
      <View style={styles.assistantBlock}>
        {pending && (
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color={COLORS.primary.DEFAULT} />
            <Text style={styles.typingText}>Looking that up…</Text>
          </View>
        )}

        {error && !pending && (
          <View style={styles.errorBlock}>
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.error.DEFAULT} />
              <Text style={styles.errorText}>
                Something went wrong. Let's try that again.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.retryButton}
              activeOpacity={0.7}
              onPress={onRetry}
            >
              <Ionicons
                name="refresh-outline"
                size={14}
                color={COLORS.primary.DEFAULT}
              />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {response && !pending && (
          <>
            <Text style={styles.shortAnswer}>{response.shortAnswer}</Text>

            {response.noResults && !hasAnyContent && (
              <View style={styles.noResultsCard}>
                <Ionicons
                  name="information-circle-outline"
                  size={18}
                  color={COLORS.text.secondary}
                />
                <Text style={styles.noResultsText}>
                  I don't have that information in your profile yet. You can add it through the
                  relevant module.
                </Text>
              </View>
            )}

            {hasRichFormat && (
              <View style={styles.cardsList}>
                {summaryLists.map((sc) => (
                  <SummaryListCard key={sc.id} card={sc} onActionPress={onActionPress} />
                ))}
                {timelines.map((tc) => (
                  <TimelineCard key={tc.id} card={tc} onActionPress={onActionPress} />
                ))}
                {tableCards.map((tc) => (
                  <LabTableCard key={tc.id} card={tc} onActionPress={onActionPress} />
                ))}
                {trendCharts.map((cc) => (
                  <TrendChartCard key={cc.id} card={cc} onActionPress={onActionPress} />
                ))}
                {comparisonTables.map((cc) => (
                  <ComparisonTableCard key={cc.id} card={cc} />
                ))}
              </View>
            )}

            {cards.length > 0 && (
              <View style={styles.cardsBlock}>
                {!hasRichFormat && cards.length > 1 && (
                  <Text style={styles.cardsCount}>
                    {cards.length} {cards.length === 1 ? 'result' : 'results'} found
                  </Text>
                )}
                <View style={styles.cardsList}>
                  {visibleCards.map((card) => (
                    <AnswerCard key={card.id} card={card} onActionPress={onActionPress} />
                  ))}
                </View>
                {hasMore && (
                  <TouchableOpacity
                    style={styles.showAllButton}
                    activeOpacity={0.7}
                    onPress={onToggleExpand}
                  >
                    <Text style={styles.showAllText}>
                      {expanded ? 'Show fewer' : `Show all ${cards.length}`}
                    </Text>
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={COLORS.primary.DEFAULT}
                    />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {response.suggestedFollowUps.length > 0 && (
              <View style={styles.followUps}>
                {response.suggestedFollowUps.map((q) => (
                  <TouchableOpacity
                    key={q}
                    style={styles.followUpChip}
                    activeOpacity={0.7}
                    onPress={() => onFollowUpPress(q)}
                  >
                    <Text style={styles.followUpText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.surface.DEFAULT,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  headerCenter: {
    flex: 1,
  },
  headerTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  profilePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.surface.muted,
    maxWidth: 160,
  },
  profileAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.bold,
  },
  profilePillName: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    maxWidth: 90,
  },

  // Profile dropdown
  profileDropdown: {
    position: 'absolute',
    top: 62,
    right: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    paddingVertical: 4,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
    minWidth: 180,
  },
  profileDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  profileDropdownItemActive: {
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  profileDropdownName: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },

  // Chips
  chipsContainer: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    paddingVertical: 10,
  },
  chipsContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.secondary.DEFAULT + '14',
    borderWidth: 1,
    borderColor: COLORS.secondary.DEFAULT + '33',
  },
  chipText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.primary.DEFAULT,
  },

  // Conversation
  conversation: {
    flex: 1,
  },
  conversationContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },

  // Empty state
  emptyState: {
    paddingTop: 40,
    alignItems: 'center',
  },
  emptyLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 40,
  },
  emptyLoadingText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  emptyIconCluster: {
    width: 180,
    height: 84,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  emptyIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterIcon: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  clusterIconLeft: {
    left: 8,
    top: 26,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    borderColor: COLORS.primary.DEFAULT + '33',
  },
  clusterIconTop: {
    left: 48,
    top: 0,
    backgroundColor: COLORS.secondary.DEFAULT + '14',
    borderColor: COLORS.secondary.DEFAULT + '33',
  },
  clusterIconBottom: {
    left: 96,
    top: 48,
    backgroundColor: COLORS.accent.DEFAULT + '1A',
    borderColor: COLORS.accent.DEFAULT + '40',
  },
  clusterIconRight: {
    right: 8,
    top: 26,
    backgroundColor: COLORS.error.DEFAULT + '14',
    borderColor: COLORS.error.DEFAULT + '33',
  },
  emptyTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  emptySubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  emptyBody: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 12,
    fontWeight: FONT_WEIGHTS.medium,
  },
  exampleList: {
    alignSelf: 'stretch',
    gap: 4,
    paddingHorizontal: 24,
  },
  exampleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  exampleText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  emptyVoiceHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: COLORS.surface.muted,
  },
  emptyVoiceHintText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // Exchange
  exchange: {
    marginBottom: 20,
  },
  userBubbleWrap: {
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  userBubble: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    maxWidth: '85%',
  },
  userBubbleText: {
    fontSize: FONT_SIZES.base,
    color: '#FFFFFF',
    lineHeight: 20,
  },
  assistantBlock: {
    gap: 10,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  typingText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontStyle: 'italic',
  },
  errorBlock: {
    gap: 8,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.error.light,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  errorText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.error.DEFAULT,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  retryText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  shortAnswer: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },
  noResultsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface.muted,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  noResultsText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },

  // Cards
  cardsBlock: {
    gap: 8,
  },
  cardsCount: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardsList: {
    gap: 8,
  },
  showAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
  showAllText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },

  // Follow-ups
  followUps: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  followUpChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  followUpText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.surface.DEFAULT,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: COLORS.surface.muted,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 40,
    justifyContent: 'center',
  },
  input: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    maxHeight: 100,
    padding: 0,
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micActive: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  micHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '20',
  },
  micHintText: {
    flex: 1,
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    backgroundColor: COLORS.border.DEFAULT,
  },
});
