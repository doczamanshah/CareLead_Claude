import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { Button } from '@/components/ui/Button';
import {
  useMedicationDetail,
  useUpdateMedication,
  useUpdateMedicationStatus,
  useUpdateSupply,
  useLogAdherence,
} from '@/hooks/useMedications';
import { useUpdateSig } from '@/hooks/useMedications';
import {
  useMarkRefilled,
  useRecordRefillChangeCheck,
  shouldPromptChangeCheck,
} from '@/hooks/useMedicationRefillCheck';
import { RefillChangeSheet } from '@/components/RefillChangeSheet';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  AdherenceEvent,
  MedicationStatus,
  MedicationForm,
  MedicationRoute,
  MedicationFrequency,
} from '@/lib/types/medications';
import { FORM_LABELS, ROUTE_LABELS, FREQUENCY_LABELS } from '@/lib/types/medications';

const STATUS_COLORS: Record<MedicationStatus, string> = {
  active: COLORS.success.DEFAULT,
  paused: COLORS.accent.dark,
  stopped: COLORS.text.tertiary,
};

const ADHERENCE_DOT_COLORS: Record<string, string> = {
  taken: COLORS.success.DEFAULT,
  skipped: COLORS.error.DEFAULT,
  snoozed: COLORS.accent.dark,
  missed: COLORS.border.dark,
};

const FORMS: MedicationForm[] = ['tablet', 'capsule', 'liquid', 'cream', 'injection', 'inhaler', 'patch', 'drops', 'other'];
const ROUTES: MedicationRoute[] = ['oral', 'topical', 'injection', 'inhaled', 'sublingual', 'other'];
const FREQUENCIES: MedicationFrequency[] = [
  'once_daily', 'twice_daily', 'three_times_daily', 'four_times_daily',
  'every_morning', 'every_evening', 'at_bedtime', 'as_needed', 'other',
];

function parseFrequencyFromText(text: string): MedicationFrequency | null {
  const lower = text.toLowerCase();
  for (const [key, label] of Object.entries(FREQUENCY_LABELS)) {
    if (lower === label.toLowerCase()) return key as MedicationFrequency;
  }
  return null;
}

interface EditState {
  drug_name: string;
  strength: string;
  form: MedicationForm | null;
  route: MedicationRoute | null;
  dose_text: string;
  frequency: MedicationFrequency | null;
  instructions: string;
  pharmacy_name: string;
  prescriber_name: string;
  last_fill_date: string;
  days_supply: string;
  refills_remaining: string;
  notes: string;
}

export default function MedicationDetailScreen() {
  const { medicationId } = useLocalSearchParams<{ medicationId: string }>();
  const router = useRouter();
  const { data: med, isLoading, error } = useMedicationDetail(medicationId ?? null);
  const updateMed = useUpdateMedication();
  const updateStatus = useUpdateMedicationStatus();
  const updateSupplyMut = useUpdateSupply();
  const updateSigMut = useUpdateSig();
  const logAdherence = useLogAdherence();
  const markRefilled = useMarkRefilled();
  const recordChangeCheck = useRecordRefillChangeCheck();

  const [isEditing, setIsEditing] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [lastFillDatePicker, setLastFillDatePicker] = useState<Date | null>(null);
  const [changeSheetVisible, setChangeSheetVisible] = useState(false);

  if (isLoading || !med) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Failed to load medication</Text>
        </View>
      </SafeAreaView>
    );
  }

  const supply = med.supply;
  const sig = med.sig;

  // Compute estimated run-out date
  let runOutText: string | null = null;
  if (supply?.last_fill_date && supply?.days_supply) {
    const fillDate = new Date(supply.last_fill_date);
    const runOutDate = new Date(fillDate);
    runOutDate.setDate(runOutDate.getDate() + supply.days_supply);
    const daysRemaining = Math.ceil((runOutDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysRemaining < 0) {
      runOutText = `Ran out ${Math.abs(daysRemaining)} days ago`;
    } else {
      runOutText = `Estimated ${daysRemaining} days remaining (runs out ${runOutDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
    }
  }

  const adherenceByDay = getAdherenceByDay(med.recentAdherence);

  function startEditing() {
    if (!med) return;
    setEditState({
      drug_name: med.drug_name,
      strength: med.strength ?? '',
      form: med.form,
      route: med.route,
      dose_text: sig?.dose_text ?? '',
      frequency: parseFrequencyFromText(sig?.frequency_text ?? ''),
      instructions: sig?.instructions ?? '',
      pharmacy_name: supply?.pharmacy_name ?? '',
      prescriber_name: supply?.prescriber_name ?? '',
      last_fill_date: supply?.last_fill_date ?? '',
      days_supply: supply?.days_supply != null ? String(supply.days_supply) : '',
      refills_remaining: supply?.refills_remaining != null ? String(supply.refills_remaining) : '',
      notes: med.notes ?? '',
    });
    setLastFillDatePicker(
      supply?.last_fill_date ? new Date(supply.last_fill_date) : null,
    );
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setEditState(null);
    setLastFillDatePicker(null);
  }

  async function saveEdits() {
    if (!editState || !medicationId) return;

    const isSaving = updateMed.isPending || updateSupplyMut.isPending || updateSigMut.isPending;
    if (isSaving) return;

    try {
      // Update medication base fields
      await updateMed.mutateAsync({
        medicationId,
        params: {
          drug_name: editState.drug_name.trim() || undefined,
          strength: editState.strength.trim() || null,
          form: editState.form,
          route: editState.route,
          prn_flag: editState.frequency === 'as_needed' ? true : undefined,
          notes: editState.notes.trim() || null,
        },
      });

      // Update sig
      const frequencyText = editState.frequency
        ? FREQUENCY_LABELS[editState.frequency]
        : sig?.frequency_text ?? null;

      await updateSigMut.mutateAsync({
        medicationId,
        params: {
          dose_text: editState.dose_text.trim() || null,
          frequency_text: frequencyText,
          instructions: editState.instructions.trim() || null,
        },
      });

      // Update supply
      await updateSupplyMut.mutateAsync({
        medicationId,
        params: {
          pharmacy_name: editState.pharmacy_name.trim() || null,
          prescriber_name: editState.prescriber_name.trim() || null,
          last_fill_date: lastFillDatePicker
            ? lastFillDatePicker.toISOString().split('T')[0]
            : editState.last_fill_date.trim() || null,
          days_supply: editState.days_supply ? Number(editState.days_supply) : null,
          refills_remaining: editState.refills_remaining ? Number(editState.refills_remaining) : null,
        },
      });

      setIsEditing(false);
      setEditState(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      Alert.alert('Error', message);
    }
  }

  const handleStatusChange = (newStatus: MedicationStatus) => {
    const label = newStatus === 'stopped' ? 'stop' : newStatus === 'paused' ? 'pause' : 'resume';
    Alert.alert(
      `${label.charAt(0).toUpperCase() + label.slice(1)} Medication`,
      `Are you sure you want to ${label} ${med.drug_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes',
          style: newStatus === 'stopped' ? 'destructive' : 'default',
          onPress: () => {
            updateStatus.mutate({ medicationId: med.id, status: newStatus });
          },
        },
      ],
    );
  };

  const isSaving = updateMed.isPending || updateSupplyMut.isPending || updateSigMut.isPending;

  // ── Edit Mode ────────────────────────────────────────────────────────────
  if (isEditing && editState) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
              <View style={styles.editHeaderRow}>
                <TouchableOpacity onPress={cancelEditing}>
                  <Text style={styles.backText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.editHeaderTitle}>Edit Medication</Text>
                <View style={{ width: 50 }} />
              </View>
            </View>

            <View style={styles.editForm}>
              <Input
                label="Drug Name"
                value={editState.drug_name}
                onChangeText={(v) => setEditState((s) => s && { ...s, drug_name: v })}
              />

              <Input
                label="Strength"
                placeholder="e.g., 25mg"
                value={editState.strength}
                onChangeText={(v) => setEditState((s) => s && { ...s, strength: v })}
              />

              {/* Form */}
              <Text style={styles.editLabel}>Form</Text>
              <View style={styles.editChipRow}>
                {FORMS.map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[styles.editChip, editState.form === f && styles.editChipSelected]}
                    onPress={() => setEditState((s) => s && { ...s, form: s.form === f ? null : f })}
                  >
                    <Text style={[styles.editChipText, editState.form === f && styles.editChipTextSelected]}>
                      {FORM_LABELS[f]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Route */}
              <Text style={styles.editLabel}>Route</Text>
              <View style={styles.editChipRow}>
                {ROUTES.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.editChip, editState.route === r && styles.editChipSelected]}
                    onPress={() => setEditState((s) => s && { ...s, route: s.route === r ? null : r })}
                  >
                    <Text style={[styles.editChipText, editState.route === r && styles.editChipTextSelected]}>
                      {ROUTE_LABELS[r]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.divider} />

              <Input
                label="Dose"
                placeholder="e.g., 1 tablet"
                value={editState.dose_text}
                onChangeText={(v) => setEditState((s) => s && { ...s, dose_text: v })}
              />

              {/* Frequency */}
              <Text style={styles.editLabel}>Frequency</Text>
              <View style={styles.editChipRow}>
                {FREQUENCIES.map((freq) => (
                  <TouchableOpacity
                    key={freq}
                    style={[styles.editChip, editState.frequency === freq && styles.editChipSelected]}
                    onPress={() => setEditState((s) => s && { ...s, frequency: s.frequency === freq ? null : freq })}
                  >
                    <Text style={[styles.editChipText, editState.frequency === freq && styles.editChipTextSelected]}>
                      {FREQUENCY_LABELS[freq]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Input
                label="Instructions"
                placeholder="e.g., Take with food"
                value={editState.instructions}
                onChangeText={(v) => setEditState((s) => s && { ...s, instructions: v })}
                multiline
                numberOfLines={2}
                style={styles.multilineInput}
              />

              <View style={styles.divider} />

              <Text style={styles.editSectionTitle}>Refill Info</Text>

              <Input
                label="Pharmacy"
                placeholder="e.g., CVS Pharmacy"
                value={editState.pharmacy_name}
                onChangeText={(v) => setEditState((s) => s && { ...s, pharmacy_name: v })}
              />

              <Input
                label="Prescriber"
                placeholder="e.g., Dr. Smith"
                value={editState.prescriber_name}
                onChangeText={(v) => setEditState((s) => s && { ...s, prescriber_name: v })}
              />

              <DatePicker
                label="Last Fill Date"
                placeholder="Select last fill date"
                value={lastFillDatePicker}
                onChange={(date) => {
                  setLastFillDatePicker(date);
                  setEditState((s) =>
                    s && { ...s, last_fill_date: date ? date.toISOString().split('T')[0] : '' },
                  );
                }}
                mode="date"
                maximumDate={new Date()}
              />

              <Input
                label="Days Supply"
                placeholder="e.g., 30"
                value={editState.days_supply}
                onChangeText={(v) => setEditState((s) => s && { ...s, days_supply: v })}
                keyboardType="number-pad"
              />

              <Input
                label="Refills Remaining"
                placeholder="e.g., 2"
                value={editState.refills_remaining}
                onChangeText={(v) => setEditState((s) => s && { ...s, refills_remaining: v })}
                keyboardType="number-pad"
              />

              <View style={styles.divider} />

              <Input
                label="Notes"
                placeholder="Any additional notes"
                value={editState.notes}
                onChangeText={(v) => setEditState((s) => s && { ...s, notes: v })}
                multiline
                numberOfLines={3}
                style={styles.multilineInput}
              />

              {/* Save / Cancel */}
              <View style={styles.editActions}>
                <Button
                  title="Save Changes"
                  onPress={saveEdits}
                  loading={isSaving}
                  disabled={!editState.drug_name.trim()}
                  size="lg"
                />
                <View style={{ height: 10 }} />
                <Button
                  title="Cancel"
                  variant="outline"
                  onPress={cancelEditing}
                  size="lg"
                />
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── View Mode ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.viewHeaderRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={startEditing}>
              <Text style={styles.editButton}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Drug Name + Status */}
        <View style={styles.nameSection}>
          <Text style={styles.drugName}>{med.drug_name}</Text>
          <View style={styles.metaRow}>
            {med.strength && <Text style={styles.metaText}>{med.strength}</Text>}
            {med.form && <Text style={styles.metaText}>{FORM_LABELS[med.form]}</Text>}
            {med.route && <Text style={styles.metaText}>{ROUTE_LABELS[med.route]}</Text>}
            <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[med.status] + '20' }]}>
              <Text style={[styles.statusText, { color: STATUS_COLORS[med.status] }]}>
                {med.status}
              </Text>
            </View>
          </View>
        </View>

        {/* How to Take */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How to Take</Text>
          <Card>
            <DetailRow label="Dose" value={sig?.dose_text ?? 'Not specified'} />
            <DetailRow label="Frequency" value={sig?.frequency_text ?? (med.prn_flag ? 'As needed' : 'Not specified')} />
            {sig?.instructions && <DetailRow label="Instructions" value={sig.instructions} />}
          </Card>
        </View>

        {/* Schedule */}
        {!med.prn_flag && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Schedule</Text>
            <Card>
              {sig?.timing_json && sig.timing_json.length > 0 ? (
                sig.timing_json.map((time, i) => (
                  <View key={i} style={styles.scheduleRow}>
                    <Text style={styles.scheduleTime}>{time}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.noDataText}>No schedule times set</Text>
              )}
            </Card>
          </View>
        )}

        {/* Refill Info */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Refill Info</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={async () => {
                  try {
                    await markRefilled.mutateAsync({
                      medicationId: med.id,
                      profileId: med.profile_id,
                    });
                    if (shouldPromptChangeCheck(med.id)) {
                      setChangeSheetVisible(true);
                    }
                  } catch {
                    // surface via mutation state
                  }
                }}
                disabled={markRefilled.isPending}
              >
                <Text style={styles.actionLink}>
                  {markRefilled.isPending ? 'Saving…' : 'Mark refilled'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push(`/(main)/medications/refill/${med.id}`)}
              >
                <Text style={styles.actionLink}>Start Refill</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Card>
            {supply ? (
              <>
                {supply.last_fill_date && (
                  <DetailRow
                    label="Last Filled"
                    value={new Date(supply.last_fill_date).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  />
                )}
                {supply.days_supply != null && (
                  <DetailRow label="Days Supply" value={`${supply.days_supply} days`} />
                )}
                {runOutText && <DetailRow label="Status" value={runOutText} />}
                {supply.refills_remaining != null && (
                  <DetailRow label="Refills Remaining" value={String(supply.refills_remaining)} />
                )}
                {supply.pharmacy_name && (
                  <DetailRow label="Pharmacy" value={supply.pharmacy_name} />
                )}
                {supply.prescriber_name && (
                  <DetailRow label="Prescriber" value={supply.prescriber_name} />
                )}
              </>
            ) : (
              <TouchableOpacity onPress={startEditing}>
                <Text style={styles.addPrompt}>Add refill details</Text>
              </TouchableOpacity>
            )}
          </Card>
        </View>

        {/* Adherence History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Last 7 Days</Text>
          <Card>
            <View style={styles.adherenceRow}>
              {adherenceByDay.map((day) => (
                <View key={day.date} style={styles.adherenceDay}>
                  <Text style={styles.adherenceDayLabel}>{day.label}</Text>
                  <View style={styles.dotsRow}>
                    {day.events.length > 0 ? (
                      day.events.map((evt, i) => (
                        <View
                          key={i}
                          style={[
                            styles.dot,
                            { backgroundColor: ADHERENCE_DOT_COLORS[evt] ?? COLORS.border.dark },
                          ]}
                        />
                      ))
                    ) : (
                      <View style={[styles.dot, { backgroundColor: COLORS.border.light }]} />
                    )}
                  </View>
                </View>
              ))}
            </View>
          </Card>
        </View>

        {/* Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>
          <View style={styles.actionsRow}>
            {med.status === 'active' && (
              <>
                <Button
                  title="Pause"
                  variant="outline"
                  size="sm"
                  onPress={() => handleStatusChange('paused')}
                />
                <Button
                  title="Stop"
                  variant="ghost"
                  size="sm"
                  onPress={() => handleStatusChange('stopped')}
                />
              </>
            )}
            {med.status === 'paused' && (
              <>
                <Button
                  title="Resume"
                  variant="primary"
                  size="sm"
                  onPress={() => handleStatusChange('active')}
                />
                <Button
                  title="Stop"
                  variant="ghost"
                  size="sm"
                  onPress={() => handleStatusChange('stopped')}
                />
              </>
            )}
            {med.status === 'stopped' && (
              <Button
                title="Reactivate"
                variant="outline"
                size="sm"
                onPress={() => handleStatusChange('active')}
              />
            )}
          </View>
        </View>

        {/* Notes */}
        {med.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Card>
              <Text style={styles.notesText}>{med.notes}</Text>
            </Card>
          </View>
        )}
      </ScrollView>

      <RefillChangeSheet
        visible={changeSheetVisible}
        medicationName={med.drug_name}
        currentDoseText={med.sig?.dose_text ?? null}
        currentFrequencyText={med.sig?.frequency_text ?? null}
        currentPharmacyName={med.supply?.pharmacy_name ?? null}
        busy={recordChangeCheck.isPending}
        onSubmit={async (changeType, details) => {
          try {
            await recordChangeCheck.mutateAsync({
              medicationId: med.id,
              profileId: med.profile_id,
              changeType,
              details,
            });
            setChangeSheetVisible(false);
          } catch {
            // surface via mutation state
          }
        }}
        onDismiss={() => setChangeSheetVisible(false)}
      />
    </SafeAreaView>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function getAdherenceByDay(events: AdherenceEvent[]) {
  const days: { date: string; label: string; events: string[] }[] = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const label = i === 0 ? 'Today' : dayNames[d.getDay()];

    const dayEvents = events
      .filter((e) => e.recorded_at.startsWith(dateStr))
      .map((e) => e.event_type);

    days.push({ date: dateStr, label, events: dayEvents });
  }

  return days;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
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
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  viewHeaderRow: {
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
  editButton: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  nameSection: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  drugName: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  metaText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 12,
  },
  statusText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'capitalize',
  },
  section: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
  },
  actionLink: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  detailLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    flex: 1,
  },
  detailValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    flex: 2,
    textAlign: 'right',
  },
  scheduleRow: {
    paddingVertical: 8,
  },
  scheduleTime: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  noDataText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
  },
  addPrompt: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    textAlign: 'center',
    paddingVertical: 8,
  },
  adherenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  adherenceDay: {
    alignItems: 'center',
    flex: 1,
  },
  adherenceDayLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginBottom: 6,
    fontWeight: FONT_WEIGHTS.medium,
  },
  dotsRow: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  notesText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  // Edit mode styles
  editHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  editHeaderTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  editForm: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  editLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
    marginTop: 4,
  },
  editChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  editChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  editChipSelected: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
  },
  editChipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  editChipTextSelected: {
    color: COLORS.text.inverse,
  },
  editSectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
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
  editActions: {
    marginTop: 24,
    marginBottom: 16,
  },
});
