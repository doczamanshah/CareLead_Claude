/**
 * Post-Visit Closeout Wizard.
 *
 * Steps:
 *   1. quick     — did the visit happen + free-text summary + follow-up + attendees
 *   2. upload    — optional after-visit document(s) → AI extraction
 *   3. review    — accept / edit / reject extracted outcomes
 *   4. confirm   — finalize: commit facts + tasks + visit summary
 *   5. success   — summary view with Share / Done
 *
 * If the patient says the visit didn't happen they can reschedule (prefilled
 * from the original appointment) and the original is marked cancelled.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAppointmentDetail, useCancelAppointment, useRescheduleAppointment } from '@/hooks/useAppointments';
import { useUploadArtifact } from '@/hooks/useArtifacts';
import {
  useStartCloseout,
  useUpdateCloseout,
  useCloseoutWithOutcomes,
  useProcessCloseoutSummary,
  useProcessCloseoutDocument,
  useUpdateOutcomeStatus,
  useFinalizeCloseout,
} from '@/hooks/useCloseout';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { Outcome, OutcomeType } from '@/lib/types/appointments';

type WizardStep = 'quick' | 'upload' | 'review' | 'confirm' | 'success';
type VisitHappened = 'yes' | 'no' | 'rescheduled' | null;

const ALLOWED_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const OUTCOME_TYPE_LABELS: Record<OutcomeType, string> = {
  followup_action: 'Follow-up',
  medication_change: 'Medication',
  diagnosis_change: 'Diagnosis',
  allergy_change: 'Allergy',
  order: 'Order',
  instruction: 'Instruction',
};

const OUTCOME_TYPE_ICONS: Record<OutcomeType, string> = {
  followup_action: '\uD83D\uDD01',
  medication_change: '\uD83D\uDC8A',
  diagnosis_change: '\uD83E\uDE7A',
  allergy_change: '\u26A0\uFE0F',
  order: '\uD83D\uDCCB',
  instruction: '\uD83D\uDCDD',
};

interface UploadedDoc {
  artifactId: string;
  fileName: string;
  status: 'processing' | 'done' | 'error';
  outcomesCreated?: number;
}

export default function CloseoutWizardScreen() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const { data: appointment, isLoading: appointmentLoading } = useAppointmentDetail(
    appointmentId ?? null,
  );

  const startCloseout = useStartCloseout();
  const updateCloseout = useUpdateCloseout();
  const processSummary = useProcessCloseoutSummary();
  const processDocument = useProcessCloseoutDocument();
  const uploadArtifact = useUploadArtifact();
  const updateOutcome = useUpdateOutcomeStatus();
  const finalize = useFinalizeCloseout();
  const cancelAppointment = useCancelAppointment();
  const reschedule = useRescheduleAppointment();

  const [closeoutId, setCloseoutId] = useState<string | null>(null);
  const { data: closeout, refetch: refetchCloseout } = useCloseoutWithOutcomes(closeoutId);

  const [step, setStep] = useState<WizardStep>('quick');

  // Quick capture
  const [visitHappened, setVisitHappened] = useState<VisitHappened>(null);
  const [quickSummary, setQuickSummary] = useState('');
  const [followupTimeframe, setFollowupTimeframe] = useState('');
  const [attendees, setAttendees] = useState('');

  // Upload step
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);

  // Finalize result
  const [visitSummaryText, setVisitSummaryText] = useState<string>('');

  // Bootstrap: create or fetch the closeout when the appointment loads.
  useEffect(() => {
    if (!appointment || closeoutId) return;
    startCloseout.mutate(appointment.id, {
      onSuccess: (data) => {
        setCloseoutId(data.id);
        // Hydrate any saved values from a draft closeout
        if (data.visit_happened === true) setVisitHappened('yes');
        if (data.quick_summary) setQuickSummary(data.quick_summary);
        if (data.followup_timeframe) setFollowupTimeframe(data.followup_timeframe);
        if (data.attendees) setAttendees(data.attendees);
      },
      onError: () => {
        Alert.alert('Couldn’t start closeout', 'Please try again.');
      },
    });
    // We only want to bootstrap once per appointment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointment?.id]);

  const proposedOutcomes = useMemo(
    () => closeout?.outcomes.filter((o) => o.status === 'proposed') ?? [],
    [closeout],
  );
  const acceptedOutcomes = useMemo(
    () =>
      closeout?.outcomes.filter(
        (o) => o.status === 'accepted' || o.status === 'edited',
      ) ?? [],
    [closeout],
  );

  // ── Step 1 handlers ──────────────────────────────────────────────────────
  async function handleQuickNext() {
    if (!closeoutId || !appointment) return;
    if (visitHappened === null) {
      Alert.alert('Tell us first', 'Did the visit happen?');
      return;
    }

    if (visitHappened === 'no') {
      // Mark cancelled and exit
      await updateCloseout.mutateAsync({
        closeoutId,
        params: { visit_happened: false },
      });
      // Mark the original appointment as cancelled
      Alert.alert(
        'Mark as cancelled?',
        'We’ll mark this appointment as cancelled. You can always create a new one later.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Mark cancelled',
            style: 'destructive',
            onPress: async () => {
              try {
                await cancelAppointment.mutateAsync(appointment!.id);
              } catch {
                // Non-blocking
              }
              router.replace('/(main)/(tabs)');
            },
          },
        ],
      );
      return;
    }

    if (visitHappened === 'rescheduled') {
      handleReschedule();
      return;
    }

    // Yes — save quick capture and move on
    await updateCloseout.mutateAsync({
      closeoutId,
      params: {
        visit_happened: true,
        quick_summary: quickSummary.trim() || null,
        followup_timeframe: followupTimeframe.trim() || null,
        attendees: attendees.trim() || null,
        status: 'needs_review',
      },
    });

    setStep('upload');
  }

  function handleReschedule() {
    if (!appointment) return;
    // Pre-fill from the original — default to 1 week from now
    const newStart = new Date();
    newStart.setDate(newStart.getDate() + 7);
    const original = new Date(appointment.start_time);
    newStart.setHours(original.getHours(), original.getMinutes(), 0, 0);

    Alert.alert(
      'Reschedule visit?',
      `We’ll create a new appointment for ${newStart.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })} at ${newStart.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })} and mark this one as rescheduled. You can edit the new one after.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reschedule',
          onPress: async () => {
            try {
              const created = await reschedule.mutateAsync({
                appointmentId: appointment.id,
                newData: {
                  profile_id: appointment.profile_id,
                  title: appointment.title,
                  appointment_type: appointment.appointment_type,
                  provider_name: appointment.provider_name ?? undefined,
                  facility_name: appointment.facility_name ?? undefined,
                  location_text: appointment.location_text ?? undefined,
                  purpose: appointment.purpose ?? undefined,
                  notes: appointment.notes ?? undefined,
                  start_time: newStart.toISOString(),
                  timezone: appointment.timezone,
                },
              });
              router.replace(`/(main)/appointments/${created.id}`);
            } catch {
              Alert.alert('Couldn’t reschedule', 'Please try again.');
            }
          },
        },
      ],
    );
  }

  // ── Step 2 handlers ──────────────────────────────────────────────────────
  async function handlePickDocument() {
    if (!closeoutId || !appointment) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ALLOWED_DOC_TYPES,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const mime = asset.mimeType ?? 'application/octet-stream';
      if (mime === 'image/heic' || mime === 'image/heif') {
        Alert.alert(
          'Unsupported Format',
          'HEIC/HEIF images are not supported. Please convert to JPEG or PNG.',
        );
        return;
      }

      const artifact = await uploadArtifact.mutateAsync({
        profileId: appointment.profile_id,
        fileName: asset.name,
        fileUri: asset.uri,
        mimeType: mime,
        artifactType: 'document',
        sourceChannel: 'upload',
        fileSizeBytes: asset.size ?? 0,
      });

      setUploadedDocs((prev) => [
        ...prev,
        {
          artifactId: artifact.id,
          fileName: asset.name,
          status: 'processing',
        },
      ]);

      try {
        const processed = await processDocument.mutateAsync({
          closeoutId,
          artifactId: artifact.id,
          profileId: appointment.profile_id,
        });
        setUploadedDocs((prev) =>
          prev.map((d) =>
            d.artifactId === artifact.id
              ? { ...d, status: 'done', outcomesCreated: processed.outcomesCreated }
              : d,
          ),
        );
        await refetchCloseout();
      } catch {
        setUploadedDocs((prev) =>
          prev.map((d) =>
            d.artifactId === artifact.id ? { ...d, status: 'error' } : d,
          ),
        );
      }
    } catch {
      Alert.alert('Error', 'Could not open the document picker.');
    }
  }

  function handleTakePhoto() {
    if (!closeoutId || !appointment) return;
    // Re-use the existing camera capture screen — it currently lives outside
    // the closeout flow. For Phase 1 Step 7B we keep this simple: send the
    // patient to the document picker which also accepts photos.
    handlePickDocument();
  }

  async function handleUploadNext() {
    if (!closeoutId || !appointment) return;

    // If patient wrote a quick summary AND uploaded zero documents, run the
    // summary through AI extraction now so the review step has something to
    // show. Skip if there's nothing to extract.
    const hasUploads = uploadedDocs.some((d) => d.status === 'done');
    if (!hasUploads && quickSummary.trim().length > 20) {
      try {
        await processSummary.mutateAsync({
          closeoutId,
          summaryText: quickSummary,
          profileId: appointment.profile_id,
        });
        await refetchCloseout();
      } catch {
        // Non-blocking — we still let the patient review/finalize.
      }
    }

    // Decide where to go: review if any outcomes, otherwise straight to confirm.
    const refreshed = await refetchCloseout();
    const hasOutcomes = (refreshed.data?.outcomes ?? []).length > 0;
    setStep(hasOutcomes ? 'review' : 'confirm');
  }

  // ── Step 3 handlers ──────────────────────────────────────────────────────
  async function handleAcceptOutcome(outcome: Outcome) {
    if (!closeoutId) return;
    await updateOutcome.mutateAsync({
      outcomeId: outcome.id,
      status: 'accepted',
      closeoutId,
    });
  }

  async function handleRejectOutcome(outcome: Outcome) {
    if (!closeoutId) return;
    await updateOutcome.mutateAsync({
      outcomeId: outcome.id,
      status: 'rejected',
      closeoutId,
    });
  }

  // ── Step 4 handlers ──────────────────────────────────────────────────────
  async function handleFinalize() {
    if (!closeoutId) return;
    try {
      const result = await finalize.mutateAsync(closeoutId);
      setVisitSummaryText(result.visitSummaryText);
      setStep('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not finalize';
      Alert.alert('Couldn’t finalize', message);
    }
  }

  async function handleShareSummary() {
    if (!visitSummaryText) return;
    try {
      await Share.share({
        message: visitSummaryText,
        title: `Visit Summary — ${appointment?.title ?? 'Visit'}`,
      });
    } catch {
      // user cancelled
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (appointmentLoading || !appointment) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>{'\u2039'} Back</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>Closeout</Text>
          <View style={styles.navSpacer} />
        </View>

        <StepIndicator step={step} />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {step === 'quick' && (
            <QuickStep
              appointmentTitle={appointment.title}
              providerName={appointment.provider_name}
              visitHappened={visitHappened}
              setVisitHappened={setVisitHappened}
              quickSummary={quickSummary}
              setQuickSummary={setQuickSummary}
              followupTimeframe={followupTimeframe}
              setFollowupTimeframe={setFollowupTimeframe}
              attendees={attendees}
              setAttendees={setAttendees}
              onNext={handleQuickNext}
              loading={updateCloseout.isPending}
            />
          )}

          {step === 'upload' && (
            <UploadStep
              uploadedDocs={uploadedDocs}
              onPickDocument={handlePickDocument}
              onTakePhoto={handleTakePhoto}
              onNext={handleUploadNext}
              uploading={
                uploadArtifact.isPending ||
                processDocument.isPending ||
                processSummary.isPending
              }
            />
          )}

          {step === 'review' && (
            <ReviewStep
              outcomes={closeout?.outcomes ?? []}
              proposedCount={proposedOutcomes.length}
              onAccept={handleAcceptOutcome}
              onReject={handleRejectOutcome}
              onNext={() => setStep('confirm')}
            />
          )}

          {step === 'confirm' && (
            <ConfirmStep
              factsToCreate={acceptedOutcomes.filter((o) =>
                ['medication_change', 'diagnosis_change', 'allergy_change'].includes(
                  o.outcome_type,
                ),
              ).length}
              tasksToCreate={acceptedOutcomes.filter((o) =>
                ['followup_action', 'order', 'instruction'].includes(o.outcome_type),
              ).length}
              followupTimeframe={followupTimeframe}
              onFinalize={handleFinalize}
              loading={finalize.isPending}
            />
          )}

          {step === 'success' && (
            <SuccessStep
              visitSummaryText={visitSummaryText}
              onShare={handleShareSummary}
              onDone={() => router.replace(`/(main)/appointments/${appointment.id}`)}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: WizardStep }) {
  const steps: WizardStep[] = ['quick', 'upload', 'review', 'confirm'];
  if (step === 'success') return null;
  const currentIndex = steps.indexOf(step);
  return (
    <View style={styles.stepIndicatorRow}>
      {steps.map((s, i) => (
        <View key={s} style={styles.stepIndicatorItem}>
          <View
            style={[
              styles.stepDot,
              i <= currentIndex && styles.stepDotActive,
              i < currentIndex && styles.stepDotDone,
            ]}
          />
          {i < steps.length - 1 && (
            <View
              style={[
                styles.stepLine,
                i < currentIndex && styles.stepLineActive,
              ]}
            />
          )}
        </View>
      ))}
    </View>
  );
}

// ── Step 1: Quick capture ──────────────────────────────────────────────────

interface QuickStepProps {
  appointmentTitle: string;
  providerName: string | null;
  visitHappened: VisitHappened;
  setVisitHappened: (v: VisitHappened) => void;
  quickSummary: string;
  setQuickSummary: (v: string) => void;
  followupTimeframe: string;
  setFollowupTimeframe: (v: string) => void;
  attendees: string;
  setAttendees: (v: string) => void;
  onNext: () => void;
  loading: boolean;
}

function QuickStep(props: QuickStepProps) {
  return (
    <>
      <Text style={styles.stepTitle}>How did your visit go?</Text>
      <Text style={styles.stepSubtitle}>
        {props.providerName ?? props.appointmentTitle}
      </Text>

      <Text style={styles.fieldLabel}>Did the visit happen?</Text>
      <View style={styles.choiceRow}>
        {(['yes', 'no', 'rescheduled'] as const).map((choice) => (
          <TouchableOpacity
            key={choice}
            style={[
              styles.choiceChip,
              props.visitHappened === choice && styles.choiceChipActive,
            ]}
            onPress={() => props.setVisitHappened(choice)}
          >
            <Text
              style={[
                styles.choiceChipText,
                props.visitHappened === choice && styles.choiceChipTextActive,
              ]}
            >
              {choice === 'yes' ? 'Yes' : choice === 'no' ? 'No' : 'Rescheduled'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {props.visitHappened === 'yes' && (
        <>
          <Text style={styles.fieldLabel}>Quick summary — what happened?</Text>
          <Text style={styles.fieldHint}>
            What changed? Any new medications, diagnoses, or instructions?
          </Text>
          <TextInput
            style={styles.textArea}
            placeholder="The doctor adjusted my blood pressure medication and ordered labs in 2 weeks…"
            placeholderTextColor={COLORS.text.tertiary}
            multiline
            value={props.quickSummary}
            onChangeText={props.setQuickSummary}
          />

          <Text style={styles.fieldLabel}>Any follow-up needed?</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Follow up in 3 months, labs in 2 weeks"
            placeholderTextColor={COLORS.text.tertiary}
            value={props.followupTimeframe}
            onChangeText={props.setFollowupTimeframe}
          />

          <Text style={styles.fieldLabel}>Who attended?</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Me and my daughter"
            placeholderTextColor={COLORS.text.tertiary}
            value={props.attendees}
            onChangeText={props.setAttendees}
          />
        </>
      )}

      <View style={styles.actionRow}>
        <Button
          title={
            props.visitHappened === 'no'
              ? 'Mark as cancelled'
              : props.visitHappened === 'rescheduled'
                ? 'Reschedule'
                : 'Next'
          }
          onPress={props.onNext}
          loading={props.loading}
        />
      </View>
    </>
  );
}

// ── Step 2: Upload documents ───────────────────────────────────────────────

interface UploadStepProps {
  uploadedDocs: UploadedDoc[];
  onPickDocument: () => void;
  onTakePhoto: () => void;
  onNext: () => void;
  uploading: boolean;
}

function UploadStep(props: UploadStepProps) {
  return (
    <>
      <Text style={styles.stepTitle}>Got any documents from the visit?</Text>
      <Text style={styles.stepSubtitle}>
        Even a phone snap of the after-visit summary helps. CareLead will pull
        out the changes for you.
      </Text>

      <View style={styles.uploadActionsRow}>
        <Button
          title="\uD83D\uDCF7  Take Photo"
          variant="outline"
          onPress={props.onTakePhoto}
        />
        <View style={{ height: 12 }} />
        <Button
          title="\uD83D\uDCC4  Upload Document"
          variant="outline"
          onPress={props.onPickDocument}
        />
      </View>

      {props.uploading && (
        <View style={styles.uploadingRow}>
          <ActivityIndicator size="small" color={COLORS.primary.DEFAULT} />
          <Text style={styles.uploadingText}>Processing…</Text>
        </View>
      )}

      {props.uploadedDocs.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.fieldLabel}>Uploaded</Text>
          {props.uploadedDocs.map((doc) => (
            <Card key={doc.artifactId} style={styles.uploadedCard}>
              <Text style={styles.uploadedFileName} numberOfLines={1}>
                {doc.fileName}
              </Text>
              <Text style={styles.uploadedStatus}>
                {doc.status === 'processing' && 'Processing…'}
                {doc.status === 'done' &&
                  `Done — ${doc.outcomesCreated ?? 0} item${
                    doc.outcomesCreated === 1 ? '' : 's'
                  } extracted`}
                {doc.status === 'error' && 'Could not process'}
              </Text>
            </Card>
          ))}
        </View>
      )}

      <View style={styles.actionRow}>
        <Button
          title={props.uploadedDocs.length > 0 ? 'Next' : 'Skip for now'}
          onPress={props.onNext}
          loading={props.uploading}
        />
      </View>
    </>
  );
}

// ── Step 3: Review extracted outcomes ──────────────────────────────────────

interface ReviewStepProps {
  outcomes: Outcome[];
  proposedCount: number;
  onAccept: (o: Outcome) => void;
  onReject: (o: Outcome) => void;
  onNext: () => void;
}

function ReviewStep(props: ReviewStepProps) {
  if (props.outcomes.length === 0) {
    return (
      <>
        <Text style={styles.stepTitle}>Nothing to review</Text>
        <Text style={styles.stepSubtitle}>
          We didn’t find any structured changes. You can finalize now.
        </Text>
        <View style={styles.actionRow}>
          <Button title="Continue" onPress={props.onNext} />
        </View>
      </>
    );
  }

  return (
    <>
      <Text style={styles.stepTitle}>Review what we found</Text>
      <Text style={styles.stepSubtitle}>
        Tap accept to apply each item to the profile, or reject to skip.
      </Text>

      {props.outcomes.map((outcome) => (
        <Card key={outcome.id} style={styles.outcomeCard}>
          <View style={styles.outcomeHeaderRow}>
            <Text style={styles.outcomeIcon}>
              {OUTCOME_TYPE_ICONS[outcome.outcome_type]}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.outcomeType}>
                {OUTCOME_TYPE_LABELS[outcome.outcome_type]}
              </Text>
              <Text style={styles.outcomeDescription}>{outcome.description}</Text>
            </View>
          </View>

          <View style={styles.outcomeActionsRow}>
            {outcome.status === 'proposed' && (
              <>
                <TouchableOpacity
                  style={[styles.outcomeBtn, styles.outcomeBtnReject]}
                  onPress={() => props.onReject(outcome)}
                >
                  <Text style={styles.outcomeBtnRejectText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.outcomeBtn, styles.outcomeBtnAccept]}
                  onPress={() => props.onAccept(outcome)}
                >
                  <Text style={styles.outcomeBtnAcceptText}>Accept</Text>
                </TouchableOpacity>
              </>
            )}
            {(outcome.status === 'accepted' || outcome.status === 'edited') && (
              <Text style={styles.outcomeStatusAccepted}>{'\u2713'} Accepted</Text>
            )}
            {outcome.status === 'rejected' && (
              <Text style={styles.outcomeStatusRejected}>Rejected</Text>
            )}
          </View>
        </Card>
      ))}

      <View style={styles.actionRow}>
        <Button
          title={props.proposedCount > 0 ? 'Skip remaining & continue' : 'Next'}
          onPress={props.onNext}
        />
      </View>
    </>
  );
}

// ── Step 4: Confirm & finalize ─────────────────────────────────────────────

interface ConfirmStepProps {
  factsToCreate: number;
  tasksToCreate: number;
  followupTimeframe: string;
  onFinalize: () => void;
  loading: boolean;
}

function ConfirmStep(props: ConfirmStepProps) {
  return (
    <>
      <Text style={styles.stepTitle}>Ready to finalize</Text>
      <Text style={styles.stepSubtitle}>
        Here’s what will happen when you finalize this visit.
      </Text>

      <Card style={styles.summaryCard}>
        <SummaryRow
          icon="\uD83D\uDCDD"
          label={`${props.factsToCreate} profile update${
            props.factsToCreate === 1 ? '' : 's'
          } will be applied`}
        />
        <SummaryRow
          icon="\u2705"
          label={`${props.tasksToCreate} follow-up task${
            props.tasksToCreate === 1 ? '' : 's'
          } will be created`}
        />
        <SummaryRow icon="\uD83D\uDCC4" label="Visit summary will be generated" />
        {props.followupTimeframe && (
          <SummaryRow
            icon="\u23F1"
            label={`Follow-up: ${props.followupTimeframe}`}
          />
        )}
      </Card>

      <View style={styles.actionRow}>
        <Button
          title="Finalize Visit"
          onPress={props.onFinalize}
          loading={props.loading}
        />
      </View>
    </>
  );
}

function SummaryRow({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryIcon}>{icon}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

// ── Step 5: Success ─────────────────────────────────────────────────────────

interface SuccessStepProps {
  visitSummaryText: string;
  onShare: () => void;
  onDone: () => void;
}

function SuccessStep(props: SuccessStepProps) {
  return (
    <>
      <Text style={styles.successTitle}>{'\u2713'} Visit closed out</Text>
      <Text style={styles.stepSubtitle}>
        We’ve updated the profile and created the follow-up tasks.
      </Text>

      <Card style={styles.summaryCard}>
        <Text style={styles.summaryHeader}>Visit Summary</Text>
        <Text style={styles.summaryText}>{props.visitSummaryText}</Text>
      </Card>

      <View style={styles.actionRow}>
        <Button title="Share Visit Summary" variant="outline" onPress={props.onShare} />
        <View style={{ height: 12 }} />
        <Button title="Done" onPress={props.onDone} />
      </View>
    </>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: { paddingVertical: 4, paddingRight: 16 },
  backText: {
    fontSize: FONT_SIZES.lg,
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
  scrollView: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 60,
  },
  stepIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  stepIndicatorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.border.DEFAULT,
  },
  stepDotActive: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  stepDotDone: {
    backgroundColor: COLORS.success.DEFAULT,
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: COLORS.border.DEFAULT,
    marginHorizontal: 4,
  },
  stepLineActive: {
    backgroundColor: COLORS.primary.DEFAULT,
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
    marginBottom: 24,
    lineHeight: 22,
  },
  successTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.success.DEFAULT,
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 6,
    marginTop: 16,
  },
  fieldHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  textArea: {
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  choiceChip: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    alignItems: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
  },
  choiceChipActive: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
  },
  choiceChipText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  choiceChipTextActive: {
    color: COLORS.text.inverse,
  },
  actionRow: {
    marginTop: 28,
  },
  uploadActionsRow: {
    marginTop: 8,
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  uploadingText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  uploadedCard: {
    marginBottom: 8,
  },
  uploadedFileName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  uploadedStatus: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 4,
  },
  outcomeCard: {
    marginBottom: 12,
  },
  outcomeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  outcomeIcon: {
    fontSize: 24,
  },
  outcomeType: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  outcomeDescription: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    marginTop: 2,
    lineHeight: 22,
  },
  outcomeActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    justifyContent: 'flex-end',
  },
  outcomeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  outcomeBtnReject: {
    backgroundColor: COLORS.surface.muted,
  },
  outcomeBtnRejectText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
  },
  outcomeBtnAccept: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  outcomeBtnAcceptText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
  outcomeStatusAccepted: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.success.DEFAULT,
  },
  outcomeStatusRejected: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
  },
  summaryCard: {
    marginTop: 8,
  },
  summaryHeader: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  summaryText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  summaryIcon: {
    fontSize: 18,
  },
  summaryLabel: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
});
