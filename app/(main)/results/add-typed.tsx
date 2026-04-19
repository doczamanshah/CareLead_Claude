import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateResult, useTriggerExtraction } from '@/hooks/useResults';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { ResultType } from '@/lib/types/results';
import { RESULT_TYPE_LABELS } from '@/lib/types/results';

const TYPES: ResultType[] = ['lab', 'imaging', 'other'];

function toDateString(date: Date): string {
  // YYYY-MM-DD in local time
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function AddTypedResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    resultType?: string;
    prefillTestName?: string;
  }>();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const createResult = useCreateResult();
  const triggerExtraction = useTriggerExtraction();

  // Honor Ask gap action prefills: pre-select the type chip and the test
  // name field. Both are still editable.
  const initialType: ResultType =
    params.resultType === 'lab' ||
    params.resultType === 'imaging' ||
    params.resultType === 'other'
      ? params.resultType
      : 'lab';

  const [resultType, setResultType] = useState<ResultType>(initialType);
  const [testName, setTestName] = useState(params.prefillTestName ?? '');
  const [performedAt, setPerformedAt] = useState<Date | null>(null);
  const [facility, setFacility] = useState('');
  const [clinician, setClinician] = useState('');
  const [reportText, setReportText] = useState('');

  async function handleSave() {
    if (!activeProfileId || !activeProfile) return;
    if (!testName.trim()) {
      Alert.alert('Test name required', 'Please enter the name of the test or report.');
      return;
    }
    if (!reportText.trim()) {
      Alert.alert('Report text required', 'Please enter or paste the result text.');
      return;
    }

    try {
      const result = await createResult.mutateAsync({
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
        resultType,
        testName: testName.trim(),
        performedAt: performedAt ? toDateString(performedAt) : null,
        facility: facility.trim() || null,
        orderingClinician: clinician.trim() || null,
        sourceMethod: 'typed',
        rawText: reportText.trim(),
      });
      triggerExtraction.mutate({
        resultId: result.id,
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
        resultType,
        rawText: reportText.trim(),
      });
      router.replace(`/(main)/results/${result.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save result';
      Alert.alert('Error', msg);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={18} color={COLORS.primary.DEFAULT} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Type or Paste Result</Text>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.fieldLabel}>Result Type</Text>
          <View style={styles.chipRow}>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, resultType === t && styles.chipSelected]}
                onPress={() => setResultType(t)}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.chipText, resultType === t && styles.chipTextSelected]}
                >
                  {RESULT_TYPE_LABELS[t]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.spacer} />

          <Input
            label="Test Name"
            placeholder="e.g., Complete Blood Count, CT Abdomen, EKG"
            value={testName}
            onChangeText={setTestName}
            autoCapitalize="words"
          />

          <DatePicker
            label="Date Performed"
            mode="date"
            value={performedAt}
            onChange={setPerformedAt}
            placeholder="Optional"
            maximumDate={new Date()}
          />

          <Input
            label="Facility"
            placeholder="Optional — e.g., Quest Diagnostics"
            value={facility}
            onChangeText={setFacility}
          />

          <Input
            label="Ordering Clinician"
            placeholder="Optional — e.g., Dr. Smith"
            value={clinician}
            onChangeText={setClinician}
          />

          <Text style={styles.fieldLabel}>Report Text</Text>
          <TextInput
            style={styles.reportInput}
            placeholder="Paste or type the result text here..."
            placeholderTextColor={COLORS.text.tertiary}
            value={reportText}
            onChangeText={setReportText}
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
          />

          <View style={styles.saveContainer}>
            <Button
              title="Save"
              onPress={handleSave}
              loading={createResult.isPending}
              size="lg"
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
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    alignSelf: 'flex-start',
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
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  chipSelected: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
  },
  chipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  chipTextSelected: { color: COLORS.text.inverse },
  spacer: { height: 16 },
  reportInput: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    minHeight: 200,
    lineHeight: 22,
  },
  saveContainer: {
    marginTop: 24,
  },
});
