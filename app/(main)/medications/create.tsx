import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateMedication } from '@/hooks/useMedications';
import { useCreateNoteArtifact } from '@/hooks/useArtifacts';
import { useTriggerExtraction } from '@/hooks/useIntentSheet';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { MedicationForm, MedicationRoute, MedicationFrequency } from '@/lib/types/medications';
import { FORM_LABELS, ROUTE_LABELS, FREQUENCY_LABELS } from '@/lib/types/medications';

const FORMS: MedicationForm[] = ['tablet', 'capsule', 'liquid', 'cream', 'injection', 'inhaler', 'patch', 'drops', 'other'];
const ROUTES: MedicationRoute[] = ['oral', 'topical', 'injection', 'inhaled', 'sublingual', 'other'];
const FREQUENCIES: MedicationFrequency[] = [
  'once_daily', 'twice_daily', 'three_times_daily', 'four_times_daily',
  'every_morning', 'every_evening', 'at_bedtime', 'as_needed', 'other',
];

const SUGGESTION_CHIPS = [
  'I take...',
  'My doctor prescribed...',
  'I get it from...',
];

type Step = 'input' | 'extracting' | 'form';

interface ExtractedFields {
  drug_name: string;
  strength: string;
  form: MedicationForm | null;
  route: MedicationRoute | null;
  dose_text: string;
  frequency: MedicationFrequency | null;
  frequency_text: string;
  instructions: string;
  pharmacy_name: string;
  prescriber_name: string;
  last_fill_date: string;
  days_supply: string;
  refills_remaining: string;
}

const EMPTY_FIELDS: ExtractedFields = {
  drug_name: '',
  strength: '',
  form: null,
  route: null,
  dose_text: '',
  frequency: null,
  frequency_text: '',
  instructions: '',
  pharmacy_name: '',
  prescriber_name: '',
  last_fill_date: '',
  days_supply: '',
  refills_remaining: '',
};

function parseFrequency(text: string): MedicationFrequency | null {
  const lower = text.toLowerCase();
  if (/once\s*(a\s*)?daily|one\s*time/.test(lower)) return 'once_daily';
  if (/twice\s*(a\s*)?daily|two\s*times|2\s*times/.test(lower)) return 'twice_daily';
  if (/three\s*times|3\s*times/.test(lower)) return 'three_times_daily';
  if (/four\s*times|4\s*times/.test(lower)) return 'four_times_daily';
  if (/every\s*morning/.test(lower)) return 'every_morning';
  if (/every\s*evening|every\s*night/.test(lower)) return 'every_evening';
  if (/bedtime|at\s*night|before\s*bed/.test(lower)) return 'at_bedtime';
  if (/as\s*needed|prn/.test(lower)) return 'as_needed';
  return null;
}

function parseForm(text: string): MedicationForm | null {
  const lower = text.toLowerCase();
  if (/tablet/i.test(lower)) return 'tablet';
  if (/capsule/i.test(lower)) return 'capsule';
  if (/liquid|solution|syrup/i.test(lower)) return 'liquid';
  if (/cream|ointment|gel/i.test(lower)) return 'cream';
  if (/inject/i.test(lower)) return 'injection';
  if (/inhal/i.test(lower)) return 'inhaler';
  if (/patch/i.test(lower)) return 'patch';
  if (/drop/i.test(lower)) return 'drops';
  return null;
}

function parseRoute(text: string): MedicationRoute | null {
  const lower = text.toLowerCase();
  if (/oral|by\s*mouth|po\b/i.test(lower)) return 'oral';
  if (/topical/i.test(lower)) return 'topical';
  if (/inject|im\b|iv\b|subcut/i.test(lower)) return 'injection';
  if (/inhal/i.test(lower)) return 'inhaled';
  if (/sublingual|under.*tongue/i.test(lower)) return 'sublingual';
  return null;
}

export default function CreateMedicationScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const createMedication = useCreateMedication();
  const createNoteMutation = useCreateNoteArtifact();
  const extractionMutation = useTriggerExtraction();

  const [step, setStep] = useState<Step>('input');
  const [freeText, setFreeText] = useState('');
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [fields, setFields] = useState<ExtractedFields>({ ...EMPTY_FIELDS });
  const [aiFilledKeys, setAiFilledKeys] = useState<Set<string>>(new Set());
  const [showSupply, setShowSupply] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const hasText = freeText.trim().length > 0;
  const canSave = fields.drug_name.trim().length > 0 && !createMedication.isPending;

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setIsKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setIsKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  function handleChipTap(chip: string) {
    setFreeText(chip + ' ');
    inputRef.current?.focus();
  }

  function handleManualEntry() {
    setStep('form');
    setFields({ ...EMPTY_FIELDS });
    setAiFilledKeys(new Set());
  }

  async function handleExtract() {
    if (!hasText || !activeProfileId) return;

    Keyboard.dismiss();
    setStep('extracting');

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const title = `medication-note-${timestamp}`;

      const artifact = await createNoteMutation.mutateAsync({
        profileId: activeProfileId,
        title,
        text: freeText.trim(),
        sourceChannel: 'voice',
      });

      const extraction = await extractionMutation.mutateAsync({
        artifactId: artifact.id,
        profileId: activeProfileId,
      });

      // Try to parse the intent sheet items into medication fields
      if (extraction.intentSheetId) {
        const { fetchIntentSheetWithItems } = await import('@/services/extraction');
        const result = await fetchIntentSheetWithItems(extraction.intentSheetId);

        if (result.success && result.data.items.length > 0) {
          const filled: ExtractedFields = { ...EMPTY_FIELDS };
          const filledKeys = new Set<string>();

          for (const item of result.data.items) {
            const val = item.proposed_value;
            if (typeof val === 'object' && val !== null) {
              const obj = val as Record<string, unknown>;

              if (obj.drug_name && typeof obj.drug_name === 'string') {
                filled.drug_name = obj.drug_name;
                filledKeys.add('drug_name');
              }
              if (obj.dose && typeof obj.dose === 'string') {
                filled.strength = obj.dose;
                filledKeys.add('strength');
              }
              if (obj.strength && typeof obj.strength === 'string') {
                filled.strength = obj.strength;
                filledKeys.add('strength');
              }
              if (obj.frequency && typeof obj.frequency === 'string') {
                filled.frequency_text = obj.frequency;
                filled.frequency = parseFrequency(obj.frequency);
                filledKeys.add('frequency');
              }
              if (obj.route && typeof obj.route === 'string') {
                filled.route = parseRoute(obj.route);
                filledKeys.add('route');
              }
              if (obj.form && typeof obj.form === 'string') {
                filled.form = parseForm(obj.form);
                filledKeys.add('form');
              }
              if (obj.instructions && typeof obj.instructions === 'string') {
                filled.instructions = obj.instructions;
                filledKeys.add('instructions');
              }
              if (obj.pharmacy && typeof obj.pharmacy === 'string') {
                filled.pharmacy_name = obj.pharmacy;
                filledKeys.add('pharmacy_name');
              }
              if (obj.pharmacy_name && typeof obj.pharmacy_name === 'string') {
                filled.pharmacy_name = obj.pharmacy_name;
                filledKeys.add('pharmacy_name');
              }
              if (obj.prescriber && typeof obj.prescriber === 'string') {
                filled.prescriber_name = obj.prescriber;
                filledKeys.add('prescriber_name');
              }
              if (obj.prescriber_name && typeof obj.prescriber_name === 'string') {
                filled.prescriber_name = obj.prescriber_name;
                filledKeys.add('prescriber_name');
              }
              if (obj.last_fill_date && typeof obj.last_fill_date === 'string') {
                filled.last_fill_date = obj.last_fill_date;
                filledKeys.add('last_fill_date');
              }
              if (obj.refills_remaining != null) {
                filled.refills_remaining = String(obj.refills_remaining);
                filledKeys.add('refills_remaining');
              }
              if (obj.days_supply != null) {
                filled.days_supply = String(obj.days_supply);
                filledKeys.add('days_supply');
              }
            } else if (typeof val === 'string' && item.field_key === 'medication') {
              // Simple string value — treat as drug name
              filled.drug_name = val;
              filledKeys.add('drug_name');
            }
          }

          // If no structured extraction, try simple parsing from the free text
          if (!filled.drug_name) {
            filled.drug_name = parseDrugNameFromText(freeText);
            if (filled.drug_name) filledKeys.add('drug_name');
          }

          const hasSupplyFields = filled.pharmacy_name || filled.prescriber_name ||
            filled.last_fill_date || filled.days_supply || filled.refills_remaining;

          setFields(filled);
          setAiFilledKeys(filledKeys);
          setShowSupply(!!hasSupplyFields);
          setStep('form');
          return;
        }
      }

      // Fallback: basic text parsing if extraction didn't return structured data
      const parsed = parseFromFreeText(freeText);
      const parsedKeys = new Set<string>();
      if (parsed.drug_name) parsedKeys.add('drug_name');
      if (parsed.strength) parsedKeys.add('strength');
      if (parsed.frequency) parsedKeys.add('frequency');
      if (parsed.pharmacy_name) parsedKeys.add('pharmacy_name');
      if (parsed.prescriber_name) parsedKeys.add('prescriber_name');

      setFields({ ...EMPTY_FIELDS, ...parsed });
      setAiFilledKeys(parsedKeys);
      setStep('form');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Extraction failed';
      Alert.alert('Could not parse medication info', message + '\n\nYou can fill in the fields manually.');
      setStep('form');
    }
  }

  function handleSave() {
    if (!activeProfileId || !canSave) return;

    const isPrn = fields.frequency === 'as_needed';

    createMedication.mutate(
      {
        profile_id: activeProfileId,
        drug_name: fields.drug_name.trim(),
        strength: fields.strength.trim() || undefined,
        form: fields.form ?? undefined,
        route: fields.route ?? undefined,
        prn_flag: isPrn,
        dose_text: fields.dose_text.trim() || undefined,
        frequency_text: fields.frequency
          ? FREQUENCY_LABELS[fields.frequency]
          : fields.frequency_text.trim() || undefined,
        instructions: fields.instructions.trim() || undefined,
        pharmacy_name: fields.pharmacy_name.trim() || undefined,
        prescriber_name: fields.prescriber_name.trim() || undefined,
        last_fill_date: fields.last_fill_date.trim() || undefined,
        days_supply: fields.days_supply ? Number(fields.days_supply) : undefined,
        refills_remaining: fields.refills_remaining ? Number(fields.refills_remaining) : undefined,
      },
      {
        onSuccess: () => router.back(),
      },
    );
  }

  // ── STEP 1: Free text input ──────────────────────────────────────────────
  if (step === 'input') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <Text style={styles.backText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleManualEntry}>
                <Text style={styles.manualEntryText}>Manual entry</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.title}>Add Medication</Text>
            <Text style={styles.subtitle}>
              Tell CareLead about this medication — speak or type
            </Text>
          </View>

          <View style={styles.flex}>
            {/* Text area */}
            <View style={styles.inputWrapper}>
              {hasText && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={() => {
                    Alert.alert('Clear Text', 'Discard your current text?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Discard', style: 'destructive', onPress: () => setFreeText('') },
                    ]);
                  }}
                >
                  <Text style={styles.clearButtonText}>Clear</Text>
                </TouchableOpacity>
              )}
              <TextInput
                ref={inputRef}
                style={styles.freeTextInput}
                value={freeText}
                onChangeText={setFreeText}
                placeholder="I take metformin 500mg twice a day. Dr. Smith prescribed it. I get it from CVS pharmacy on Main Street. It was last filled on March 15 with 2 refills remaining."
                placeholderTextColor={COLORS.text.tertiary}
                multiline
                textAlignVertical="top"
                blurOnSubmit={false}
              />
            </View>

            {/* Suggestion chips — only when keyboard hidden and no text */}
            {!isKeyboardVisible && !hasText && (
              <View style={styles.chipsSection}>
                <Text style={styles.chipsLabel}>Try starting with:</Text>
                <View style={styles.chipsRow}>
                  {SUGGESTION_CHIPS.map((chip) => (
                    <TouchableOpacity
                      key={chip}
                      style={styles.suggestionChip}
                      onPress={() => handleChipTap(chip)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.suggestionChipText}>{chip}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <View style={styles.flex} />
          </View>

          {/* Bottom bar */}
          <View style={styles.bottomBar}>
            <Button
              title="Add Medication"
              onPress={handleExtract}
              disabled={!hasText || !activeProfileId}
              size="lg"
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── STEP: Extracting ─────────────────────────────────────────────────────
  if (step === 'extracting') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.extractingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
          <Text style={styles.extractingTitle}>Reading your medication info...</Text>
          <Text style={styles.extractingSubtitle}>
            CareLead is parsing what you wrote and filling in the details.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── STEP 2: Editable form (AI-filled or manual) ──────────────────────────
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <Text style={styles.backText}>Cancel</Text>
              </TouchableOpacity>
              {aiFilledKeys.size > 0 && (
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>AI-assisted</Text>
                </View>
              )}
            </View>
            <Text style={styles.title}>
              {aiFilledKeys.size > 0 ? 'Review & Save' : 'Add Medication'}
            </Text>
            {aiFilledKeys.size > 0 && (
              <Text style={styles.subtitle}>
                Fields marked with a dot were filled by AI. Edit anything before saving.
              </Text>
            )}
          </View>

          <View style={styles.form}>
            {/* Drug Name */}
            <FieldWithIndicator label="Drug Name *" filled={aiFilledKeys.has('drug_name')}>
              <Input
                placeholder="e.g., Lisinopril"
                value={fields.drug_name}
                onChangeText={(v) => setFields((f) => ({ ...f, drug_name: v }))}
              />
            </FieldWithIndicator>

            {/* Strength */}
            <FieldWithIndicator label="Strength" filled={aiFilledKeys.has('strength')}>
              <Input
                placeholder="e.g., 25mg"
                value={fields.strength}
                onChangeText={(v) => setFields((f) => ({ ...f, strength: v }))}
              />
            </FieldWithIndicator>

            {/* Form Picker */}
            <FieldWithIndicator label="Form" filled={aiFilledKeys.has('form')}>
              <View style={styles.chipRow}>
                {FORMS.map((form) => (
                  <TouchableOpacity
                    key={form}
                    style={[styles.chip, fields.form === form && styles.chipSelected]}
                    onPress={() => setFields((f) => ({ ...f, form: f.form === form ? null : form }))}
                  >
                    <Text style={[styles.chipText, fields.form === form && styles.chipTextSelected]}>
                      {FORM_LABELS[form]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </FieldWithIndicator>

            {/* Route Picker */}
            <FieldWithIndicator label="Route" filled={aiFilledKeys.has('route')}>
              <View style={styles.chipRow}>
                {ROUTES.map((route) => (
                  <TouchableOpacity
                    key={route}
                    style={[styles.chip, fields.route === route && styles.chipSelected]}
                    onPress={() => setFields((f) => ({ ...f, route: f.route === route ? null : route }))}
                  >
                    <Text style={[styles.chipText, fields.route === route && styles.chipTextSelected]}>
                      {ROUTE_LABELS[route]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </FieldWithIndicator>

            <View style={styles.divider} />

            {/* Dose */}
            <FieldWithIndicator label="Dose" filled={aiFilledKeys.has('dose_text')}>
              <Input
                placeholder="e.g., 1 tablet, 500mg, 10 units"
                value={fields.dose_text}
                onChangeText={(v) => setFields((f) => ({ ...f, dose_text: v }))}
              />
            </FieldWithIndicator>

            {/* Frequency Picker */}
            <FieldWithIndicator label="Frequency" filled={aiFilledKeys.has('frequency')}>
              <View style={styles.chipRow}>
                {FREQUENCIES.map((freq) => (
                  <TouchableOpacity
                    key={freq}
                    style={[styles.chip, fields.frequency === freq && styles.chipSelected]}
                    onPress={() => setFields((f) => ({ ...f, frequency: f.frequency === freq ? null : freq }))}
                  >
                    <Text style={[styles.chipText, fields.frequency === freq && styles.chipTextSelected]}>
                      {FREQUENCY_LABELS[freq]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </FieldWithIndicator>

            {/* Instructions */}
            <FieldWithIndicator label="Instructions" filled={aiFilledKeys.has('instructions')}>
              <Input
                placeholder="e.g., Take with food, avoid grapefruit"
                value={fields.instructions}
                onChangeText={(v) => setFields((f) => ({ ...f, instructions: v }))}
                multiline
                numberOfLines={2}
                style={styles.multilineInput}
              />
            </FieldWithIndicator>

            {/* Supply / Refill info toggle */}
            <TouchableOpacity
              onPress={() => setShowSupply(!showSupply)}
              style={styles.toggleRow}
            >
              <Text style={styles.toggleText}>
                {showSupply ? 'Hide' : 'Add'} refill details
              </Text>
            </TouchableOpacity>

            {showSupply && (
              <View style={styles.supplySection}>
                <FieldWithIndicator label="Pharmacy" filled={aiFilledKeys.has('pharmacy_name')}>
                  <Input
                    placeholder="e.g., CVS Pharmacy"
                    value={fields.pharmacy_name}
                    onChangeText={(v) => setFields((f) => ({ ...f, pharmacy_name: v }))}
                  />
                </FieldWithIndicator>

                <FieldWithIndicator label="Prescriber" filled={aiFilledKeys.has('prescriber_name')}>
                  <Input
                    placeholder="e.g., Dr. Smith"
                    value={fields.prescriber_name}
                    onChangeText={(v) => setFields((f) => ({ ...f, prescriber_name: v }))}
                  />
                </FieldWithIndicator>

                <FieldWithIndicator label="Last Fill Date" filled={aiFilledKeys.has('last_fill_date')}>
                  <Input
                    placeholder="YYYY-MM-DD"
                    value={fields.last_fill_date}
                    onChangeText={(v) => setFields((f) => ({ ...f, last_fill_date: v }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </FieldWithIndicator>

                <FieldWithIndicator label="Days Supply" filled={aiFilledKeys.has('days_supply')}>
                  <Input
                    placeholder="e.g., 30, 90"
                    value={fields.days_supply}
                    onChangeText={(v) => setFields((f) => ({ ...f, days_supply: v }))}
                    keyboardType="number-pad"
                  />
                </FieldWithIndicator>

                <FieldWithIndicator label="Refills Remaining" filled={aiFilledKeys.has('refills_remaining')}>
                  <Input
                    placeholder="e.g., 2"
                    value={fields.refills_remaining}
                    onChangeText={(v) => setFields((f) => ({ ...f, refills_remaining: v }))}
                    keyboardType="number-pad"
                  />
                </FieldWithIndicator>
              </View>
            )}

            {/* Save Button */}
            <View style={styles.buttonContainer}>
              <Button
                title="Save Medication"
                onPress={handleSave}
                disabled={!canSave}
                loading={createMedication.isPending}
                size="lg"
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Helper: AI-filled field indicator ──────────────────────────────────────

function FieldWithIndicator({
  label,
  filled,
  children,
}: {
  label: string;
  filled: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.fieldContainer}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.label}>{label}</Text>
        {filled && (
          <View style={styles.aiDot}>
            <Text style={styles.aiDotText}>AI filled</Text>
          </View>
        )}
      </View>
      {children}
    </View>
  );
}

// ── Helper: parse drug name from free text ─────────────────────────────────

function parseDrugNameFromText(text: string): string {
  const match = text.match(/(?:i\s+take|taking|prescribed)\s+(\w+)/i);
  return match?.[1] ?? '';
}

function parseFromFreeText(text: string): Partial<ExtractedFields> {
  const result: Partial<ExtractedFields> = {};

  const drugMatch = text.match(/(?:i\s+take|taking|prescribed|medication\s+is)\s+(\w+(?:\s+\d+\s*mg)?)/i);
  if (drugMatch) {
    const parts = drugMatch[1].split(/\s+/);
    result.drug_name = parts[0];
    if (parts.length > 1) result.strength = parts.slice(1).join(' ');
  }

  const freqMatch = parseFrequency(text);
  if (freqMatch) result.frequency = freqMatch;

  const pharmacyMatch = text.match(/(?:from|at|pharmacy(?:\s+is)?)\s+(.+?)(?:\.|,|$)/i);
  if (pharmacyMatch) result.pharmacy_name = pharmacyMatch[1].trim();

  const prescriberMatch = text.match(/(?:dr\.?\s+\w+|doctor\s+\w+)/i);
  if (prescriberMatch) result.prescriber_name = prescriberMatch[0].trim();

  return result;
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  backButton: {},
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  manualEntryText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  aiBadge: {
    backgroundColor: COLORS.secondary.DEFAULT + '20',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  aiBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.secondary.DEFAULT,
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
  // Free text input step
  inputWrapper: {
    marginHorizontal: 24,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    minHeight: 200,
    position: 'relative',
  },
  clearButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.surface.muted,
  },
  clearButtonText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  freeTextInput: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    padding: 16,
    paddingTop: 16,
    paddingRight: 70,
    minHeight: 200,
    lineHeight: 24,
  },
  chipsSection: {
    paddingHorizontal: 24,
    marginTop: 16,
  },
  chipsLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginBottom: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionChip: {
    backgroundColor: COLORS.primary.DEFAULT + '0A',
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '20',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  suggestionChipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
  },
  bottomBar: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    backgroundColor: COLORS.background.DEFAULT,
  },
  // Extracting step
  extractingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  extractingTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginTop: 20,
    textAlign: 'center',
  },
  extractingSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  // Form step
  form: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  fieldContainer: {
    marginBottom: 0,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 0,
    marginTop: 0,
  },
  aiDot: {
    marginLeft: 8,
    backgroundColor: COLORS.secondary.DEFAULT + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  aiDotText: {
    fontSize: 10,
    color: COLORS.secondary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
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
  chipTextSelected: {
    color: COLORS.text.inverse,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border.light,
    marginVertical: 16,
  },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  toggleRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  supplySection: {
    marginTop: 8,
  },
  buttonContainer: {
    marginTop: 24,
  },
});
