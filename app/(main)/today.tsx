import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useTasks, useUpdateTaskStatus } from '@/hooks/useTasks';
import { useAppointments } from '@/hooks/useAppointments';
import { useTodaysDoses, useLogAdherence } from '@/hooks/useMedications';
import { useProfileGaps } from '@/hooks/useProfileGaps';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { Task } from '@/lib/types/tasks';
import { PRIORITY_ORDER } from '@/lib/types/tasks';
import {
  APPOINTMENT_TYPE_LABELS,
  getPrepStatus,
} from '@/lib/types/appointments';
import type { VisitPrepStatus } from '@/lib/types/appointments';

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

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays <= 7) return `In ${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const PREP_STATUS_LABELS: Record<VisitPrepStatus, string> = {
  not_started: 'Not started',
  draft: 'In progress',
  ready: 'Ready',
};

const PREP_STATUS_COLORS: Record<VisitPrepStatus, string> = {
  not_started: COLORS.text.tertiary,
  draft: COLORS.accent.dark,
  ready: COLORS.success.DEFAULT,
};

export default function TodayDetailScreen() {
  const { activeProfileId } = useActiveProfile();
  const router = useRouter();

  const { data: openTasks } = useTasks(activeProfileId, { status: ['pending', 'in_progress'] });
  const { data: allAppointments } = useAppointments(activeProfileId);
  const { data: todaysDoses } = useTodaysDoses(activeProfileId);
  const { data: gaps } = useProfileGaps(activeProfileId ?? undefined);
  const updateStatus = useUpdateTaskStatus();
  const logAdherence = useLogAdherence();

  const nowIso = new Date().toISOString();

  // Tasks: overdue + due today
  const relevantTasks = useMemo(() => {
    if (!openTasks) return [];
    return openTasks
      .filter((t) => t.dependency_status !== 'blocked' && (isOverdue(t) || isDueToday(t)))
      .sort((a, b) => {
        const aO = isOverdue(a) ? 0 : 1;
        const bO = isOverdue(b) ? 0 : 1;
        if (aO !== bO) return aO - bO;
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      });
  }, [openTasks]);

  // Today/tomorrow appointments
  const todayAppointments = useMemo(() => {
    if (!allAppointments) return [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);
    return allAppointments
      .filter(
        (a) =>
          (a.status === 'scheduled' || a.status === 'preparing' || a.status === 'ready') &&
          a.start_time >= nowIso &&
          a.start_time <= tomorrow.toISOString(),
      )
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [allAppointments, nowIso]);

  // Needs closeout
  const needsCloseout = useMemo(() => {
    if (!allAppointments) return [];
    return allAppointments.filter(
      (a) =>
        (a.status === 'scheduled' || a.status === 'preparing' || a.status === 'ready') &&
        a.start_time < nowIso,
    );
  }, [allAppointments, nowIso]);

  // High priority gaps
  const highGaps = useMemo(() => {
    return (gaps ?? []).filter((g) => g.priority === 'high').slice(0, 3);
  }, [gaps]);

  // Medication doses
  const scheduledDoses = useMemo(() => {
    return (todaysDoses ?? []).filter((d) => !d.medication.prn_flag);
  }, [todaysDoses]);

  const todayDateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <ScreenLayout>
      {/* Back button + title */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={COLORS.primary.DEFAULT} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Today's Details</Text>
          <Text style={styles.subtitle}>{todayDateStr}</Text>
        </View>
      </View>

      {/* MEDICATIONS */}
      {scheduledDoses.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="medical" size={18} color={COLORS.primary.DEFAULT} />
            <Text style={styles.sectionTitle}>Medications</Text>
          </View>
          {scheduledDoses.map((dose) => {
            const taken = dose.adherenceToday === 'taken';
            const skipped = dose.adherenceToday === 'skipped';
            return (
              <Card key={dose.medication.id} style={styles.itemCard}>
                <View style={styles.itemRow}>
                  <View style={styles.itemContent}>
                    <Text style={[styles.itemTitle, taken && styles.itemTitleDone]}>
                      {dose.medication.drug_name}
                    </Text>
                    <Text style={styles.itemMeta}>
                      {dose.medication.strength ?? ''}{dose.medication.sig?.frequency_text ? ` - ${dose.medication.sig.frequency_text}` : ''}
                    </Text>
                  </View>
                  {!taken && !skipped ? (
                    <View style={styles.doseActions}>
                      <TouchableOpacity
                        style={styles.takeButton}
                        onPress={() =>
                          logAdherence.mutate({
                            medicationId: dose.medication.id,
                            eventType: 'taken',
                            profileId: dose.medication.profile_id,
                          })
                        }
                      >
                        <Text style={styles.takeButtonText}>Take</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.skipButton}
                        onPress={() =>
                          logAdherence.mutate({
                            medicationId: dose.medication.id,
                            eventType: 'skipped',
                            profileId: dose.medication.profile_id,
                          })
                        }
                      >
                        <Text style={styles.skipButtonText}>Skip</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={[styles.statusBadge, taken ? styles.takenBadge : styles.skippedBadge]}>
                      <Ionicons
                        name={taken ? 'checkmark' : 'close'}
                        size={14}
                        color={taken ? COLORS.success.DEFAULT : COLORS.text.tertiary}
                      />
                      <Text style={[styles.statusBadgeText, taken ? styles.takenText : styles.skippedText]}>
                        {taken ? 'Taken' : 'Skipped'}
                      </Text>
                    </View>
                  )}
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* APPOINTMENTS */}
      {todayAppointments.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="calendar" size={18} color={COLORS.primary.DEFAULT} />
            <Text style={styles.sectionTitle}>Appointments</Text>
          </View>
          {todayAppointments.map((apt) => {
            const prepStatus = getPrepStatus(apt.prep_json);
            const prepColor = PREP_STATUS_COLORS[prepStatus];
            const time = new Date(apt.start_time).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            });
            return (
              <Card
                key={apt.id}
                style={styles.itemCard}
                onPress={() => router.push(`/(main)/appointments/${apt.id}`)}
              >
                <View style={styles.itemRow}>
                  <View style={styles.itemContent}>
                    <Text style={styles.itemTitle}>{apt.title}</Text>
                    <Text style={styles.itemMeta}>
                      {time}
                      {apt.provider_name ? ` with ${apt.provider_name}` : ''}
                    </Text>
                    <Text style={[styles.prepLabel, { color: prepColor }]}>
                      Prep: {PREP_STATUS_LABELS[prepStatus]}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.text.tertiary} />
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* TASKS */}
      {relevantTasks.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="checkmark-circle" size={18} color={COLORS.primary.DEFAULT} />
            <Text style={styles.sectionTitle}>Tasks</Text>
          </View>
          {relevantTasks.map((task) => {
            const overdue = isOverdue(task);
            return (
              <Card
                key={task.id}
                style={styles.itemCard}
                onPress={() => router.push(`/(main)/tasks/${task.id}`)}
              >
                <View style={styles.itemRow}>
                  <TouchableOpacity
                    style={styles.taskCheck}
                    onPress={() => updateStatus.mutate({ taskId: task.id, status: 'completed' })}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <View style={[styles.taskCheckCircle, overdue && styles.taskCheckOverdue]} />
                  </TouchableOpacity>
                  <View style={styles.itemContent}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{task.title}</Text>
                    {task.due_date && (
                      <Text style={[styles.itemMeta, overdue && styles.overdueText]}>
                        {formatDueDate(task.due_date)}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={() => updateStatus.mutate({ taskId: task.id, status: 'dismissed' })}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle-outline" size={20} color={COLORS.text.tertiary} />
                  </TouchableOpacity>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* NEEDS ATTENTION */}
      {(needsCloseout.length > 0 || highGaps.length > 0) && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="notifications" size={18} color={COLORS.accent.dark} />
            <Text style={styles.sectionTitle}>Needs Attention</Text>
          </View>

          {/* Post-visit closeout */}
          {needsCloseout.map((apt) => (
            <Card key={`closeout-${apt.id}`} style={styles.itemCard}>
              <Text style={styles.itemTitle}>
                How did your visit with {apt.provider_name ?? apt.title} go?
              </Text>
              <Text style={styles.itemMeta}>
                {new Date(apt.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' \u2022 '}
                {APPOINTMENT_TYPE_LABELS[apt.appointment_type]}
              </Text>
              <View style={styles.closeoutActions}>
                <TouchableOpacity
                  style={styles.closeoutPrimary}
                  onPress={() => router.push(`/(main)/appointments/${apt.id}/closeout`)}
                >
                  <Text style={styles.closeoutPrimaryText}>Start Closeout</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.closeoutSecondary}
                  onPress={() => router.push(`/(main)/appointments/${apt.id}/closeout`)}
                >
                  <Text style={styles.closeoutSecondaryText}>Didn't happen</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ))}

          {/* High-priority profile gaps */}
          {highGaps.map((gap) => (
            <Card
              key={gap.id}
              style={styles.itemCard}
              onPress={() => router.push(`/(main)/profile/${activeProfileId}/strengthen`)}
            >
              <View style={styles.itemRow}>
                <Ionicons name="alert-circle" size={20} color={COLORS.accent.dark} />
                <View style={[styles.itemContent, { marginLeft: 10 }]}>
                  <Text style={styles.itemTitle}>{gap.prompt_text}</Text>
                  <Text style={styles.itemMeta}>{gap.impact_text}</Text>
                </View>
              </View>
            </Card>
          ))}
        </View>
      )}

      {/* ALL CLEAR */}
      {relevantTasks.length === 0 &&
        scheduledDoses.length === 0 &&
        todayAppointments.length === 0 &&
        needsCloseout.length === 0 &&
        highGaps.length === 0 && (
          <View style={styles.allClear}>
            <Ionicons name="checkmark-circle" size={48} color={COLORS.success.DEFAULT} />
            <Text style={styles.allClearTitle}>All caught up!</Text>
            <Text style={styles.allClearSubtitle}>Nothing needs your attention right now.</Text>
          </View>
        )}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
    marginTop: -8,
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemCard: {
    marginBottom: 8,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  itemTitleDone: {
    textDecorationLine: 'line-through',
    color: COLORS.text.tertiary,
  },
  itemMeta: {
    fontSize: 13,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  overdueText: {
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Medication dose actions
  doseActions: {
    flexDirection: 'row',
    gap: 8,
  },
  takeButton: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  takeButtonText: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: '#FFFFFF',
  },
  skipButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  skipButtonText: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.tertiary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  takenBadge: {
    backgroundColor: COLORS.success.light,
  },
  skippedBadge: {
    backgroundColor: COLORS.surface.muted,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: FONT_WEIGHTS.medium,
  },
  takenText: {
    color: COLORS.success.DEFAULT,
  },
  skippedText: {
    color: COLORS.text.tertiary,
  },

  // Prep label
  prepLabel: {
    fontSize: 12,
    fontWeight: FONT_WEIGHTS.semibold,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  // Task check
  taskCheck: {
    marginRight: 12,
  },
  taskCheckCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.border.dark,
  },
  taskCheckOverdue: {
    borderColor: COLORS.error.DEFAULT,
  },

  // Closeout
  closeoutActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  closeoutPrimary: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeoutPrimaryText: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: '#FFFFFF',
  },
  closeoutSecondary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  closeoutSecondaryText: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },

  // All clear
  allClear: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  allClearTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  allClearSubtitle: {
    fontSize: 15,
    color: COLORS.text.secondary,
  },
});
