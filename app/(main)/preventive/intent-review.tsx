import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card } from '@/components/ui/Card';
import { DatePicker } from '@/components/ui/DatePicker';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import {
  useIntentSheet,
  useCommitIntentSheet,
} from '@/hooks/usePreventive';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { PREVENTIVE_STATUS_LABELS, PREVENTIVE_STATUS_COLORS } from '@/lib/types/preventive';
import type {
  PreventiveIntentSheetItem,
  PreventiveProposedTask,
  PreventiveTaskTier,
} from '@/lib/types/preventive';

// ── Draft types (local edits) ──────────────────────────────────────────────

interface DraftTask {
  included: boolean;
  title: string;
  description: string;
  tier: PreventiveTaskTier;
  dueDate: Date | null; // absolute — converted back to relative on commit
  keyedOriginalDueInDays: number | null;
}

interface DraftReminder {
  included: boolean;
  title: string;
  remindInDays: number;
}

interface DraftItem {
  preventiveItemId: string;
  ruleCode: string;
  title: string;
  currentStatus: PreventiveIntentSheetItem['currentStatus'];
  tasks: DraftTask[];
  reminders: DraftReminder[];
}

const TIER_LABELS: Record<PreventiveTaskTier, string> = {
  critical: 'Critical',
  important: 'Important',
  helpful: 'Helpful',
};

const TIER_COLORS: Record<PreventiveTaskTier, string> = {
  critical: COLORS.error.DEFAULT,
  important: COLORS.accent.DEFAULT,
  helpful: COLORS.secondary.DEFAULT,
};

function addDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function toDraftItems(items: PreventiveIntentSheetItem[]): DraftItem[] {
  return items.map((item) => ({
    preventiveItemId: item.preventiveItemId,
    ruleCode: item.ruleCode,
    title: item.title,
    currentStatus: item.currentStatus,
    tasks: item.proposedTasks.map((t) => ({
      included: true,
      title: t.title,
      description: t.description,
      tier: t.tier,
      dueDate: t.dueInDays !== null ? addDays(t.dueInDays) : null,
      keyedOriginalDueInDays: t.dueInDays,
    })),
    reminders: item.proposedReminders.map((r) => ({
      included: true,
      title: r.title,
      remindInDays: r.remindInDays,
    })),
  }));
}

function draftToContentTask(t: DraftTask): PreventiveProposedTask {
  const dueInDays =
    t.dueDate === null
      ? null
      : Math.max(
          0,
          Math.round((t.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        );
  return {
    title: t.title,
    description: t.description,
    tier: t.tier,
    dueInDays,
  };
}

function formatShort(date: Date | null): string {
  if (!date) return 'No due date';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Screen ────────────────────────────────────────────────────────────────

export default function PreventiveIntentReviewScreen() {
  const router = useRouter();
  const { sheetId } = useLocalSearchParams<{ sheetId: string }>();
  const { activeProfile } = useActiveProfile();
  const profileId = activeProfile?.id ?? null;
  const householdId = activeProfile?.household_id ?? null;

  const { data: sheet, isLoading, error } = useIntentSheet(sheetId ?? null);
  const commit = useCommitIntentSheet();

  const [drafts, setDrafts] = useState<DraftItem[] | null>(null);

  // Initialize drafts once when the sheet loads.
  useEffect(() => {
    if (sheet && drafts === null) {
      setDrafts(toDraftItems(sheet.items_json));
    }
  }, [sheet, drafts]);

  const totals = useMemo(() => {
    if (!drafts) return { tasks: 0, reminders: 0 };
    let tasks = 0;
    let reminders = 0;
    for (const item of drafts) {
      tasks += item.tasks.filter((t) => t.included).length;
      reminders += item.reminders.filter((r) => r.included).length;
    }
    return { tasks, reminders };
  }, [drafts]);

  const toggleTask = useCallback((itemIdx: number, taskIdx: number) => {
    setDrafts((prev) => {
      if (!prev) return prev;
      const next = prev.map((it) => ({ ...it, tasks: [...it.tasks], reminders: [...it.reminders] }));
      next[itemIdx].tasks[taskIdx] = {
        ...next[itemIdx].tasks[taskIdx],
        included: !next[itemIdx].tasks[taskIdx].included,
      };
      return next;
    });
  }, []);

  const setTaskDue = useCallback(
    (itemIdx: number, taskIdx: number, date: Date | null) => {
      setDrafts((prev) => {
        if (!prev) return prev;
        const next = prev.map((it) => ({ ...it, tasks: [...it.tasks], reminders: [...it.reminders] }));
        next[itemIdx].tasks[taskIdx] = {
          ...next[itemIdx].tasks[taskIdx],
          dueDate: date,
        };
        return next;
      });
    },
    [],
  );

  const toggleReminder = useCallback((itemIdx: number, remIdx: number) => {
    setDrafts((prev) => {
      if (!prev) return prev;
      const next = prev.map((it) => ({ ...it, tasks: [...it.tasks], reminders: [...it.reminders] }));
      next[itemIdx].reminders[remIdx] = {
        ...next[itemIdx].reminders[remIdx],
        included: !next[itemIdx].reminders[remIdx].included,
      };
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (!sheet || !drafts || !profileId || !householdId) return;

    // Build a filtered content object from drafts.
    const filteredItems = drafts
      .map((item) => ({
        preventiveItemId: item.preventiveItemId,
        ruleCode: item.ruleCode,
        title: item.title,
        currentStatus: item.currentStatus,
        proposedStatus: 'scheduled' as const,
        proposedTasks: item.tasks.filter((t) => t.included).map(draftToContentTask),
        proposedReminders: item.reminders.filter((r) => r.included).map((r) => ({
          title: r.title,
          remindInDays: r.remindInDays,
        })),
      }))
      .filter((item) => item.proposedTasks.length > 0 || item.proposedReminders.length > 0);

    if (filteredItems.length === 0) {
      Alert.alert(
        'Nothing to create',
        'Please include at least one task or reminder before confirming.',
      );
      return;
    }

    commit.mutate(
      {
        sheetId: sheet.id,
        profileId,
        householdId,
        content: { items: filteredItems },
      },
      {
        onSuccess: ({ taskCount, reminderCount }) => {
          const parts: string[] = [];
          if (taskCount > 0) parts.push(`${taskCount} task${taskCount === 1 ? '' : 's'}`);
          if (reminderCount > 0)
            parts.push(`${reminderCount} reminder${reminderCount === 1 ? '' : 's'}`);
          const summary = parts.join(' and ');
          Alert.alert(
            'Plan created',
            `${summary} created! Track them in your Tasks.`,
            [{ text: 'OK', onPress: () => router.replace('/(main)/preventive') }],
          );
        },
        onError: (err) => {
          Alert.alert('Could not create plan', err instanceof Error ? err.message : 'Please try again.');
        },
      },
    );
  }, [sheet, drafts, profileId, householdId, commit, router]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/preventive');
  }, [router]);

  const handleHome = useCallback(() => {
    router.replace('/(main)/(tabs)');
  }, [router]);

  if (!sheetId) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header onBack={handleBack} onHome={handleHome} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>No intent sheet.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading || !drafts) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header onBack={handleBack} onHome={handleHome} />
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.primary.DEFAULT} />
          <Text style={styles.loadingText}>Loading your plan...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !sheet) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header onBack={handleBack} onHome={handleHome} />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={36} color={COLORS.text.tertiary} />
          <Text style={styles.errorText}>Couldn't load the plan.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const alreadyCommitted = sheet.status === 'committed';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Header onBack={handleBack} onHome={handleHome} />

        <View style={styles.intro}>
          <Text style={styles.introTitle}>Here's what we'll set up</Text>
          <Text style={styles.introSubtitle}>
            Review the proposed tasks and reminders. Uncheck anything you don't want,
            or adjust the due dates. Nothing is created until you confirm.
          </Text>
        </View>

        {drafts.map((item, itemIdx) => (
          <View key={item.preventiveItemId} style={styles.itemBlock}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: PREVENTIVE_STATUS_COLORS[item.currentStatus] + '20' },
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    { color: PREVENTIVE_STATUS_COLORS[item.currentStatus] },
                  ]}
                >
                  {PREVENTIVE_STATUS_LABELS[item.currentStatus]}
                </Text>
              </View>
            </View>

            {item.tasks.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>WHAT WILL HAPPEN</Text>
                {item.tasks.map((task, taskIdx) => (
                  <TaskCard
                    key={`${item.preventiveItemId}-task-${taskIdx}`}
                    task={task}
                    onToggle={() => toggleTask(itemIdx, taskIdx)}
                    onChangeDate={(d) => setTaskDue(itemIdx, taskIdx, d)}
                  />
                ))}
              </>
            )}

            {item.reminders.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>REMINDERS</Text>
                {item.reminders.map((reminder, remIdx) => (
                  <ReminderCard
                    key={`${item.preventiveItemId}-rem-${remIdx}`}
                    reminder={reminder}
                    onToggle={() => toggleReminder(itemIdx, remIdx)}
                  />
                ))}
              </>
            )}
          </View>
        ))}

        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            This will create{' '}
            <Text style={styles.summaryHighlight}>
              {totals.tasks} task{totals.tasks === 1 ? '' : 's'}
            </Text>{' '}
            and{' '}
            <Text style={styles.summaryHighlight}>
              {totals.reminders} reminder{totals.reminders === 1 ? '' : 's'}
            </Text>
            .
          </Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryButton, (commit.isPending || alreadyCommitted) && styles.primaryButtonDisabled]}
            onPress={handleConfirm}
            disabled={commit.isPending || alreadyCommitted}
            activeOpacity={0.8}
          >
            {commit.isPending ? (
              <ActivityIndicator color={COLORS.text.inverse} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {alreadyCommitted ? 'Already Confirmed' : 'Confirm & Create Tasks'}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleBack}
            disabled={commit.isPending}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function Header({ onBack, onHome }: { onBack: () => void; onHome?: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTopRow}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary.DEFAULT} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        {onHome && (
          <TouchableOpacity
            onPress={onHome}
            style={styles.homeButton}
            activeOpacity={0.7}
            hitSlop={8}
            accessibilityLabel="Go to Home"
          >
            <Ionicons name="home-outline" size={20} color={COLORS.text.secondary} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.title}>Review Your Plan</Text>
    </View>
  );
}

function TaskCard({
  task,
  onToggle,
  onChangeDate,
}: {
  task: DraftTask;
  onToggle: () => void;
  onChangeDate: (date: Date | null) => void;
}) {
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);
  const tierColor = TIER_COLORS[task.tier];

  return (
    <Card style={task.included ? styles.card : { ...styles.card, ...styles.cardDimmed }}>
      <View style={styles.cardHeader}>
        <TouchableOpacity onPress={onToggle} style={styles.checkbox} activeOpacity={0.7}>
          <Ionicons
            name={task.included ? 'checkbox' : 'square-outline'}
            size={22}
            color={task.included ? COLORS.primary.DEFAULT : COLORS.text.tertiary}
          />
        </TouchableOpacity>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{task.title}</Text>
          <Text style={styles.cardDescription}>{task.description}</Text>

          <View style={styles.metaRow}>
            <View style={[styles.tierChip, { backgroundColor: tierColor + '1A' }]}>
              <Text style={[styles.tierChipText, { color: tierColor }]}>
                {TIER_LABELS[task.tier]}
              </Text>
            </View>

            {Platform.OS === 'ios' ? (
              <View style={styles.dueDatePickerInline}>
                <DatePicker
                  mode="date"
                  value={task.dueDate}
                  onChange={onChangeDate}
                  placeholder="No due date"
                  minimumDate={new Date()}
                />
              </View>
            ) : (
              <TouchableOpacity
                style={styles.dueDateButton}
                onPress={() => setShowAndroidPicker(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="calendar-outline" size={14} color={COLORS.text.secondary} />
                <Text style={styles.dueDateText}>{formatShort(task.dueDate)}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {Platform.OS === 'android' && showAndroidPicker && (
        <DateTimePicker
          value={task.dueDate ?? new Date()}
          mode="date"
          display="default"
          minimumDate={new Date()}
          onChange={(_, d) => {
            setShowAndroidPicker(false);
            if (d) onChangeDate(d);
          }}
        />
      )}
    </Card>
  );
}

function ReminderCard({
  reminder,
  onToggle,
}: {
  reminder: DraftReminder;
  onToggle: () => void;
}) {
  return (
    <Card style={reminder.included ? styles.card : { ...styles.card, ...styles.cardDimmed }}>
      <View style={styles.cardHeader}>
        <TouchableOpacity onPress={onToggle} style={styles.checkbox} activeOpacity={0.7}>
          <Ionicons
            name={reminder.included ? 'checkbox' : 'square-outline'}
            size={22}
            color={reminder.included ? COLORS.primary.DEFAULT : COLORS.text.tertiary}
          />
        </TouchableOpacity>
        <View style={styles.cardBody}>
          <View style={styles.reminderHeaderRow}>
            <Ionicons name="notifications-outline" size={14} color={COLORS.text.secondary} />
            <Text style={styles.cardTitle}>{reminder.title}</Text>
          </View>
          <Text style={styles.cardDescription}>
            Reminds you in {reminder.remindInDays} day{reminder.remindInDays === 1 ? '' : 's'}.
          </Text>
        </View>
      </View>
    </Card>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  loadingText: { fontSize: FONT_SIZES.base, color: COLORS.text.secondary },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -4,
  },
  homeButton: {
    padding: 6,
    marginRight: -6,
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

  intro: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  introTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginTop: 12,
  },
  introSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
    marginTop: 6,
  },

  itemBlock: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  itemTitle: {
    flex: 1,
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    letterSpacing: 1,
    marginTop: 14,
    marginBottom: 8,
  },

  card: { marginBottom: 10 },
  cardDimmed: { opacity: 0.55 },
  cardHeader: {
    flexDirection: 'row',
    gap: 10,
  },
  checkbox: {
    paddingTop: 2,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  cardDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  tierChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  tierChipText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  dueDateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  dueDateText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  dueDatePickerInline: {
    flex: 1,
    minWidth: 180,
  },

  reminderHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  summary: {
    marginHorizontal: 24,
    marginTop: 24,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '33',
  },
  summaryText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  summaryHighlight: {
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },

  actions: {
    paddingHorizontal: 24,
    marginTop: 20,
    gap: 10,
  },
  primaryButton: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
