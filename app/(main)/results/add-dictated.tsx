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
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateResult, useTriggerExtraction } from '@/hooks/useResults';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { ResultType } from '@/lib/types/results';
import { RESULT_TYPE_LABELS } from '@/lib/types/results';

const TYPES: ResultType[] = ['lab', 'imaging', 'other'];

function todayLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AddDictatedResultScreen() {
  const router = useRouter();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const createResult = useCreateResult();
  const triggerExtraction = useTriggerExtraction();

  const [resultType, setResultType] = useState<ResultType>('lab');
  const [testName, setTestName] = useState('');
  const [freeText, setFreeText] = useState('');

  async function handleSave() {
    if (!activeProfileId || !activeProfile) return;
    if (!freeText.trim()) {
      Alert.alert('Nothing to save', 'Please describe the results before saving.');
      return;
    }

    const resolvedName = testName.trim() || `New Result — ${todayLabel()}`;

    try {
      const result = await createResult.mutateAsync({
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
        resultType,
        testName: resolvedName,
        sourceMethod: 'dictated',
        rawText: freeText.trim(),
      });
      triggerExtraction.mutate({
        resultId: result.id,
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
        resultType,
        rawText: freeText.trim(),
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
            <Text style={styles.backText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Dictate Result</Text>
          <Text style={styles.subtitle}>
            Tap the mic on your keyboard to dictate, or just type.
          </Text>
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
            label="Test Name (Optional)"
            placeholder="Leave blank to auto-name later"
            value={testName}
            onChangeText={setTestName}
            autoCapitalize="words"
          />

          <View style={styles.promptRow}>
            <Ionicons name="mic-outline" size={16} color={COLORS.text.secondary} />
            <Text style={styles.promptText}>Describe your results</Text>
          </View>
          <TextInput
            style={styles.freeInput}
            placeholder={
              "My A1c came back at 6.8%, doctor said it's well controlled. Cholesterol was 210 total, LDL 130, HDL 55."
            }
            placeholderTextColor={COLORS.text.tertiary}
            value={freeText}
            onChangeText={setFreeText}
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
  backButton: { marginBottom: 8 },
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
    marginTop: 4,
    lineHeight: 20,
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
  chipRow: { flexDirection: 'row', gap: 8 },
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
  promptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  promptText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  freeInput: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    minHeight: 150,
    lineHeight: 22,
  },
  saveContainer: {
    marginTop: 24,
  },
});
