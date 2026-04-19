/**
 * Post-Visit Quick Capture
 *
 * A structured "How did it go?" debrief — fast, card-based, no AI required.
 * Coexists with the deeper closeout wizard (`./closeout`) which still owns
 * after-visit-document upload and outcome review. Both flows share the
 * `apt_appointments.post_visit_captured` flag, so finishing either one stops
 * Today's Briefing from re-prompting.
 *
 * Flow:
 *   Step 1 — visit_happened      Did the visit happen? (Yes / Rescheduled / Cancelled)
 *   Step 2 — what_happened       Multi-select what changed at the visit
 *   Step 3 — capture             Inline mini-cards for each selected category
 *   Step 4 — summary             Confirmation list + commit button
 *   Step 5 — success             Visual confirmation
 */

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAppointmentDetail } from '@/hooks/useAppointments';
import { useMedications } from '@/hooks/useMedications';
import {
  useCapturePostVisitData,
  useRecordCancelled,
  useRecordRescheduled,
} from '@/hooks/usePostVisitCapture';
import {
  usePreventiveItems,
  useMarkAsCompleted,
  useUpdatePreventiveItem,
} from '@/hooks/usePreventive';
import { useAuth } from '@/hooks/useAuth';
import { createTask } from '@/services/tasks';
import type { PreventiveItemWithRule } from '@/lib/types/preventive';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  FREQUENCY_LABELS,
  type MedicationFrequency,
} from '@/lib/types/medications';
import type {
  CaptureCondition,
  CaptureFollowUp,
  CaptureLabOrder,
  CaptureMedicationChange,
  CaptureNewMedication,
  CaptureReferral,
  CaptureSummaryEntry,
  MedicationChangeType,
} from '@/services/postVisitCapture';

type Step = 'visit_happened' | 'what_happened' | 'capture' | 'summary' | 'success';
type VisitOutcome = 'yes' | 'rescheduled' | 'cancelled';

type Category =
  | 'new_med'
  | 'changed_med'
  | 'condition'
  | 'lab'
  | 'referral'
  | 'follow_up'
  | 'documents'
  | 'screening'
  | 'nothing';

interface CategoryDef {
  key: Category;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const CATEGORIES: CategoryDef[] = [
  { key: 'new_med', label: 'New medication prescribed', icon: 'medical' },
  { key: 'changed_med', label: 'Medication changed or stopped', icon: 'swap-horizontal' },
  { key: 'condition', label: 'New diagnosis or condition', icon: 'fitness' },
  { key: 'lab', label: 'Labs or tests ordered', icon: 'flask' },
  { key: 'referral', label: 'Referral to another doctor', icon: 'people' },
  { key: 'follow_up', label: 'Follow-up appointment needed', icon: 'calendar' },
  { key: 'screening', label: 'Screening ordered or completed', icon: 'shield-checkmark' },
  { key: 'documents', label: 'Got documents to upload', icon: 'document-attach' },
  { key: 'nothing', label: 'Nothing significant changed', icon: 'checkmark-done' },
];

const QUICK_FOLLOWUPS: Array<{ label: string; weeks: number }> = [
  { label: '2 weeks', weeks: 2 },
  { label: '1 month', weeks: 4 },
  { label: '3 months', weeks: 12 },
  { label: '6 months', weeks: 24 },
];

const FREQ_OPTIONS: MedicationFrequency[] = [
  'once_daily',
  'twice_daily',
  'three_times_daily',
  'as_needed',
  'other',
];

function toIsoDateString(date: Date): string {
  // YYYY-MM-DD in local time — DatePicker returns a Date.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addWeeks(weeks: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

export default function PostVisitCaptureScreen() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const { data: appointment, isLoading: aptLoading } = useAppointmentDetail(
    appointmentId ?? null,
  );
  const { data: medications } = useMedications(activeProfileId);
  const captureMutation = useCapturePostVisitData();
  const rescheduleMutation = useRecordRescheduled();
  const cancelMutation = useRecordCancelled();

  // ── Wizard state ────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('visit_happened');
  const [outcome, setOutcome] = useState<VisitOutcome | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<Date | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<Category>>(new Set());

  // Captured data buckets
  const [newMeds, setNewMeds] = useState<CaptureNewMedication[]>([]);
  const [changedMeds, setChangedMeds] = useState<CaptureMedicationChange[]>([]);
  const [conditions, setConditions] = useState<CaptureCondition[]>([]);
  const [labOrders, setLabOrders] = useState<CaptureLabOrder[]>([]);
  const [referrals, setReferrals] = useState<CaptureReferral[]>([]);
  const [followUps, setFollowUps] = useState<CaptureFollowUp[]>([]);
  const [notes, setNotes] = useState('');

  // Result for the success screen
  const [resultSummary, setResultSummary] = useState<CaptureSummaryEntry[]>([]);

  if (aptLoading || !appointment) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }
  // Capture into a non-nullable local so closures below don't lose narrowing.
  const apt = appointment;

  // ── Step 1 handlers ─────────────────────────────────────────────────────
  function pickOutcome(next: VisitOutcome) {
    setOutcome(next);
    if (next === 'yes') {
      setStep('what_happened');
    }
    // For rescheduled/cancelled the user finishes via the action button below.
  }

  async function handleConfirmReschedule() {
    if (!rescheduleDate) {
      Alert.alert('Pick a date', 'When was your visit moved to?');
      return;
    }
    try {
      await rescheduleMutation.mutateAsync({
        appointmentId: apt.id,
        newStartTime: rescheduleDate.toISOString(),
      });
      router.back();
    } catch (err) {
      Alert.alert('Could not reschedule', err instanceof Error ? err.message : 'Try again');
    }
  }

  async function handleConfirmCancel() {
    try {
      await cancelMutation.mutateAsync(apt.id);
      router.back();
    } catch (err) {
      Alert.alert('Could not cancel', err instanceof Error ? err.message : 'Try again');
    }
  }

  // ── Step 2 handler ──────────────────────────────────────────────────────
  function toggleCategory(cat: Category) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (cat === 'nothing') {
        // "Nothing" is mutually exclusive with the change categories.
        return next.has('nothing') ? new Set<Category>() : new Set<Category>(['nothing']);
      }
      next.delete('nothing');
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function continueToCapture() {
    if (selectedCategories.size === 0) {
      Alert.alert('Pick at least one', 'Or tap "Nothing significant changed" to skip ahead.');
      return;
    }
    if (selectedCategories.has('nothing')) {
      // Short-circuit straight to summary with empty buckets.
      setStep('summary');
      return;
    }
    setStep('capture');
  }

  // ── Step 4 handler ──────────────────────────────────────────────────────
  async function handleCommit() {
    if (!activeProfile || !activeProfileId) return;
    try {
      const result = await captureMutation.mutateAsync({
        appointmentId: apt.id,
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
        newMeds,
        changedMeds,
        newConditions: conditions,
        labOrders,
        referrals,
        followUps,
        notes: notes.trim() || undefined,
      });
      setResultSummary(result.summary);
      setStep('success');
    } catch (err) {
      Alert.alert(
        'Could not save visit',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={20} color={COLORS.primary.DEFAULT} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>
          How did it go?
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.appointmentLabel}>
            {apt.title}
            {apt.provider_name ? ` · ${apt.provider_name}` : ''}
          </Text>

          {step === 'visit_happened' && (
            <Step1VisitHappened
              outcome={outcome}
              rescheduleDate={rescheduleDate}
              onPickOutcome={pickOutcome}
              onPickRescheduleDate={setRescheduleDate}
              onConfirmReschedule={handleConfirmReschedule}
              onConfirmCancel={handleConfirmCancel}
              rescheduleLoading={rescheduleMutation.isPending}
              cancelLoading={cancelMutation.isPending}
            />
          )}

          {step === 'what_happened' && (
            <Step2WhatHappened
              selected={selectedCategories}
              onToggle={toggleCategory}
              onContinue={continueToCapture}
            />
          )}

          {step === 'capture' && (
            <Step3Capture
              selectedCategories={selectedCategories}
              providerName={apt.provider_name ?? null}
              medications={medications ?? []}
              profileId={activeProfileId ?? ''}
              householdId={activeProfile?.household_id ?? ''}
              appointmentDate={apt.start_time}
              newMeds={newMeds}
              setNewMeds={setNewMeds}
              changedMeds={changedMeds}
              setChangedMeds={setChangedMeds}
              conditions={conditions}
              setConditions={setConditions}
              labOrders={labOrders}
              setLabOrders={setLabOrders}
              referrals={referrals}
              setReferrals={setReferrals}
              followUps={followUps}
              setFollowUps={setFollowUps}
              notes={notes}
              setNotes={setNotes}
              onContinue={() => setStep('summary')}
              onJumpToDocuments={() => router.push('/(main)/capture/upload' as never)}
            />
          )}

          {step === 'summary' && (
            <Step4Summary
              newMeds={newMeds}
              changedMeds={changedMeds}
              conditions={conditions}
              labOrders={labOrders}
              referrals={referrals}
              followUps={followUps}
              notes={notes}
              onBack={() => setStep('capture')}
              onCommit={handleCommit}
              loading={captureMutation.isPending}
            />
          )}

          {step === 'success' && (
            <Step5Success
              summary={resultSummary}
              onDone={() => router.replace(`/(main)/appointments/${apt.id}` as never)}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Step 1 ────────────────────────────────────────────────────────────────

interface Step1Props {
  outcome: VisitOutcome | null;
  rescheduleDate: Date | null;
  onPickOutcome: (o: VisitOutcome) => void;
  onPickRescheduleDate: (d: Date | null) => void;
  onConfirmReschedule: () => void;
  onConfirmCancel: () => void;
  rescheduleLoading: boolean;
  cancelLoading: boolean;
}

function Step1VisitHappened(p: Step1Props) {
  return (
    <View>
      <Text style={styles.stepTitle}>Did the visit happen?</Text>
      <Text style={styles.stepSubtitle}>Two-minute debrief — let&rsquo;s capture what changed.</Text>

      <Card style={styles.choiceCard}>
        <ChoiceRow
          icon="checkmark-circle"
          label="Yes, as scheduled"
          color={COLORS.success.DEFAULT}
          selected={p.outcome === 'yes'}
          onPress={() => p.onPickOutcome('yes')}
        />
        <ChoiceRow
          icon="calendar-outline"
          label="Rescheduled"
          color={COLORS.accent.dark}
          selected={p.outcome === 'rescheduled'}
          onPress={() => p.onPickOutcome('rescheduled')}
        />
        <ChoiceRow
          icon="close-circle-outline"
          label="Cancelled"
          color={COLORS.error.DEFAULT}
          selected={p.outcome === 'cancelled'}
          onPress={() => p.onPickOutcome('cancelled')}
        />
      </Card>

      {p.outcome === 'rescheduled' && (
        <View style={styles.subSection}>
          <Text style={styles.fieldLabel}>New date and time</Text>
          <DatePicker
            mode="datetime"
            value={p.rescheduleDate}
            onChange={p.onPickRescheduleDate}
            placeholder="Pick a new date"
          />
          <View style={styles.actionRow}>
            <Button
              title="Save reschedule"
              onPress={p.onConfirmReschedule}
              loading={p.rescheduleLoading}
              disabled={!p.rescheduleDate}
            />
          </View>
        </View>
      )}

      {p.outcome === 'cancelled' && (
        <View style={styles.subSection}>
          <Text style={styles.bodyText}>
            We&rsquo;ll mark this appointment cancelled and stop reminding you about it.
          </Text>
          <View style={styles.actionRow}>
            <Button
              title="Mark cancelled"
              onPress={p.onConfirmCancel}
              loading={p.cancelLoading}
              variant="outline"
            />
          </View>
        </View>
      )}
    </View>
  );
}

interface ChoiceRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  selected: boolean;
  onPress: () => void;
}
function ChoiceRow(p: ChoiceRowProps) {
  return (
    <TouchableOpacity
      style={[styles.choiceRow, p.selected && styles.choiceRowSelected]}
      activeOpacity={0.7}
      onPress={p.onPress}
    >
      <Ionicons name={p.icon} size={22} color={p.color} />
      <Text style={[styles.choiceLabel, p.selected && styles.choiceLabelSelected]}>{p.label}</Text>
      {p.selected && (
        <Ionicons name="checkmark" size={20} color={COLORS.primary.DEFAULT} />
      )}
    </TouchableOpacity>
  );
}

// ── Step 2 ────────────────────────────────────────────────────────────────

interface Step2Props {
  selected: Set<Category>;
  onToggle: (c: Category) => void;
  onContinue: () => void;
}
function Step2WhatHappened(p: Step2Props) {
  return (
    <View>
      <Text style={styles.stepTitle}>What happened?</Text>
      <Text style={styles.stepSubtitle}>Tap all that apply. We&rsquo;ll only ask about what you pick.</Text>

      <Card style={styles.choiceCard}>
        {CATEGORIES.map((cat, idx) => {
          const selected = p.selected.has(cat.key);
          const isLast = idx === CATEGORIES.length - 1;
          const isNothing = cat.key === 'nothing';
          return (
            <TouchableOpacity
              key={cat.key}
              style={[
                styles.checkRow,
                !isLast && styles.checkRowDivider,
                isNothing && styles.checkRowMuted,
              ]}
              activeOpacity={0.7}
              onPress={() => p.onToggle(cat.key)}
            >
              <View style={[styles.checkBox, selected && styles.checkBoxSelected]}>
                {selected && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
              </View>
              <Ionicons
                name={cat.icon}
                size={20}
                color={isNothing ? COLORS.text.tertiary : COLORS.primary.DEFAULT}
              />
              <Text style={[styles.checkLabel, isNothing && styles.checkLabelMuted]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </Card>

      <View style={styles.actionRow}>
        <Button title="Continue" onPress={p.onContinue} />
      </View>
    </View>
  );
}

// ── Step 3 ────────────────────────────────────────────────────────────────

interface Step3Props {
  selectedCategories: Set<Category>;
  providerName: string | null;
  medications: { id: string; drug_name: string; status: string }[];
  profileId: string;
  householdId: string;
  appointmentDate: string;
  newMeds: CaptureNewMedication[];
  setNewMeds: (m: CaptureNewMedication[]) => void;
  changedMeds: CaptureMedicationChange[];
  setChangedMeds: (m: CaptureMedicationChange[]) => void;
  conditions: CaptureCondition[];
  setConditions: (c: CaptureCondition[]) => void;
  labOrders: CaptureLabOrder[];
  setLabOrders: (l: CaptureLabOrder[]) => void;
  referrals: CaptureReferral[];
  setReferrals: (r: CaptureReferral[]) => void;
  followUps: CaptureFollowUp[];
  setFollowUps: (f: CaptureFollowUp[]) => void;
  notes: string;
  setNotes: (n: string) => void;
  onContinue: () => void;
  onJumpToDocuments: () => void;
}

function Step3Capture(p: Step3Props) {
  return (
    <View>
      <Text style={styles.stepTitle}>Capture the details</Text>
      <Text style={styles.stepSubtitle}>
        Fill what you remember — skip anything you&rsquo;re not sure about.
      </Text>

      {p.selectedCategories.has('new_med') && (
        <NewMedSection list={p.newMeds} onChange={p.setNewMeds} />
      )}
      {p.selectedCategories.has('changed_med') && (
        <ChangedMedSection
          list={p.changedMeds}
          onChange={p.setChangedMeds}
          medications={p.medications.filter((m) => m.status === 'active')}
        />
      )}
      {p.selectedCategories.has('condition') && (
        <ConditionSection list={p.conditions} onChange={p.setConditions} />
      )}
      {p.selectedCategories.has('lab') && (
        <LabSection list={p.labOrders} onChange={p.setLabOrders} />
      )}
      {p.selectedCategories.has('referral') && (
        <ReferralSection list={p.referrals} onChange={p.setReferrals} />
      )}
      {p.selectedCategories.has('follow_up') && (
        <FollowUpSection
          list={p.followUps}
          onChange={p.setFollowUps}
          providerName={p.providerName}
        />
      )}
      {p.selectedCategories.has('screening') && (
        <ScreeningCompletionSection
          profileId={p.profileId}
          householdId={p.householdId}
          appointmentDate={p.appointmentDate}
        />
      )}

      {p.selectedCategories.has('documents') && (
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Got documents to upload</Text>
          <Text style={styles.bodyText}>
            We&rsquo;ll take you to the upload screen — your capture so far stays here.
          </Text>
          <View style={styles.actionRow}>
            <Button
              title="Open document upload"
              variant="outline"
              onPress={p.onJumpToDocuments}
            />
          </View>
        </Card>
      )}

      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Anything else?</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Optional — quick note about the visit"
          placeholderTextColor={COLORS.text.tertiary}
          value={p.notes}
          onChangeText={p.setNotes}
          multiline
          textAlignVertical="top"
        />
      </Card>

      <View style={styles.actionRow}>
        <Button title="Review summary" onPress={p.onContinue} />
      </View>
    </View>
  );
}

// ── Screening completion section ──────────────────────────────────────────

function ScreeningCompletionSection({
  profileId,
  householdId,
  appointmentDate,
}: {
  profileId: string;
  householdId: string;
  appointmentDate: string;
}) {
  const { data: items } = usePreventiveItems(profileId);
  const markCompleted = useMarkAsCompleted();
  const updateItem = useUpdatePreventiveItem();
  const { user } = useAuth();

  // Only show items that are actionable at the visit. Already-up-to-date
  // items are skipped; deferred/declined honor patient choice.
  const candidates: PreventiveItemWithRule[] = (items ?? []).filter(
    (i) =>
      i.status === 'due' ||
      i.status === 'due_soon' ||
      i.status === 'needs_review' ||
      i.status === 'scheduled',
  );

  const [handled, setHandled] = useState<Record<string, 'completed' | 'ordered'>>({});

  async function markDoneAtVisit(item: PreventiveItemWithRule) {
    const date = toIsoDateString(new Date(appointmentDate));
    try {
      await markCompleted.mutateAsync({
        itemId: item.id,
        profileId,
        householdId,
        completionDate: date,
        source: 'user_reported',
      });
      setHandled((prev) => ({ ...prev, [item.id]: 'completed' }));
    } catch (err) {
      Alert.alert(
        'Could not save',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  }

  async function markOrderedAtVisit(item: PreventiveItemWithRule) {
    try {
      await updateItem.mutateAsync({
        itemId: item.id,
        updates: { status: 'scheduled' },
      });
      await createTask(
        {
          profile_id: profileId,
          title: `Complete ${item.rule.title}`,
          description: `Ordered during your visit — schedule and complete this screening.`,
          priority: 'medium',
          source_type: 'preventive',
          source_ref: item.id,
          trigger_type: 'manual',
        },
        user?.id ?? '',
      );
      setHandled((prev) => ({ ...prev, [item.id]: 'ordered' }));
    } catch (err) {
      Alert.alert(
        'Could not save',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  }

  if (candidates.length === 0) {
    return (
      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Screenings</Text>
        <Text style={styles.bodyText}>
          No preventive screenings due right now. Nice work.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Screening ordered or completed</Text>
      <Text style={styles.bodyText}>
        Check off anything the doctor handled — or ordered — at this visit.
      </Text>

      <View style={screeningStyles.list}>
        {candidates.map((item) => {
          const outcome = handled[item.id];
          return (
            <View key={item.id} style={screeningStyles.row}>
              <View style={screeningStyles.rowText}>
                <Text style={screeningStyles.rowTitle}>{item.rule.title}</Text>
                {outcome && (
                  <Text style={screeningStyles.rowOutcome}>
                    {outcome === 'completed'
                      ? 'Marked completed at this visit'
                      : 'Task added — complete when scheduled'}
                  </Text>
                )}
              </View>
              {!outcome ? (
                <View style={screeningStyles.rowActions}>
                  <Button
                    title="Completed"
                    variant="outline"
                    size="sm"
                    onPress={() => markDoneAtVisit(item)}
                    disabled={markCompleted.isPending}
                  />
                  <Button
                    title="Ordered"
                    variant="ghost"
                    size="sm"
                    onPress={() => markOrderedAtVisit(item)}
                    disabled={updateItem.isPending}
                  />
                </View>
              ) : (
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  color={COLORS.success.DEFAULT}
                />
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const screeningStyles = StyleSheet.create({
  list: {
    marginTop: 12,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  rowOutcome: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 6,
  },
});

// ── Inline capture sections ────────────────────────────────────────────────

interface NewMedSectionProps {
  list: CaptureNewMedication[];
  onChange: (next: CaptureNewMedication[]) => void;
}
function NewMedSection({ list, onChange }: NewMedSectionProps) {
  const [drug, setDrug] = useState('');
  const [dose, setDose] = useState('');
  const [freq, setFreq] = useState<MedicationFrequency | null>(null);

  function add() {
    if (!drug.trim()) return;
    onChange([
      ...list,
      {
        drug_name: drug.trim(),
        dose_text: dose.trim() || undefined,
        frequency: freq ?? undefined,
      },
    ]);
    setDrug('');
    setDose('');
    setFreq(null);
  }

  function remove(idx: number) {
    onChange(list.filter((_, i) => i !== idx));
  }

  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>New medication</Text>
      {list.length > 0 && (
        <View style={styles.chipList}>
          {list.map((m, i) => (
            <View key={`${m.drug_name}-${i}`} style={styles.addedRow}>
              <View style={styles.flex}>
                <Text style={styles.addedText}>
                  {m.drug_name}
                  {m.dose_text ? ` · ${m.dose_text}` : ''}
                  {m.frequency ? ` · ${FREQUENCY_LABELS[m.frequency]}` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => remove(i)} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={COLORS.text.tertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <Input
        label="Medication"
        placeholder="e.g., Lisinopril"
        value={drug}
        onChangeText={setDrug}
        autoCapitalize="words"
      />
      <Input
        label="Dose (optional)"
        placeholder="e.g., 10mg"
        value={dose}
        onChangeText={setDose}
      />
      <Text style={styles.fieldLabel}>Frequency (optional)</Text>
      <View style={styles.chipRow}>
        {FREQ_OPTIONS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, freq === f && styles.chipSelected]}
            onPress={() => setFreq(freq === f ? null : f)}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, freq === f && styles.chipTextSelected]}>
              {FREQUENCY_LABELS[f]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.actionRowSmall}>
        <Button title={list.length === 0 ? 'Add' : 'Add another'} onPress={add} disabled={!drug.trim()} variant="outline" size="sm" />
      </View>
    </Card>
  );
}

interface ChangedMedSectionProps {
  list: CaptureMedicationChange[];
  onChange: (next: CaptureMedicationChange[]) => void;
  medications: { id: string; drug_name: string }[];
}
function ChangedMedSection({ list, onChange, medications }: ChangedMedSectionProps) {
  const [activeMedId, setActiveMedId] = useState<string | null>(null);
  const [changeType, setChangeType] = useState<MedicationChangeType | null>(null);
  const [newDose, setNewDose] = useState('');
  const [newFreq, setNewFreq] = useState<MedicationFrequency | null>(null);
  const [otherNote, setOtherNote] = useState('');

  function reset() {
    setActiveMedId(null);
    setChangeType(null);
    setNewDose('');
    setNewFreq(null);
    setOtherNote('');
  }

  function add() {
    if (!activeMedId || !changeType) return;
    const med = medications.find((m) => m.id === activeMedId);
    if (!med) return;
    onChange([
      ...list,
      {
        medication_id: activeMedId,
        drug_name: med.drug_name,
        change_type: changeType,
        new_dose_text: newDose.trim() || undefined,
        new_frequency: newFreq ?? undefined,
        notes: otherNote.trim() || undefined,
      },
    ]);
    reset();
  }

  function remove(idx: number) {
    onChange(list.filter((_, i) => i !== idx));
  }

  if (medications.length === 0) {
    return (
      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Medication changed</Text>
        <Text style={styles.bodyText}>
          You don&rsquo;t have any active medications on file to update. Use &ldquo;New medication&rdquo; instead.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Medication changed</Text>
      {list.length > 0 && (
        <View style={styles.chipList}>
          {list.map((c, i) => (
            <View key={`${c.medication_id}-${i}`} style={styles.addedRow}>
              <View style={styles.flex}>
                <Text style={styles.addedText}>
                  {c.drug_name} — {c.change_type.replace(/_/g, ' ')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => remove(i)} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={COLORS.text.tertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <Text style={styles.fieldLabel}>Which medication?</Text>
      <View style={styles.chipRow}>
        {medications.map((m) => (
          <TouchableOpacity
            key={m.id}
            style={[styles.chip, activeMedId === m.id && styles.chipSelected]}
            onPress={() => setActiveMedId(activeMedId === m.id ? null : m.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, activeMedId === m.id && styles.chipTextSelected]}>
              {m.drug_name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeMedId && (
        <>
          <Text style={styles.fieldLabel}>What changed?</Text>
          <View style={styles.chipRow}>
            {([
              ['new_dose', 'New dose'],
              ['frequency_changed', 'Frequency changed'],
              ['stopped', 'Stopped'],
              ['other', 'Other'],
            ] as Array<[MedicationChangeType, string]>).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.chip, changeType === key && styles.chipSelected]}
                onPress={() => setChangeType(changeType === key ? null : key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, changeType === key && styles.chipTextSelected]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {changeType === 'new_dose' && (
            <Input
              label="New dose"
              placeholder="e.g., 20mg"
              value={newDose}
              onChangeText={setNewDose}
            />
          )}
          {changeType === 'frequency_changed' && (
            <View>
              <Text style={styles.fieldLabel}>New frequency</Text>
              <View style={styles.chipRow}>
                {FREQ_OPTIONS.map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[styles.chip, newFreq === f && styles.chipSelected]}
                    onPress={() => setNewFreq(newFreq === f ? null : f)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, newFreq === f && styles.chipTextSelected]}>
                      {FREQUENCY_LABELS[f]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          {changeType === 'other' && (
            <Input
              label="Note"
              placeholder="What did the doctor say?"
              value={otherNote}
              onChangeText={setOtherNote}
            />
          )}
          <View style={styles.actionRowSmall}>
            <Button
              title={list.length === 0 ? 'Add' : 'Add another'}
              onPress={add}
              disabled={!changeType}
              variant="outline"
              size="sm"
            />
          </View>
        </>
      )}
    </Card>
  );
}

interface ConditionSectionProps {
  list: CaptureCondition[];
  onChange: (next: CaptureCondition[]) => void;
}
function ConditionSection({ list, onChange }: ConditionSectionProps) {
  const [name, setName] = useState('');
  function add() {
    if (!name.trim()) return;
    onChange([...list, { condition_name: name.trim() }]);
    setName('');
  }
  function remove(idx: number) {
    onChange(list.filter((_, i) => i !== idx));
  }
  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>New diagnosis or condition</Text>
      {list.length > 0 && (
        <View style={styles.chipList}>
          {list.map((c, i) => (
            <View key={`${c.condition_name}-${i}`} style={styles.addedRow}>
              <View style={styles.flex}>
                <Text style={styles.addedText}>{c.condition_name}</Text>
              </View>
              <TouchableOpacity onPress={() => remove(i)} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={COLORS.text.tertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <Input
        label="Condition"
        placeholder="e.g., Hypertension"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />
      <View style={styles.actionRowSmall}>
        <Button title={list.length === 0 ? 'Add' : 'Add another'} onPress={add} disabled={!name.trim()} variant="outline" size="sm" />
      </View>
    </Card>
  );
}

interface LabSectionProps {
  list: CaptureLabOrder[];
  onChange: (next: CaptureLabOrder[]) => void;
}
function LabSection({ list, onChange }: LabSectionProps) {
  const [test, setTest] = useState('');
  const [date, setDate] = useState<Date | null>(null);
  const [tbd, setTbd] = useState(false);
  const [facility, setFacility] = useState('');

  function add() {
    if (!test.trim()) return;
    onChange([
      ...list,
      {
        test_name: test.trim(),
        due_date: tbd ? null : date ? toIsoDateString(date) : null,
        facility: facility.trim() || undefined,
      },
    ]);
    setTest('');
    setDate(null);
    setTbd(false);
    setFacility('');
  }
  function remove(idx: number) {
    onChange(list.filter((_, i) => i !== idx));
  }
  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Labs or tests ordered</Text>
      {list.length > 0 && (
        <View style={styles.chipList}>
          {list.map((l, i) => (
            <View key={`${l.test_name}-${i}`} style={styles.addedRow}>
              <View style={styles.flex}>
                <Text style={styles.addedText}>
                  {l.test_name}
                  {l.due_date ? ` · ${l.due_date}` : ' · TBD'}
                  {l.facility ? ` · ${l.facility}` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => remove(i)} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={COLORS.text.tertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <Input
        label="Test"
        placeholder="e.g., Blood work, A1c"
        value={test}
        onChangeText={setTest}
        autoCapitalize="words"
      />
      {!tbd && (
        <DatePicker
          label="When?"
          mode="date"
          value={date}
          onChange={setDate}
          placeholder="Pick a date"
        />
      )}
      <TouchableOpacity
        style={styles.toggleRow}
        activeOpacity={0.7}
        onPress={() => {
          setTbd((v) => !v);
          if (!tbd) setDate(null);
        }}
      >
        <View style={[styles.checkBox, tbd && styles.checkBoxSelected]}>
          {tbd && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
        </View>
        <Text style={styles.toggleLabel}>Date is TBD</Text>
      </TouchableOpacity>
      <Input
        label="Facility (optional)"
        placeholder="e.g., Quest Diagnostics"
        value={facility}
        onChangeText={setFacility}
      />
      <View style={styles.actionRowSmall}>
        <Button title={list.length === 0 ? 'Add' : 'Add another'} onPress={add} disabled={!test.trim()} variant="outline" size="sm" />
      </View>
    </Card>
  );
}

interface ReferralSectionProps {
  list: CaptureReferral[];
  onChange: (next: CaptureReferral[]) => void;
}
function ReferralSection({ list, onChange }: ReferralSectionProps) {
  const [doctor, setDoctor] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [addToTeam, setAddToTeam] = useState(true);

  function add() {
    if (!doctor.trim()) return;
    onChange([
      ...list,
      {
        doctor_name: doctor.trim(),
        specialty: specialty.trim() || undefined,
        add_to_care_team: addToTeam,
      },
    ]);
    setDoctor('');
    setSpecialty('');
    setAddToTeam(true);
  }
  function remove(idx: number) {
    onChange(list.filter((_, i) => i !== idx));
  }
  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Referral to another doctor</Text>
      {list.length > 0 && (
        <View style={styles.chipList}>
          {list.map((r, i) => (
            <View key={`${r.doctor_name}-${i}`} style={styles.addedRow}>
              <View style={styles.flex}>
                <Text style={styles.addedText}>
                  {r.doctor_name}
                  {r.specialty ? ` · ${r.specialty}` : ''}
                  {r.add_to_care_team ? ' · added to care team' : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => remove(i)} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={COLORS.text.tertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <Input
        label="Doctor / specialist"
        placeholder="e.g., Dr. Chen"
        value={doctor}
        onChangeText={setDoctor}
        autoCapitalize="words"
      />
      <Input
        label="Specialty (optional)"
        placeholder="e.g., Cardiology"
        value={specialty}
        onChangeText={setSpecialty}
        autoCapitalize="words"
      />
      <TouchableOpacity
        style={styles.toggleRow}
        activeOpacity={0.7}
        onPress={() => setAddToTeam((v) => !v)}
      >
        <View style={[styles.checkBox, addToTeam && styles.checkBoxSelected]}>
          {addToTeam && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
        </View>
        <Text style={styles.toggleLabel}>Add to my care team</Text>
      </TouchableOpacity>
      <View style={styles.actionRowSmall}>
        <Button title={list.length === 0 ? 'Add' : 'Add another'} onPress={add} disabled={!doctor.trim()} variant="outline" size="sm" />
      </View>
    </Card>
  );
}

interface FollowUpSectionProps {
  list: CaptureFollowUp[];
  onChange: (next: CaptureFollowUp[]) => void;
  providerName: string | null;
}
function FollowUpSection({ list, onChange, providerName }: FollowUpSectionProps) {
  const [date, setDate] = useState<Date | null>(null);
  const [provider, setProvider] = useState(providerName ?? '');

  function pickQuick(weeks: number) {
    setDate(addWeeks(weeks));
  }
  function add() {
    if (!date) return;
    onChange([
      ...list,
      {
        due_date: toIsoDateString(date),
        provider_name: provider.trim() || providerName || 'your doctor',
      },
    ]);
    setDate(null);
    setProvider(providerName ?? '');
  }
  function remove(idx: number) {
    onChange(list.filter((_, i) => i !== idx));
  }
  return (
    <Card style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Follow-up appointment</Text>
      {list.length > 0 && (
        <View style={styles.chipList}>
          {list.map((f, i) => (
            <View key={`${f.due_date}-${i}`} style={styles.addedRow}>
              <View style={styles.flex}>
                <Text style={styles.addedText}>
                  {f.due_date} · {f.provider_name}
                </Text>
              </View>
              <TouchableOpacity onPress={() => remove(i)} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={COLORS.text.tertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <Text style={styles.fieldLabel}>When?</Text>
      <View style={styles.chipRow}>
        {QUICK_FOLLOWUPS.map((q) => (
          <TouchableOpacity
            key={q.label}
            style={styles.chip}
            onPress={() => pickQuick(q.weeks)}
            activeOpacity={0.7}
          >
            <Text style={styles.chipText}>{q.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <DatePicker
        mode="date"
        value={date}
        onChange={setDate}
        placeholder="Or pick a specific date"
      />
      <Input
        label="With whom?"
        placeholder="Defaults to current provider"
        value={provider}
        onChangeText={setProvider}
        autoCapitalize="words"
      />
      <View style={styles.actionRowSmall}>
        <Button title={list.length === 0 ? 'Add' : 'Add another'} onPress={add} disabled={!date} variant="outline" size="sm" />
      </View>
    </Card>
  );
}

// ── Step 4: Summary ───────────────────────────────────────────────────────

interface Step4Props {
  newMeds: CaptureNewMedication[];
  changedMeds: CaptureMedicationChange[];
  conditions: CaptureCondition[];
  labOrders: CaptureLabOrder[];
  referrals: CaptureReferral[];
  followUps: CaptureFollowUp[];
  notes: string;
  onBack: () => void;
  onCommit: () => void;
  loading: boolean;
}

function Step4Summary(p: Step4Props) {
  const lines = useMemo(() => {
    const out: string[] = [];
    p.newMeds.forEach((m) =>
      out.push(`Added medication: ${[m.drug_name, m.dose_text, m.frequency ? FREQUENCY_LABELS[m.frequency] : null].filter(Boolean).join(' · ')}`),
    );
    p.changedMeds.forEach((c) => out.push(`Medication changed: ${c.drug_name} (${c.change_type.replace(/_/g, ' ')})`));
    p.conditions.forEach((c) => out.push(`New condition: ${c.condition_name}`));
    p.labOrders.forEach((l) => out.push(`Lab ordered: ${l.test_name}${l.due_date ? ` (due ${l.due_date})` : ' (TBD)'}`));
    p.referrals.forEach((r) => out.push(`Referral: ${r.doctor_name}${r.specialty ? `, ${r.specialty}` : ''}`));
    p.followUps.forEach((f) => out.push(`Follow-up: ${f.due_date} with ${f.provider_name}`));
    if (p.notes.trim()) out.push(`Note: ${p.notes.trim().slice(0, 80)}${p.notes.trim().length > 80 ? '…' : ''}`);
    return out;
  }, [p.newMeds, p.changedMeds, p.conditions, p.labOrders, p.referrals, p.followUps, p.notes]);

  return (
    <View>
      <Text style={styles.stepTitle}>Looks right?</Text>
      <Text style={styles.stepSubtitle}>
        We&rsquo;ll add everything below to your profile, medication list, and tasks.
      </Text>

      <Card style={styles.sectionCard}>
        {lines.length === 0 ? (
          <Text style={styles.bodyText}>
            Nothing to capture — we&rsquo;ll just mark the visit as completed.
          </Text>
        ) : (
          lines.map((line, i) => (
            <View key={i} style={styles.summaryLine}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success.DEFAULT} />
              <Text style={styles.summaryLineText}>{line}</Text>
            </View>
          ))
        )}
      </Card>

      <View style={styles.actionRow}>
        <Button title="Looks good" onPress={p.onCommit} loading={p.loading} />
        <View style={{ height: 12 }} />
        <Button title="Edit" variant="outline" onPress={p.onBack} disabled={p.loading} />
      </View>
    </View>
  );
}

// ── Step 5: Success ───────────────────────────────────────────────────────

interface Step5Props {
  summary: CaptureSummaryEntry[];
  onDone: () => void;
}
function Step5Success({ summary, onDone }: Step5Props) {
  return (
    <View>
      <View style={styles.successHeader}>
        <Ionicons name="checkmark-circle" size={42} color={COLORS.success.DEFAULT} />
        <Text style={styles.successTitle}>Visit captured</Text>
        <Text style={styles.stepSubtitle}>
          Your profile and tasks are up to date.
        </Text>
      </View>

      {summary.length > 0 && (
        <Card style={styles.sectionCard}>
          {summary.map((s, i) => (
            <View key={i} style={styles.summaryLine}>
              <Ionicons name="checkmark" size={16} color={COLORS.success.DEFAULT} />
              <Text style={styles.summaryLineText}>{s.label}</Text>
            </View>
          ))}
        </Card>
      )}

      <View style={styles.actionRow}>
        <Button title="Done" onPress={onDone} />
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 12,
  },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  navTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flex: 1,
    textAlign: 'center',
  },
  navSpacer: { width: 60 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 60,
  },
  appointmentLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
    marginBottom: 16,
  },
  stepTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 6,
  },
  stepSubtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    marginBottom: 20,
    lineHeight: 22,
  },
  bodyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
    marginTop: 4,
  },

  // Step 1
  choiceCard: { padding: 0, overflow: 'hidden' },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  choiceRowSelected: {
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  choiceLabel: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  choiceLabelSelected: {
    color: COLORS.primary.DEFAULT,
  },
  subSection: {
    marginTop: 16,
  },

  // Step 2
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  checkRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  checkRowMuted: {
    backgroundColor: COLORS.surface.muted,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.border.dark,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
  },
  checkBoxSelected: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
  },
  checkLabel: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  checkLabelMuted: {
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.normal,
  },

  // Step 3 sections
  sectionCard: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
  },
  chipList: {
    marginBottom: 12,
    gap: 8,
  },
  addedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.success.DEFAULT + '14',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  addedText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  toggleLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
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
    minHeight: 80,
  },
  actionRow: {
    marginTop: 16,
  },
  actionRowSmall: {
    marginTop: 4,
    alignItems: 'flex-start',
  },

  // Step 4 / 5
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 6,
  },
  summaryLineText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  successHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginTop: 8,
  },
});
