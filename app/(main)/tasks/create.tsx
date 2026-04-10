import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateTask, useHouseholdMembers } from '@/hooks/useTasks';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { TaskPriority } from '@/lib/types/tasks';
import { PRIORITY_LABELS } from '@/lib/types/tasks';

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: COLORS.error.DEFAULT,
  high: COLORS.tertiary.DEFAULT,
  medium: COLORS.accent.dark,
  low: COLORS.secondary.DEFAULT,
};

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

const DUE_DATE_OPTIONS = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 Days', days: 3 },
  { label: 'In 1 Week', days: 7 },
  { label: 'In 2 Weeks', days: 14 },
  { label: 'No Due Date', days: -1 },
] as const;

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(17, 0, 0, 0); // Default to 5pm
  return date.toISOString();
}

export default function CreateTaskScreen() {
  const router = useRouter();
  const { activeProfileId, activeProfile } = useActiveProfile();
  const createTask = useCreateTask();
  const { data: members } = useHouseholdMembers(activeProfile?.household_id ?? null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [selectedDueDateIdx, setSelectedDueDateIdx] = useState<number | null>(null);
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [titleError, setTitleError] = useState('');

  const handleSave = () => {
    if (!title.trim()) {
      setTitleError('Title is required');
      return;
    }

    if (!activeProfileId) return;

    const dueDate =
      selectedDueDateIdx !== null && DUE_DATE_OPTIONS[selectedDueDateIdx].days >= 0
        ? addDays(DUE_DATE_OPTIONS[selectedDueDateIdx].days)
        : undefined;

    createTask.mutate(
      {
        profile_id: activeProfileId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        due_date: dueDate,
        assigned_to_user_id: assignedTo ?? undefined,
        trigger_type: 'manual',
      },
      {
        onSuccess: () => router.back(),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Navigation bar */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'\u2039'} Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>New Task</Text>
        <View style={styles.navSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {/* Title */}
        <Input
          label="Title"
          placeholder="What needs to be done?"
          value={title}
          onChangeText={(text) => {
            setTitle(text);
            if (titleError) setTitleError('');
          }}
          error={titleError}
          autoFocus
        />

        {/* Description */}
        <Input
          label="Description (optional)"
          placeholder="Add more details..."
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          style={styles.descriptionInput}
        />

        {/* Priority */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Priority</Text>
          <View style={styles.priorityRow}>
            {PRIORITIES.map((p) => (
              <TouchableOpacity
                key={p}
                style={[
                  styles.priorityChip,
                  priority === p && {
                    backgroundColor: PRIORITY_COLORS[p] + '20',
                    borderColor: PRIORITY_COLORS[p],
                  },
                ]}
                onPress={() => setPriority(p)}
              >
                <Text
                  style={[
                    styles.priorityChipText,
                    priority === p && { color: PRIORITY_COLORS[p] },
                  ]}
                >
                  {PRIORITY_LABELS[p]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Due date */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Due Date</Text>
          <View style={styles.dueDateGrid}>
            {DUE_DATE_OPTIONS.map((opt, idx) => (
              <TouchableOpacity
                key={opt.label}
                style={[
                  styles.dueDateChip,
                  selectedDueDateIdx === idx && styles.dueDateChipActive,
                ]}
                onPress={() =>
                  setSelectedDueDateIdx(selectedDueDateIdx === idx ? null : idx)
                }
              >
                <Text
                  style={[
                    styles.dueDateChipText,
                    selectedDueDateIdx === idx && styles.dueDateChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Assign to */}
        {members && members.length > 0 && (
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Assign To</Text>
            <View style={styles.assigneeRow}>
              <TouchableOpacity
                style={[
                  styles.assigneeChip,
                  assignedTo === null && styles.assigneeChipActive,
                ]}
                onPress={() => setAssignedTo(null)}
              >
                <Text
                  style={[
                    styles.assigneeChipText,
                    assignedTo === null && styles.assigneeChipTextActive,
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
                    assignedTo === m.user_id && styles.assigneeChipActive,
                  ]}
                  onPress={() => setAssignedTo(assignedTo === m.user_id ? null : m.user_id)}
                >
                  <View style={styles.assigneeAvatar}>
                    <Text style={styles.assigneeAvatarText}>
                      {m.display_name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.assigneeChipText,
                      assignedTo === m.user_id && styles.assigneeChipTextActive,
                    ]}
                  >
                    {m.display_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Save button */}
        <View style={styles.saveContainer}>
          <Button
            title="Create Task"
            onPress={handleSave}
            loading={createTask.isPending}
            disabled={!title.trim() || !activeProfileId}
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: { flex: 1 },
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
  navTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  navSpacer: {
    width: 60,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  descriptionInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  fieldGroup: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    alignItems: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
  },
  priorityChipText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
  },
  dueDateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dueDateChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  dueDateChipActive: {
    backgroundColor: COLORS.primary.DEFAULT + '15',
    borderColor: COLORS.primary.DEFAULT,
  },
  dueDateChipText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  dueDateChipTextActive: {
    color: COLORS.primary.DEFAULT,
  },
  assigneeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  assigneeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
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
  saveContainer: {
    marginTop: 24,
  },
});
