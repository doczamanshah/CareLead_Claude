import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useTaskDetail,
  useUpdateTaskStatus,
  useUpdateTask,
  useTaskChain,
  useHouseholdMembers,
} from '@/hooks/useTasks';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { TaskPriority, TaskStatus, Task } from '@/lib/types/tasks';
import { PRIORITY_LABELS } from '@/lib/types/tasks';

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: COLORS.error.DEFAULT,
  high: COLORS.tertiary.DEFAULT,
  medium: COLORS.accent.dark,
  low: COLORS.secondary.DEFAULT,
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manually created',
  intent_sheet: 'From document review',
  appointment: 'From appointment',
  medication: 'From medication',
  billing: 'From billing',
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manually created',
  extraction: 'AI-suggested from extraction',
  proactive: 'Proactive suggestion',
  time_based: 'Recurring task',
  chain: 'Part of action plan',
};

const PRIORITIES: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];

export default function TaskDetailScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const router = useRouter();
  const { activeProfile } = useActiveProfile();
  const { data: task, isLoading, error } = useTaskDetail(taskId ?? null);
  const updateStatus = useUpdateTaskStatus();
  const updateTask = useUpdateTask();

  // Fetch chain if this task is part of one
  const { data: chainTasks } = useTaskChain(task?.parent_task_id ?? null);

  // Fetch household members for assignment
  const { data: members } = useHouseholdMembers(activeProfile?.household_id ?? null);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState<TaskPriority>('medium');

  const startEditing = () => {
    if (!task) return;
    setEditTitle(task.title);
    setEditDescription(task.description ?? '');
    setEditPriority(task.priority);
    setIsEditing(true);
  };

  const saveEdits = () => {
    if (!task || !editTitle.trim()) return;

    const params: Record<string, unknown> = {};
    if (editTitle.trim() !== task.title) params.title = editTitle.trim();
    if ((editDescription.trim() || null) !== task.description) {
      params.description = editDescription.trim() || null;
    }
    if (editPriority !== task.priority) params.priority = editPriority;

    if (Object.keys(params).length > 0) {
      updateTask.mutate({ taskId: task.id, params });
    }
    setIsEditing(false);
  };

  const handleStatusChange = (status: TaskStatus) => {
    if (!task) return;

    if (status === 'dismissed') {
      Alert.alert('Dismiss Task', 'Are you sure you want to dismiss this task?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: () => {
            updateStatus.mutate({ taskId: task.id, status });
            router.back();
          },
        },
      ]);
      return;
    }

    updateStatus.mutate({ taskId: task.id, status });
    if (status === 'completed') router.back();
  };

  const handleAssign = (userId: string | null) => {
    if (!task) return;
    updateTask.mutate({
      taskId: task.id,
      params: { assigned_to_user_id: userId },
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>{'\u2039'} Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !task) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>{'\u2039'} Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Task not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isOpen = task.status === 'pending' || task.status === 'in_progress';
  const isBlocked = task.dependency_status === 'blocked';
  const overdue = task.due_date && isOpen && new Date(task.due_date) < new Date();
  const ctx = task.context_json;
  const hasContext = ctx && (ctx.call_script || ctx.contact_info || ctx.instructions || ctx.reference_numbers);
  const hasChain = chainTasks && chainTasks.length > 1;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Navigation bar */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'\u2039'} Back</Text>
        </TouchableOpacity>
        {isOpen && !isEditing && !isBlocked && (
          <TouchableOpacity onPress={startEditing} style={styles.editButton}>
            <Text style={styles.editText}>Edit</Text>
          </TouchableOpacity>
        )}
        {isEditing && (
          <TouchableOpacity onPress={saveEdits} style={styles.editButton}>
            <Text style={styles.editText}>Save</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Blocked banner */}
        {isBlocked && (
          <View style={styles.blockedBanner}>
            <Text style={styles.blockedBannerText}>
              This task is blocked — waiting for a previous step to complete.
            </Text>
          </View>
        )}

        {/* Title */}
        {isEditing ? (
          <TextInput
            style={styles.titleInput}
            value={editTitle}
            onChangeText={setEditTitle}
            placeholder="Task title"
            placeholderTextColor={COLORS.text.tertiary}
            autoFocus
          />
        ) : (
          <Text style={[styles.title, !isOpen && styles.titleDone]}>
            {task.title}
          </Text>
        )}

        {/* Status + badges row */}
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor:
                  task.status === 'completed'
                    ? COLORS.success.light
                    : task.status === 'dismissed'
                      ? COLORS.surface.muted
                      : task.status === 'in_progress'
                        ? COLORS.accent.light + '40'
                        : COLORS.primary.DEFAULT + '15',
              },
            ]}
          >
            <Text
              style={[
                styles.statusText,
                {
                  color:
                    task.status === 'completed'
                      ? COLORS.success.DEFAULT
                      : task.status === 'dismissed'
                        ? COLORS.text.tertiary
                        : task.status === 'in_progress'
                          ? COLORS.accent.dark
                          : COLORS.primary.DEFAULT,
                },
              ]}
            >
              {task.status === 'in_progress'
                ? 'In Progress'
                : task.status.charAt(0).toUpperCase() + task.status.slice(1)}
            </Text>
          </View>

          {task.trigger_type && task.trigger_type !== 'manual' && (
            <View style={styles.triggerBadge}>
              <Text style={styles.triggerBadgeText}>
                {TRIGGER_LABELS[task.trigger_type] ?? task.trigger_type}
              </Text>
            </View>
          )}

          {task.parent_task_id && task.chain_order && (
            <View style={styles.chainBadge}>
              <Text style={styles.chainBadgeText}>
                Step {task.chain_order}{hasChain ? ` of ${chainTasks!.length}` : ''}
              </Text>
            </View>
          )}
        </View>

        {/* Trigger source */}
        {task.trigger_source && (
          <Text style={styles.triggerSourceText}>{task.trigger_source}</Text>
        )}

        {/* Details section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Details</Text>

          {/* Description */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Description</Text>
            {isEditing ? (
              <TextInput
                style={styles.descriptionInput}
                value={editDescription}
                onChangeText={setEditDescription}
                placeholder="Add a description..."
                placeholderTextColor={COLORS.text.tertiary}
                multiline
                textAlignVertical="top"
              />
            ) : (
              <Text style={styles.fieldValue}>
                {task.description || 'No description'}
              </Text>
            )}
          </View>

          {/* Priority */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Priority</Text>
            {isEditing ? (
              <View style={styles.priorityPicker}>
                {PRIORITIES.map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.priorityOption,
                      editPriority === p && {
                        backgroundColor: PRIORITY_COLORS[p] + '20',
                        borderColor: PRIORITY_COLORS[p],
                      },
                    ]}
                    onPress={() => setEditPriority(p)}
                  >
                    <Text
                      style={[
                        styles.priorityOptionText,
                        editPriority === p && { color: PRIORITY_COLORS[p] },
                      ]}
                    >
                      {PRIORITY_LABELS[p]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.inlineBadgeRow}>
                <View
                  style={[
                    styles.inlineBadge,
                    { backgroundColor: PRIORITY_COLORS[task.priority] + '1A' },
                  ]}
                >
                  <Text
                    style={[
                      styles.inlineBadgeText,
                      { color: PRIORITY_COLORS[task.priority] },
                    ]}
                  >
                    {PRIORITY_LABELS[task.priority]}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Due date */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Due Date</Text>
            <Text style={[styles.fieldValue, overdue && styles.overdueText]}>
              {task.due_date
                ? new Date(task.due_date).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'No due date'}
              {overdue ? ' (Overdue)' : ''}
            </Text>
          </View>

          {/* Source */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Source</Text>
            <Text style={styles.fieldValue}>
              {SOURCE_LABELS[task.source_type] ?? task.source_type}
            </Text>
          </View>

          {/* Assignee */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Assigned To</Text>
            {members && members.length > 0 && isOpen ? (
              <View style={styles.assigneePicker}>
                <TouchableOpacity
                  style={[
                    styles.assigneeChip,
                    !task.assigned_to_user_id && styles.assigneeChipActive,
                  ]}
                  onPress={() => handleAssign(null)}
                >
                  <Text
                    style={[
                      styles.assigneeChipText,
                      !task.assigned_to_user_id && styles.assigneeChipTextActive,
                    ]}
                  >
                    Unassigned
                  </Text>
                </TouchableOpacity>
                {members.map((m) => (
                  <TouchableOpacity
                    key={m.user_id}
                    style={[
                      styles.assigneeChip,
                      task.assigned_to_user_id === m.user_id && styles.assigneeChipActive,
                    ]}
                    onPress={() => handleAssign(m.user_id)}
                  >
                    <View style={styles.assigneeAvatar}>
                      <Text style={styles.assigneeAvatarText}>
                        {m.display_name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.assigneeChipText,
                        task.assigned_to_user_id === m.user_id && styles.assigneeChipTextActive,
                      ]}
                    >
                      {m.display_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={styles.fieldValue}>
                {task.assigned_to_user_id
                  ? members?.find((m) => m.user_id === task.assigned_to_user_id)?.display_name ?? 'Assigned'
                  : 'Unassigned'}
              </Text>
            )}
          </View>
        </View>

        {/* Context section */}
        {hasContext && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Context & Instructions</Text>

            {/* Call script */}
            {ctx!.call_script && (
              <View style={styles.contextCard}>
                <Text style={styles.contextCardTitle}>Phone Script</Text>
                <Text style={styles.contextCardBody}>{ctx!.call_script}</Text>
              </View>
            )}

            {/* Contact info */}
            {ctx!.contact_info && (
              <View style={styles.contextCard}>
                <Text style={styles.contextCardTitle}>Contact</Text>
                <Text style={styles.contactName}>{ctx!.contact_info.name}</Text>
                {ctx!.contact_info.role && (
                  <Text style={styles.contactDetail}>{ctx!.contact_info.role}</Text>
                )}
                {ctx!.contact_info.phone && (
                  <Text style={styles.contactPhone}>{ctx!.contact_info.phone}</Text>
                )}
              </View>
            )}

            {/* Instructions */}
            {ctx!.instructions && ctx!.instructions.length > 0 && (
              <View style={styles.contextCard}>
                <Text style={styles.contextCardTitle}>Steps</Text>
                {ctx!.instructions.map((step, i) => (
                  <View key={i} style={styles.instructionRow}>
                    <View style={styles.instructionNumber}>
                      <Text style={styles.instructionNumberText}>{i + 1}</Text>
                    </View>
                    <Text style={styles.instructionText}>{step}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Reference numbers */}
            {ctx!.reference_numbers && ctx!.reference_numbers.length > 0 && (
              <View style={styles.contextCard}>
                <Text style={styles.contextCardTitle}>Reference Numbers</Text>
                {ctx!.reference_numbers.map((ref, i) => (
                  <Text key={i} style={styles.refNumber}>{ref}</Text>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Chain visualization */}
        {hasChain && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Action Plan</Text>
            <View style={styles.chainContainer}>
              {chainTasks!.map((ct, i) => {
                const isCurrent = ct.id === task.id;
                const isDone = ct.status === 'completed' || ct.status === 'dismissed';
                const ctBlocked = ct.dependency_status === 'blocked';

                return (
                  <TouchableOpacity
                    key={ct.id}
                    style={styles.chainStep}
                    onPress={() => {
                      if (ct.id !== task.id) {
                        router.push(`/(main)/tasks/${ct.id}`);
                      }
                    }}
                    disabled={ct.id === task.id}
                  >
                    {/* Connector line */}
                    {i > 0 && (
                      <View
                        style={[
                          styles.chainLine,
                          isDone && styles.chainLineDone,
                        ]}
                      />
                    )}

                    {/* Step indicator */}
                    <View
                      style={[
                        styles.chainDot,
                        isDone && styles.chainDotDone,
                        isCurrent && styles.chainDotCurrent,
                        ctBlocked && styles.chainDotBlocked,
                      ]}
                    >
                      {isDone ? (
                        <Text style={styles.chainDotCheckText}>{'\u2713'}</Text>
                      ) : (
                        <Text
                          style={[
                            styles.chainDotNumber,
                            isCurrent && styles.chainDotNumberCurrent,
                          ]}
                        >
                          {ct.chain_order}
                        </Text>
                      )}
                    </View>

                    {/* Step label */}
                    <View style={styles.chainLabelWrap}>
                      <Text
                        style={[
                          styles.chainLabel,
                          isCurrent && styles.chainLabelCurrent,
                          isDone && styles.chainLabelDone,
                          ctBlocked && styles.chainLabelBlocked,
                        ]}
                        numberOfLines={2}
                      >
                        {ct.title}
                      </Text>
                      {ctBlocked && (
                        <Text style={styles.chainStatusBlocked}>Blocked</Text>
                      )}
                      {isDone && (
                        <Text style={styles.chainStatusDone}>
                          {ct.status === 'completed' ? 'Done' : 'Dismissed'}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Timeline section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Timeline</Text>

          <View style={styles.timelineItem}>
            <View style={styles.timelineDot} />
            <View style={styles.timelineContent}>
              <Text style={styles.timelineEvent}>Created</Text>
              <Text style={styles.timelineDate}>
                {new Date(task.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          </View>

          {task.completed_at && (
            <View style={styles.timelineItem}>
              <View
                style={[
                  styles.timelineDot,
                  {
                    backgroundColor:
                      task.status === 'completed'
                        ? COLORS.success.DEFAULT
                        : COLORS.text.tertiary,
                  },
                ]}
              />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineEvent}>
                  {task.status === 'completed' ? 'Completed' : 'Dismissed'}
                </Text>
                <Text style={styles.timelineDate}>
                  {new Date(task.completed_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Action buttons */}
        {isOpen && !isEditing && (
          <View style={styles.actions}>
            {isBlocked ? (
              <View style={styles.blockedActions}>
                <Text style={styles.blockedActionsText}>
                  Complete the previous step to unlock this task.
                </Text>
              </View>
            ) : (
              <>
                {task.status === 'pending' && (
                  <Button
                    title="Start Working"
                    onPress={() => handleStatusChange('in_progress')}
                    variant="outline"
                  />
                )}
                <View style={styles.actionSpacer} />
                <Button
                  title="Mark Complete"
                  onPress={() => handleStatusChange('completed')}
                  variant="primary"
                />
                <View style={styles.actionSpacer} />
                <Button
                  title="Dismiss"
                  onPress={() => handleStatusChange('dismissed')}
                  variant="ghost"
                />
              </>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.error.DEFAULT,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 16,
  },
  backText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  editButton: {
    paddingVertical: 4,
    paddingLeft: 16,
  },
  editText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  blockedBanner: {
    backgroundColor: COLORS.warning.light,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 16,
  },
  blockedBannerText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.tertiary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
  },
  titleDone: {
    textDecorationLine: 'line-through',
    color: COLORS.text.tertiary,
  },
  titleInput: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.primary.DEFAULT,
    paddingBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  triggerBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '15',
  },
  triggerBadgeText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  chainBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.accent.DEFAULT + '20',
  },
  chainBadgeText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.accent.dark,
  },
  triggerSourceText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
    marginBottom: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  field: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    marginBottom: 4,
  },
  fieldValue: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
  },
  overdueText: {
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  descriptionInput: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT,
    borderRadius: 12,
    padding: 12,
    minHeight: 80,
  },
  priorityPicker: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityOption: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    alignItems: 'center',
  },
  priorityOptionText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
  },
  inlineBadgeRow: {
    flexDirection: 'row',
  },
  inlineBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  inlineBadgeText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  // Assignee picker
  assigneePicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  assigneeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  assigneeChipActive: {
    backgroundColor: COLORS.primary.DEFAULT + '15',
    borderColor: COLORS.primary.DEFAULT,
  },
  assigneeChipText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  assigneeChipTextActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  assigneeAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.secondary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  assigneeAvatarText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.inverse,
  },
  // Context cards
  contextCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  contextCardTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  contextCardBody: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },
  contactName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  contactDetail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  contactPhone: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    marginTop: 4,
  },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  instructionNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.primary.DEFAULT + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  instructionNumberText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
  },
  instructionText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    flex: 1,
    lineHeight: 22,
  },
  refNumber: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  // Chain visualization
  chainContainer: {
    paddingLeft: 4,
  },
  chainStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  chainLine: {
    position: 'absolute',
    left: 13,
    top: -12,
    width: 2,
    height: 16,
    backgroundColor: COLORS.border.dark,
  },
  chainLineDone: {
    backgroundColor: COLORS.success.DEFAULT,
  },
  chainDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.border.dark,
    backgroundColor: COLORS.surface.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  chainDotDone: {
    backgroundColor: COLORS.success.light,
    borderColor: COLORS.success.DEFAULT,
  },
  chainDotCurrent: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
  },
  chainDotBlocked: {
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.muted,
  },
  chainDotCheckText: {
    fontSize: 14,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.bold,
  },
  chainDotNumber: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.secondary,
  },
  chainDotNumberCurrent: {
    color: COLORS.text.inverse,
  },
  chainLabelWrap: {
    flex: 1,
    paddingTop: 3,
    paddingBottom: 8,
  },
  chainLabel: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  chainLabelCurrent: {
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
  },
  chainLabelDone: {
    color: COLORS.text.tertiary,
    textDecorationLine: 'line-through',
  },
  chainLabelBlocked: {
    color: COLORS.text.tertiary,
  },
  chainStatusBlocked: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  chainStatusDone: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
    marginTop: 2,
  },
  // Timeline
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary.DEFAULT,
    marginTop: 6,
    marginRight: 12,
  },
  timelineContent: {
    flex: 1,
  },
  timelineEvent: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  timelineDate: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  // Actions
  actions: {
    marginTop: 8,
  },
  actionSpacer: {
    height: 10,
  },
  blockedActions: {
    backgroundColor: COLORS.surface.muted,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  blockedActionsText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },
});
