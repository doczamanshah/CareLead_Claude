import { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { usePreventiveItems } from '@/hooks/usePreventive';
import { useWellnessVisitStore } from '@/stores/wellnessVisitStore';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { PreventiveItemWithRule } from '@/lib/types/preventive';

// Rule codes that can be completed during an office visit (BP, BMI, PHQ-9,
// tobacco/alcohol screening, etc.). Others need separate scheduling.
const IN_VISIT_CODES = new Set<string>([
  'bp_screening',
  'bmi_screening',
  'depression_screening',
  'tobacco_screening',
  'alcohol_screening',
  'annual_wellness_visit',
  'medication_review',
]);

function isInVisitItem(item: PreventiveItemWithRule): boolean {
  return IN_VISIT_CODES.has(item.rule.code);
}

export default function PreventiveAgendaScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const { data: items, isLoading } = usePreventiveItems(activeProfileId);
  const hydrate = useWellnessVisitStore((s) => s.hydrate);
  const hydrated = useWellnessVisitStore((s) => s.hydrated);
  const selected = useWellnessVisitStore((s) => s.selectedScreenings);
  const toggleScreening = useWellnessVisitStore((s) => s.toggleScreening);
  const setSelectedScreenings = useWellnessVisitStore(
    (s) => s.setSelectedScreenings,
  );
  const markStepCompleted = useWellnessVisitStore((s) => s.markStepCompleted);
  const addQuestions = useWellnessVisitStore((s) => s.addQuestions);
  const questions = useWellnessVisitStore((s) => s.questions);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const actionable = useMemo(
    () =>
      (items ?? []).filter(
        (i) =>
          i.status === 'due' ||
          i.status === 'due_soon' ||
          i.status === 'needs_review',
      ),
    [items],
  );

  const { inVisit, separateSchedule } = useMemo(() => {
    const a: PreventiveItemWithRule[] = [];
    const b: PreventiveItemWithRule[] = [];
    for (const i of actionable) {
      if (isInVisitItem(i)) a.push(i);
      else b.push(i);
    }
    return { inVisit: a, separateSchedule: b };
  }, [actionable]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const handleSelectAll = useCallback(() => {
    setSelectedScreenings(actionable.map((i) => i.id));
  }, [actionable, setSelectedScreenings]);

  const handleDone = useCallback(() => {
    // Generate questions for each selected "discuss scheduling for" item
    // so they show up in the Questions step.
    const existingTexts = new Set(
      questions.map((q) => q.text.toLowerCase().trim()),
    );
    const newQs: Parameters<typeof addQuestions>[0] = [];
    for (const id of selected) {
      const item = actionable.find((x) => x.id === id);
      if (!item) continue;
      if (isInVisitItem(item)) continue;
      const text = `Should I schedule a ${item.rule.title.toLowerCase()}?`;
      const key = text.toLowerCase().trim();
      if (existingTexts.has(key)) continue;
      existingTexts.add(key);
      newQs.push({
        text,
        priority: 'medium',
        category: 'screenings',
        source: 'preventive_agenda',
      });
    }
    if (newQs.length > 0) addQuestions(newQs);
    markStepCompleted('preventive_agenda', true);
    router.back();
  }, [selected, actionable, addQuestions, markStepCompleted, questions, router]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
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
        <Text style={styles.title}>Screenings to discuss</Text>
        <Text style={styles.subtitle}>
          Pick what you want to cover at this visit. Anything that needs a
          separate appointment becomes a question for your doctor.
        </Text>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
      >
        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={COLORS.primary.DEFAULT} />
          </View>
        ) : actionable.length === 0 ? (
          <Card>
            <View style={styles.emptyRow}>
              <Ionicons
                name="checkmark-circle"
                size={22}
                color={COLORS.success.DEFAULT}
              />
              <Text style={styles.emptyText}>
                You're all caught up on preventive screenings. Nothing to add
                to your visit agenda.
              </Text>
            </View>
          </Card>
        ) : (
          <>
            <View style={styles.selectAllRow}>
              <Text style={styles.selectAllText}>
                {selected.length} of {actionable.length} selected
              </Text>
              <TouchableOpacity onPress={handleSelectAll} activeOpacity={0.7}>
                <Text style={styles.selectAllButton}>Select all due items</Text>
              </TouchableOpacity>
            </View>

            {inVisit.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>
                  CAN BE DONE AT THIS VISIT
                </Text>
                {inVisit.map((item) => (
                  <ScreeningRow
                    key={item.id}
                    item={item}
                    checked={selectedSet.has(item.id)}
                    onToggle={() => toggleScreening(item.id)}
                  />
                ))}
              </>
            )}

            {separateSchedule.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>
                  DISCUSS SCHEDULING FOR
                </Text>
                {separateSchedule.map((item) => (
                  <ScreeningRow
                    key={item.id}
                    item={item}
                    checked={selectedSet.has(item.id)}
                    onToggle={() => toggleScreening(item.id)}
                  />
                ))}
              </>
            )}
          </>
        )}

        {actionable.length > 0 && (
          <TouchableOpacity
            style={styles.doneButton}
            onPress={handleDone}
            activeOpacity={0.8}
          >
            <Text style={styles.doneButtonText}>
              {selected.length === 0
                ? 'Skip for now'
                : `Add ${selected.length} to my agenda`}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ScreeningRow({
  item,
  checked,
  onToggle,
}: {
  item: PreventiveItemWithRule;
  checked: boolean;
  onToggle: () => void;
}) {
  const statusLabel =
    item.status === 'due'
      ? 'Due'
      : item.status === 'due_soon'
      ? 'Coming up'
      : 'Needs review';

  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      style={[rowStyles.card, checked && rowStyles.cardChecked]}
    >
      <View style={[rowStyles.checkbox, checked && rowStyles.checkboxChecked]}>
        {checked && (
          <Ionicons name="checkmark" size={14} color={COLORS.text.inverse} />
        )}
      </View>
      <View style={rowStyles.body}>
        <Text style={rowStyles.title}>{item.rule.title}</Text>
        <Text style={rowStyles.meta}>{statusLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  cardChecked: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '0A',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.border.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
  },
  body: { flex: 1 },
  title: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  meta: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
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
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40, paddingTop: 16 },
  loadingWrap: { alignItems: 'center', paddingVertical: 40 },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emptyText: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    lineHeight: 21,
  },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  selectAllText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  selectAllButton: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 12,
  },
  doneButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: COLORS.primary.DEFAULT,
  },
  doneButtonText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
