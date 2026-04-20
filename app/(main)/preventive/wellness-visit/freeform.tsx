import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useProfileDetail } from '@/hooks/useProfileDetail';
import { useMedications } from '@/hooks/useMedications';
import { useWellnessVisitStore } from '@/stores/wellnessVisitStore';
import { extractWellnessInput } from '@/services/wellnessVisit';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  WellnessExtraction,
  WellnessQuestion,
  WellnessQuestionCategory,
} from '@/lib/types/wellnessVisit';
import { QUESTION_CATEGORY_LABELS } from '@/lib/types/wellnessVisit';

const PROMPT_CHIPS: { label: string; seed: string }[] = [
  { label: 'New symptoms', seed: "I've been experiencing " },
  { label: 'Medication concerns', seed: 'Regarding my medications, ' },
  { label: 'Pain or discomfort', seed: "I've been having pain " },
  { label: 'Mental health', seed: "I've been feeling " },
  { label: 'Sleep issues', seed: 'My sleep has been ' },
  { label: 'Diet & exercise', seed: 'For diet and exercise, ' },
  { label: 'Family changes', seed: 'Something changed at home: ' },
  { label: 'Insurance changes', seed: 'My insurance changed: ' },
];

const PLACEHOLDER =
  "For example: 'My blood pressure has been running high at home, around 150/90. I've been having more knee pain and want to discuss options. I think I need to get my eyes checked for diabetes. Also wondering if I should get the shingles vaccine.'";

export default function WellnessFreeformScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const { data: profile } = useProfileDetail(activeProfileId);
  const { data: meds } = useMedications(activeProfileId);

  const hydrated = useWellnessVisitStore((s) => s.hydrated);
  const hydrate = useWellnessVisitStore((s) => s.hydrate);
  const freeformInput = useWellnessVisitStore((s) => s.freeformInput);
  const extractedData = useWellnessVisitStore((s) => s.extractedData);
  const setFreeformInput = useWellnessVisitStore((s) => s.setFreeformInput);
  const setExtractedData = useWellnessVisitStore((s) => s.setExtractedData);
  const markStepCompleted = useWellnessVisitStore((s) => s.markStepCompleted);
  const addQuestions = useWellnessVisitStore((s) => s.addQuestions);
  const questions = useWellnessVisitStore((s) => s.questions);

  const [processing, setProcessing] = useState(false);
  const [text, setText] = useState(freeformInput);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (hydrated) setText(freeformInput);
  }, [hydrated, freeformInput]);

  const handleInsertChip = useCallback(
    (seed: string) => {
      setText((prior) => {
        const next = prior.trim().length > 0 ? `${prior.trim()}\n\n${seed}` : seed;
        return next;
      });
    },
    [],
  );

  const conditionNames: string[] = (profile?.facts ?? [])
    .filter((f) => f.category === 'condition')
    .map((f) => {
      const v = f.value_json as Record<string, unknown>;
      const name = v.condition_name ?? v.name;
      return typeof name === 'string' ? name : null;
    })
    .filter((x): x is string => !!x);

  const medNames: string[] = (meds ?? [])
    .filter((m) => m.status === 'active')
    .map((m) => m.drug_name);

  const handleProcess = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    setProcessing(true);
    try {
      // Persist the latest freeform text first.
      setFreeformInput(trimmed);

      const res = await extractWellnessInput({
        text: trimmed,
        profileName: profile?.display_name ?? null,
        existingConditions: conditionNames,
        existingMedications: medNames,
      });

      if (!res.success) {
        Alert.alert(
          'Could not process',
          res.error ?? 'Please try again in a moment.',
        );
        return;
      }

      setExtractedData(res.data);

      // Auto-add extracted questions to the running questions list so the user
      // sees them on the Questions step. De-dup against already-added text.
      const existingTexts = new Set(
        questions.map((q) => q.text.toLowerCase().trim()),
      );

      const fromFreeform: Omit<WellnessQuestion, 'id'>[] = [];
      for (const q of res.data.questions_for_doctor ?? []) {
        const key = q.question.toLowerCase().trim();
        if (existingTexts.has(key)) continue;
        existingTexts.add(key);
        fromFreeform.push({
          text: q.question,
          priority: q.priority,
          category: normalizeCategory(q.category),
          source: 'freeform',
        });
      }
      // Turn medication concerns into questions too.
      for (const c of res.data.medication_concerns ?? []) {
        const text = c.medication
          ? `About ${c.medication}: ${c.concern}`
          : c.concern;
        const key = text.toLowerCase().trim();
        if (existingTexts.has(key)) continue;
        existingTexts.add(key);
        fromFreeform.push({
          text,
          priority: 'medium',
          category: 'medications',
          source: 'medication_concern',
        });
      }

      if (fromFreeform.length > 0) addQuestions(fromFreeform);

      markStepCompleted('freeform', true);
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Processing failed.',
      );
    } finally {
      setProcessing(false);
    }
  }, [
    text,
    profile?.display_name,
    conditionNames,
    medNames,
    questions,
    setFreeformInput,
    setExtractedData,
    addQuestions,
    markStepCompleted,
  ]);

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
          <Text style={styles.title}>What's on your mind?</Text>
          <Text style={styles.subtitle}>
            Tell us anything about your health that's changed, concerns you have,
            or questions for your doctor. Take your time.
          </Text>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            style={styles.textArea}
            value={text}
            onChangeText={setText}
            placeholder={PLACEHOLDER}
            placeholderTextColor={COLORS.text.tertiary}
            multiline
            textAlignVertical="top"
            autoCorrect
          />

          <Text style={styles.chipHeading}>Need a nudge? Tap a topic:</Text>
          <View style={styles.chipRow}>
            {PROMPT_CHIPS.map((c) => (
              <TouchableOpacity
                key={c.label}
                style={styles.chip}
                onPress={() => handleInsertChip(c.seed)}
                activeOpacity={0.7}
              >
                <Text style={styles.chipText}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {extractedData && (
            <ExtractionReview extraction={extractedData} />
          )}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.processButton,
              (processing || text.trim().length === 0) &&
                styles.processButtonDisabled,
            ]}
            onPress={handleProcess}
            disabled={processing || text.trim().length === 0}
            activeOpacity={0.8}
          >
            {processing ? (
              <ActivityIndicator color={COLORS.text.inverse} size="small" />
            ) : (
              <>
                <Ionicons name="sparkles" size={16} color={COLORS.text.inverse} />
                <Text style={styles.processButtonText}>
                  {extractedData ? 'Reprocess' : 'Process'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ExtractionReview({ extraction }: { extraction: WellnessExtraction }) {
  const sections: { key: string; title: string; count: number; lines: string[] }[] = [
    {
      key: 'symptoms',
      title: 'New symptoms',
      count: extraction.new_symptoms?.length ?? 0,
      lines: (extraction.new_symptoms ?? []).map(
        (s) =>
          `${s.description}${s.duration ? ` (${s.duration})` : ''}${s.severity ? ` — ${s.severity}` : ''}`,
      ),
    },
    {
      key: 'meds',
      title: 'Medication concerns',
      count: extraction.medication_concerns?.length ?? 0,
      lines: (extraction.medication_concerns ?? []).map((c) =>
        c.medication ? `${c.medication}: ${c.concern}` : c.concern,
      ),
    },
    {
      key: 'conditions',
      title: 'Condition updates',
      count: extraction.condition_updates?.length ?? 0,
      lines: (extraction.condition_updates ?? []).map(
        (u) =>
          `${u.condition} (${u.update_type})${u.detail ? ` — ${u.detail}` : ''}`,
      ),
    },
    {
      key: 'questions',
      title: 'Questions we added for your doctor',
      count: extraction.questions_for_doctor?.length ?? 0,
      lines: (extraction.questions_for_doctor ?? []).map((q) => q.question),
    },
    {
      key: 'lifestyle',
      title: 'Lifestyle changes',
      count: extraction.lifestyle_changes?.length ?? 0,
      lines: (extraction.lifestyle_changes ?? []).map(
        (l) => `${l.area}: ${l.detail}`,
      ),
    },
    {
      key: 'screenings',
      title: 'Screenings you asked about',
      count: extraction.screening_requests?.length ?? 0,
      lines: (extraction.screening_requests ?? []).map((s) =>
        s.reason ? `${s.screening} — ${s.reason}` : s.screening,
      ),
    },
    {
      key: 'other',
      title: 'Other concerns',
      count: extraction.other_concerns?.length ?? 0,
      lines: extraction.other_concerns ?? [],
    },
    {
      key: 'profileChanges',
      title: 'Profile updates you mentioned',
      count: extraction.profile_updates_suggested?.length ?? 0,
      lines: (extraction.profile_updates_suggested ?? []).map(
        (u) => `${u.action} ${u.category}: ${u.detail}`,
      ),
    },
  ].filter((s) => s.count > 0);

  if (sections.length === 0) {
    return (
      <Card style={reviewStyles.card}>
        <Text style={reviewStyles.emptyText}>
          We didn't find anything specific yet — try adding a bit more detail
          above.
        </Text>
      </Card>
    );
  }

  return (
    <View style={reviewStyles.wrap}>
      <Text style={reviewStyles.heading}>Here's what we understood:</Text>
      {sections.map((s) => (
        <Card key={s.key} style={reviewStyles.card}>
          <Text style={reviewStyles.sectionTitle}>{s.title}</Text>
          {s.lines.map((line, i) => (
            <View key={`${s.key}-${i}`} style={reviewStyles.lineRow}>
              <Ionicons
                name="ellipse"
                size={6}
                color={COLORS.text.tertiary}
                style={{ marginTop: 8 }}
              />
              <Text style={reviewStyles.lineText}>{line}</Text>
            </View>
          ))}
        </Card>
      ))}
      <Text style={reviewStyles.footnote}>
        Added questions appear in your "Your questions" step. Profile updates
        will be confirmed during your profile review.
      </Text>
    </View>
  );
}

function normalizeCategory(raw: string): WellnessQuestionCategory {
  const v = (raw ?? '').toLowerCase();
  if (v in QUESTION_CATEGORY_LABELS) return v as WellnessQuestionCategory;
  if (v.includes('sympt')) return 'symptoms';
  if (v.includes('med')) return 'medications';
  if (v.includes('screen')) return 'screenings';
  if (v.includes('life') || v.includes('diet') || v.includes('exercise'))
    return 'lifestyle';
  return 'general';
}

const reviewStyles = StyleSheet.create({
  wrap: { marginTop: 20, gap: 10 },
  heading: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  card: { marginTop: 0 },
  sectionTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 6,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 2,
  },
  lineText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  emptyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  footnote: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 8,
    fontStyle: 'italic',
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
  scrollContent: { paddingHorizontal: 24, paddingBottom: 20 },
  textArea: {
    marginTop: 16,
    minHeight: 180,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    padding: 14,
    backgroundColor: COLORS.surface.DEFAULT,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },
  chipHeading: {
    marginTop: 16,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  chipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    backgroundColor: COLORS.background.DEFAULT,
  },
  processButton: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  processButtonDisabled: { opacity: 0.5 },
  processButtonText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
