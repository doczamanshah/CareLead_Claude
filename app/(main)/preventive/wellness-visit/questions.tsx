import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useWellnessVisitStore } from '@/stores/wellnessVisitStore';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  QUESTION_CATEGORY_LABELS,
  type WellnessQuestion,
  type WellnessQuestionCategory,
  type WellnessQuestionPriority,
} from '@/lib/types/wellnessVisit';

const PRIORITY_CYCLE: WellnessQuestionPriority[] = ['high', 'medium', 'low'];

function nextPriority(p: WellnessQuestionPriority): WellnessQuestionPriority {
  const idx = PRIORITY_CYCLE.indexOf(p);
  return PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length];
}

const PRIORITY_COLOR: Record<WellnessQuestionPriority, string> = {
  high: COLORS.error.DEFAULT,
  medium: COLORS.warning.DEFAULT,
  low: COLORS.text.tertiary,
};

export default function QuestionsScreen() {
  const router = useRouter();
  const hydrate = useWellnessVisitStore((s) => s.hydrate);
  const hydrated = useWellnessVisitStore((s) => s.hydrated);
  const questions = useWellnessVisitStore((s) => s.questions);
  const addQuestion = useWellnessVisitStore((s) => s.addQuestion);
  const updateQuestion = useWellnessVisitStore((s) => s.updateQuestion);
  const removeQuestion = useWellnessVisitStore((s) => s.removeQuestion);
  const reorderQuestions = useWellnessVisitStore((s) => s.reorderQuestions);
  const markStepCompleted = useWellnessVisitStore((s) => s.markStepCompleted);

  const [newText, setNewText] = useState('');

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const handleAdd = useCallback(() => {
    const text = newText.trim();
    if (!text) return;
    addQuestion({
      text,
      priority: 'medium',
      category: 'general',
      source: 'manual',
    });
    setNewText('');
  }, [newText, addQuestion]);

  const handleMove = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const ids = questions.map((q) => q.id);
      const idx = ids.indexOf(id);
      if (idx < 0) return;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= ids.length) return;
      const next = [...ids];
      [next[idx], next[target]] = [next[target], next[idx]];
      reorderQuestions(next);
    },
    [questions, reorderQuestions],
  );

  const handleCyclePriority = useCallback(
    (q: WellnessQuestion) => {
      updateQuestion(q.id, { priority: nextPriority(q.priority) });
    },
    [updateQuestion],
  );

  const handleRemove = useCallback(
    (id: string) => {
      Alert.alert('Remove question?', 'This removes it from your visit packet.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeQuestion(id),
        },
      ]);
    },
    [removeQuestion],
  );

  const handleEditText = useCallback(
    (q: WellnessQuestion, text: string) => {
      updateQuestion(q.id, { text });
    },
    [updateQuestion],
  );

  const handleDone = useCallback(() => {
    markStepCompleted('questions', questions.length > 0);
    router.back();
  }, [markStepCompleted, questions.length, router]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons
              name="chevron-back"
              size={22}
              color={COLORS.primary.DEFAULT}
            />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Questions for your doctor</Text>
          <Text style={styles.subtitle}>
            Reorder by priority. Most important at the top.
          </Text>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {questions.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>
                No questions yet. Add one below — or start the "Share what's on
                your mind" step to generate them from your own words.
              </Text>
            </Card>
          ) : (
            questions.map((q, idx) => (
              <QuestionCard
                key={q.id}
                question={q}
                isFirst={idx === 0}
                isLast={idx === questions.length - 1}
                onMove={(dir) => handleMove(q.id, dir)}
                onCyclePriority={() => handleCyclePriority(q)}
                onRemove={() => handleRemove(q.id)}
                onEditText={(t) => handleEditText(q, t)}
              />
            ))
          )}

          <Card style={styles.addCard}>
            <Text style={styles.addLabel}>Add a question</Text>
            <TextInput
              style={styles.addInput}
              value={newText}
              onChangeText={setNewText}
              placeholder="What do you want to ask?"
              placeholderTextColor={COLORS.text.tertiary}
              multiline
            />
            <TouchableOpacity
              style={[
                styles.addButton,
                newText.trim().length === 0 && styles.addButtonDisabled,
              ]}
              onPress={handleAdd}
              disabled={newText.trim().length === 0}
              activeOpacity={0.8}
            >
              <Ionicons
                name="add"
                size={16}
                color={COLORS.text.inverse}
              />
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </Card>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={handleDone}
            activeOpacity={0.8}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function QuestionCard({
  question,
  isFirst,
  isLast,
  onMove,
  onCyclePriority,
  onRemove,
  onEditText,
}: {
  question: WellnessQuestion;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onCyclePriority: () => void;
  onRemove: () => void;
  onEditText: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(question.text);

  const commitEdit = () => {
    setEditing(false);
    if (draft.trim()) onEditText(draft.trim());
    else setDraft(question.text);
  };

  return (
    <Card style={qStyles.card}>
      <View style={qStyles.topRow}>
        <TouchableOpacity
          onPress={onCyclePriority}
          activeOpacity={0.7}
          style={[
            qStyles.priorityPill,
            { backgroundColor: PRIORITY_COLOR[question.priority] + '20' },
          ]}
        >
          <Ionicons
            name="flag"
            size={12}
            color={PRIORITY_COLOR[question.priority]}
          />
          <Text
            style={[
              qStyles.priorityText,
              { color: PRIORITY_COLOR[question.priority] },
            ]}
          >
            {question.priority}
          </Text>
        </TouchableOpacity>
        <View style={qStyles.categoryPill}>
          <Text style={qStyles.categoryText}>
            {QUESTION_CATEGORY_LABELS[question.category]}
          </Text>
        </View>
        <View style={qStyles.actions}>
          <TouchableOpacity
            onPress={() => onMove('up')}
            disabled={isFirst}
            style={[qStyles.actionButton, isFirst && qStyles.actionButtonDisabled]}
            activeOpacity={0.7}
          >
            <Ionicons
              name="arrow-up"
              size={16}
              color={isFirst ? COLORS.text.tertiary : COLORS.primary.DEFAULT}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onMove('down')}
            disabled={isLast}
            style={[qStyles.actionButton, isLast && qStyles.actionButtonDisabled]}
            activeOpacity={0.7}
          >
            <Ionicons
              name="arrow-down"
              size={16}
              color={isLast ? COLORS.text.tertiary : COLORS.primary.DEFAULT}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onRemove}
            style={qStyles.actionButton}
            activeOpacity={0.7}
          >
            <Ionicons
              name="close"
              size={16}
              color={COLORS.error.DEFAULT}
            />
          </TouchableOpacity>
        </View>
      </View>

      {editing ? (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={commitEdit}
          multiline
          autoFocus
          style={qStyles.editInput}
        />
      ) : (
        <TouchableOpacity onPress={() => setEditing(true)} activeOpacity={0.7}>
          <Text style={qStyles.questionText}>{question.text}</Text>
        </TouchableOpacity>
      )}
    </Card>
  );
}

const qStyles = StyleSheet.create({
  card: { marginBottom: 8 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  priorityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  priorityText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'capitalize',
  },
  categoryPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.surface.muted,
    flex: 1,
    alignSelf: 'flex-start',
  },
  categoryText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  actions: { flexDirection: 'row', gap: 4 },
  actionButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLORS.surface.muted,
  },
  actionButtonDisabled: { opacity: 0.4 },
  questionText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },
  editInput: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
    minHeight: 48,
    padding: 6,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT,
    borderRadius: 8,
  },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  flex: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
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
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 8,
    lineHeight: 20,
  },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 16 },
  emptyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  addCard: { marginTop: 16 },
  addLabel: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  addInput: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 10,
    padding: 10,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    textAlignVertical: 'top',
  },
  addButton: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT,
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
  },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    backgroundColor: COLORS.background.DEFAULT,
  },
  doneButton: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneButtonText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
