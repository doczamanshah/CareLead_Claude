/**
 * RefillChangeSheet
 *
 * Bottom-sheet modal that asks "Did anything change?" right after a user
 * marks a medication as refilled. The fast path — Same as before — is the
 * top option and one tap. Anything else expands inline so the whole
 * micro-capture stays in this sheet (no navigating away).
 *
 * The host screen owns the cooldown gate (see `shouldPromptChangeCheck`).
 * This component just renders + collects + dispatches.
 */

import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  FREQUENCY_LABELS,
  type MedicationFrequency,
} from '@/lib/types/medications';
import type {
  RefillChangeDetails,
  RefillChangeType,
} from '@/services/medicationRefillCheck';

type Branch =
  | null
  | 'dose'
  | 'pharmacy'
  | 'doctor'
  | 'doctor_switch'
  | 'doctor_add'
  | 'doctor_stop'
  | 'other';

interface RefillChangeSheetProps {
  visible: boolean;
  /** Display only — used in copy. */
  medicationName: string;
  currentDoseText: string | null;
  currentFrequencyText: string | null;
  currentPharmacyName: string | null;
  busy: boolean;
  onSubmit: (changeType: RefillChangeType, details?: RefillChangeDetails) => void;
  onDismiss: () => void;
}

const FREQ_OPTIONS: MedicationFrequency[] = [
  'once_daily',
  'twice_daily',
  'three_times_daily',
  'as_needed',
  'other',
];

export function RefillChangeSheet({
  visible,
  medicationName,
  currentDoseText,
  currentFrequencyText,
  currentPharmacyName,
  busy,
  onSubmit,
  onDismiss,
}: RefillChangeSheetProps) {
  const [branch, setBranch] = useState<Branch>(null);

  // Dose branch
  const [newDose, setNewDose] = useState('');
  const [newFreq, setNewFreq] = useState<MedicationFrequency | null>(null);

  // Pharmacy branch
  const [newPharmacy, setNewPharmacy] = useState('');
  const [newPharmacyPhone, setNewPharmacyPhone] = useState('');

  // Doctor branches
  const [newMedName, setNewMedName] = useState('');
  const [newMedDose, setNewMedDose] = useState('');
  const [newMedFreq, setNewMedFreq] = useState<MedicationFrequency | null>(null);
  const [stopReason, setStopReason] = useState('');

  // Other branch
  const [otherNote, setOtherNote] = useState('');

  function reset() {
    setBranch(null);
    setNewDose('');
    setNewFreq(null);
    setNewPharmacy('');
    setNewPharmacyPhone('');
    setNewMedName('');
    setNewMedDose('');
    setNewMedFreq(null);
    setStopReason('');
    setOtherNote('');
  }

  function handleClose() {
    reset();
    onDismiss();
  }

  function submitNoChange() {
    onSubmit('no_change');
    reset();
  }

  function submitDose() {
    if (!newDose.trim() && !newFreq) {
      Alert.alert('Add a change', 'Enter a new dose or pick a new frequency.');
      return;
    }
    onSubmit('dose_change', {
      newDose: newDose.trim() || undefined,
      newFrequencyText: newFreq ? FREQUENCY_LABELS[newFreq] : undefined,
    });
    reset();
  }

  function submitPharmacy() {
    if (!newPharmacy.trim()) {
      Alert.alert('Add the pharmacy', 'Enter the new pharmacy name.');
      return;
    }
    onSubmit('pharmacy_change', {
      newPharmacyName: newPharmacy.trim(),
      newPharmacyPhone: newPharmacyPhone.trim() || undefined,
    });
    reset();
  }

  function submitSwitch() {
    if (!newMedName.trim()) {
      Alert.alert('Name the new medication', 'What was prescribed instead?');
      return;
    }
    onSubmit('switched', {
      newMedication: {
        drug_name: newMedName.trim(),
        dose_text: newMedDose.trim() || undefined,
        frequency: newMedFreq ?? undefined,
      },
    });
    reset();
  }

  function submitAdd() {
    if (!newMedName.trim()) {
      Alert.alert('Name the new medication', 'What was added?');
      return;
    }
    onSubmit('added', {
      newMedication: {
        drug_name: newMedName.trim(),
        dose_text: newMedDose.trim() || undefined,
        frequency: newMedFreq ?? undefined,
      },
    });
    reset();
  }

  function submitStop() {
    onSubmit('stopped', { stopReason: stopReason.trim() || undefined });
    reset();
  }

  function submitOther() {
    if (!otherNote.trim()) {
      Alert.alert('Add a note', 'Briefly describe what changed.');
      return;
    }
    onSubmit('other', { note: otherNote.trim() });
    reset();
  }

  const currentSummary = [
    currentDoseText ?? null,
    currentFrequencyText ?? null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerIconWrap}>
                <Ionicons name="sparkles" size={20} color={COLORS.primary.DEFAULT} />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.title}>Did anything change?</Text>
                <Text style={styles.subtitle} numberOfLines={2}>
                  {medicationName}
                  {currentSummary ? ` · ${currentSummary}` : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={8}
                accessibilityLabel="Close"
                disabled={busy}
              >
                <Ionicons name="close" size={22} color={COLORS.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Same as before — fast path, primary visual weight */}
              {branch === null && (
                <>
                  <TouchableOpacity
                    style={[styles.choice, styles.choicePrimary]}
                    activeOpacity={0.7}
                    disabled={busy}
                    onPress={submitNoChange}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={22}
                      color={COLORS.success.DEFAULT}
                    />
                    <View style={styles.choiceTextWrap}>
                      <Text style={styles.choiceTitle}>Same as before</Text>
                      <Text style={styles.choiceSub}>
                        Refill recorded. Nothing else to update.
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={COLORS.text.tertiary} />
                  </TouchableOpacity>

                  <ChoiceRow
                    icon="resize-outline"
                    title="Dose changed"
                    sub="New strength, instructions, or frequency"
                    onPress={() => setBranch('dose')}
                  />
                  <ChoiceRow
                    icon="storefront-outline"
                    title="Different pharmacy"
                    sub="Picked it up somewhere new"
                    onPress={() => setBranch('pharmacy')}
                  />
                  <ChoiceRow
                    icon="medical-outline"
                    title="Doctor changed the medication"
                    sub="Switched, added, or stopped"
                    onPress={() => setBranch('doctor')}
                  />
                  <ChoiceRow
                    icon="ellipsis-horizontal-circle-outline"
                    title="Something else"
                    sub="Quick note about this refill"
                    onPress={() => setBranch('other')}
                  />
                </>
              )}

              {branch === 'dose' && (
                <BranchPanel title="What's the new dose?" onBack={() => setBranch(null)}>
                  <Input
                    label="New dose"
                    placeholder={currentDoseText ?? 'e.g., 20mg'}
                    value={newDose}
                    onChangeText={setNewDose}
                    autoFocus
                  />
                  <Text style={styles.fieldLabel}>New frequency (optional)</Text>
                  <FrequencyChips selected={newFreq} onSelect={setNewFreq} />
                  <View style={styles.actionRow}>
                    <Button title="Save change" onPress={submitDose} loading={busy} />
                  </View>
                </BranchPanel>
              )}

              {branch === 'pharmacy' && (
                <BranchPanel title="Where did you fill it?" onBack={() => setBranch(null)}>
                  <Input
                    label="Pharmacy name"
                    placeholder={currentPharmacyName ?? 'e.g., CVS on Main St'}
                    value={newPharmacy}
                    onChangeText={setNewPharmacy}
                    autoFocus
                  />
                  <Input
                    label="Phone (optional)"
                    placeholder="Pharmacy phone"
                    value={newPharmacyPhone}
                    onChangeText={setNewPharmacyPhone}
                    keyboardType="phone-pad"
                  />
                  <View style={styles.actionRow}>
                    <Button title="Save change" onPress={submitPharmacy} loading={busy} />
                  </View>
                </BranchPanel>
              )}

              {branch === 'doctor' && (
                <BranchPanel title="What did the doctor change?" onBack={() => setBranch(null)}>
                  <ChoiceRow
                    icon="swap-horizontal-outline"
                    title="Switched to a different medication"
                    sub="Old med stops, new med starts"
                    onPress={() => setBranch('doctor_switch')}
                  />
                  <ChoiceRow
                    icon="add-circle-outline"
                    title="Added a new medication"
                    sub="Keeping this one, plus a new one"
                    onPress={() => setBranch('doctor_add')}
                  />
                  <ChoiceRow
                    icon="stop-circle-outline"
                    title="Stopped this medication"
                    sub="No more refills needed"
                    onPress={() => setBranch('doctor_stop')}
                  />
                </BranchPanel>
              )}

              {branch === 'doctor_switch' && (
                <BranchPanel title="What was prescribed instead?" onBack={() => setBranch('doctor')}>
                  <Input
                    label="New medication"
                    placeholder="e.g., Atorvastatin"
                    value={newMedName}
                    onChangeText={setNewMedName}
                    autoCapitalize="words"
                    autoFocus
                  />
                  <Input
                    label="Dose (optional)"
                    placeholder="e.g., 20mg"
                    value={newMedDose}
                    onChangeText={setNewMedDose}
                  />
                  <Text style={styles.fieldLabel}>Frequency (optional)</Text>
                  <FrequencyChips selected={newMedFreq} onSelect={setNewMedFreq} />
                  <View style={styles.actionRow}>
                    <Button title="Save switch" onPress={submitSwitch} loading={busy} />
                  </View>
                </BranchPanel>
              )}

              {branch === 'doctor_add' && (
                <BranchPanel title="What was added?" onBack={() => setBranch('doctor')}>
                  <Input
                    label="New medication"
                    placeholder="e.g., Metformin"
                    value={newMedName}
                    onChangeText={setNewMedName}
                    autoCapitalize="words"
                    autoFocus
                  />
                  <Input
                    label="Dose (optional)"
                    placeholder="e.g., 500mg"
                    value={newMedDose}
                    onChangeText={setNewMedDose}
                  />
                  <Text style={styles.fieldLabel}>Frequency (optional)</Text>
                  <FrequencyChips selected={newMedFreq} onSelect={setNewMedFreq} />
                  <View style={styles.actionRow}>
                    <Button title="Add medication" onPress={submitAdd} loading={busy} />
                  </View>
                </BranchPanel>
              )}

              {branch === 'doctor_stop' && (
                <BranchPanel title="Stopping this medication" onBack={() => setBranch('doctor')}>
                  <Input
                    label="Reason (optional)"
                    placeholder="Why is it being stopped?"
                    value={stopReason}
                    onChangeText={setStopReason}
                    autoFocus
                  />
                  <View style={styles.actionRow}>
                    <Button title="Stop medication" onPress={submitStop} loading={busy} />
                  </View>
                </BranchPanel>
              )}

              {branch === 'other' && (
                <BranchPanel title="What changed?" onBack={() => setBranch(null)}>
                  <TextInput
                    style={styles.notesInput}
                    placeholder="Quick note — we'll save it on this medication."
                    placeholderTextColor={COLORS.text.tertiary}
                    value={otherNote}
                    onChangeText={setOtherNote}
                    multiline
                    autoFocus
                    textAlignVertical="top"
                  />
                  <View style={styles.actionRow}>
                    <Button title="Save note" onPress={submitOther} loading={busy} />
                  </View>
                </BranchPanel>
              )}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface ChoiceRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  onPress: () => void;
}
function ChoiceRow({ icon, title, sub, onPress }: ChoiceRowProps) {
  return (
    <TouchableOpacity style={styles.choice} activeOpacity={0.7} onPress={onPress}>
      <View style={styles.choiceIconBubble}>
        <Ionicons name={icon} size={18} color={COLORS.primary.DEFAULT} />
      </View>
      <View style={styles.choiceTextWrap}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={COLORS.text.tertiary} />
    </TouchableOpacity>
  );
}

interface BranchPanelProps {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}
function BranchPanel({ title, onBack, children }: BranchPanelProps) {
  return (
    <View style={styles.branchPanel}>
      <View style={styles.branchHeader}>
        <TouchableOpacity onPress={onBack} hitSlop={8} style={styles.branchBack}>
          <Ionicons name="chevron-back" size={18} color={COLORS.primary.DEFAULT} />
          <Text style={styles.branchBackText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.branchTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

interface FrequencyChipsProps {
  selected: MedicationFrequency | null;
  onSelect: (f: MedicationFrequency | null) => void;
}
function FrequencyChips({ selected, onSelect }: FrequencyChipsProps) {
  return (
    <View style={styles.chipRow}>
      {FREQ_OPTIONS.map((f) => (
        <TouchableOpacity
          key={f}
          style={[styles.chip, selected === f && styles.chipSelected]}
          onPress={() => onSelect(selected === f ? null : f)}
          activeOpacity={0.7}
        >
          <Text style={[styles.chipText, selected === f && styles.chipTextSelected]}>
            {FREQUENCY_LABELS[f]}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 24,
    paddingHorizontal: 20,
    maxHeight: '88%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  headerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },
  scroll: {
    maxHeight: 480,
  },
  scrollContent: {
    paddingBottom: 8,
    gap: 8,
  },

  // Choice rows
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface.muted,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  choicePrimary: {
    backgroundColor: COLORS.success.DEFAULT + '14',
    borderWidth: 1,
    borderColor: COLORS.success.DEFAULT + '33',
  },
  choiceIconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceTextWrap: {
    flex: 1,
    gap: 2,
  },
  choiceTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  choiceSub: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },

  // Branch panel
  branchPanel: {
    gap: 8,
  },
  branchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  branchBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingRight: 8,
  },
  branchBackText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  branchTitle: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },

  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
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
    color: '#FFFFFF',
  },
  notesInput: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    minHeight: 90,
  },
  actionRow: {
    marginTop: 12,
  },
});
