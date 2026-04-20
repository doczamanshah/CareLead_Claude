import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Linking,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useUpdateProfile } from '@/hooks/useProfileDetail';
import {
  usePreventiveItem,
  usePreventiveItemEvents,
  useUpdatePreventiveItem,
  useUpdateLastDoneDate,
  useSetSelectedMethod,
  useDeferItem,
  useDeclineItem,
  useReopenItem,
  useRunScan,
  useCreateIntentSheet,
  useMarkAsCompleted,
  useUploadPreventiveDocument,
  useExtractCompletionDate,
  useReopenCompletedItem,
  usePreventiveDocumentUrl,
} from '@/hooks/usePreventive';
import { readFileAsBase64 } from '@/services/preventive';
import { generatePreventiveIntentSheet } from '@/services/preventiveIntentSheet';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  PREVENTIVE_STATUS_LABELS,
  PREVENTIVE_STATUS_COLORS,
  PREVENTIVE_CATEGORY_LABELS,
} from '@/lib/types/preventive';
import type {
  PreventiveItemWithRule,
  PreventiveMissingDataEntry,
  PreventiveItemEvent,
  PreventiveEventType,
  ScreeningMethod,
} from '@/lib/types/preventive';

// ── Constants ───────────────────────────────────────────────────────────────

const DEFER_OPTIONS: Array<{ label: string; months: number | null }> = [
  { label: '1 month', months: 1 },
  { label: '3 months', months: 3 },
  { label: '6 months', months: 6 },
  { label: '1 year', months: 12 },
  { label: 'Until I say', months: null },
];

const EVENT_LABELS: Record<PreventiveEventType, string> = {
  created: 'Added',
  recomputed: 'Recalculated',
  status_changed: 'Status changed',
  intent_proposed: 'Added to plan',
  intent_confirmed: 'Plan confirmed',
  intent_committed: 'Committed to plan',
  data_updated: 'Updated',
  deferred: 'Deferred',
  declined: 'Declined',
  completed: 'Completed',
  reopened: 'Reopened',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(date: string | Date | null): string | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date.length === 10 ? `${date}T00:00:00` : date) : date;
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatShortDate(date: string | Date | null): string | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date.length === 10 ? `${date}T00:00:00` : date) : date;
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const f = new Date(fromIso + 'T00:00:00');
  const t = new Date(toIso + 'T00:00:00');
  return Math.round((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24));
}

function eligibilitySummary(item: PreventiveItemWithRule): string {
  // Falls back to rule description audience line when we don't have criteria.
  // The rule's description already includes audience; we synthesize a short
  // sentence for the eligibility line under the rule explanation.
  return item.rationale?.split('.')[0] ?? 'Recommended preventive care';
}

function cadenceLine(cadenceMonths: number | null): string {
  if (cadenceMonths === null || cadenceMonths <= 0) return 'Recommended one time';
  if (cadenceMonths === 12) return 'Recommended every year';
  if (cadenceMonths < 12) return `Recommended every ${cadenceMonths} months`;
  if (cadenceMonths % 12 === 0) {
    const years = cadenceMonths / 12;
    return `Recommended every ${years} years`;
  }
  return `Recommended every ${cadenceMonths} months`;
}

function describeMonths(months: number): string {
  if (months === 12) return 'year';
  if (months < 12) return `${months} months`;
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? 'year' : `${years} years`;
  }
  return `${months} months`;
}

function findMethod(
  methods: ScreeningMethod[] | null,
  methodId: string | null,
): ScreeningMethod | null {
  if (!methods || !methodId) return null;
  return methods.find((m) => m.method_id === methodId) ?? null;
}

function lastDoneSourceLabel(source: string | null): string | null {
  switch (source) {
    case 'user_reported':
      return 'You reported';
    case 'document_backed':
      return 'From document';
    case 'extracted':
      return 'Extracted';
    case 'imported':
      return 'Imported';
    default:
      return null;
  }
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function PreventiveItemDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const itemId = id ?? null;

  const { activeProfile } = useActiveProfile();
  const profileId = activeProfile?.id ?? null;
  const householdId = activeProfile?.household_id ?? null;

  const { data: item, isLoading, error } = usePreventiveItem(itemId);
  const { data: events } = usePreventiveItemEvents(itemId);

  const updateItem = useUpdatePreventiveItem();
  const updateLastDone = useUpdateLastDoneDate();
  const setMethod = useSetSelectedMethod();
  const deferMutation = useDeferItem();
  const declineMutation = useDeclineItem();
  const reopenMutation = useReopenItem();
  const reopenCompleted = useReopenCompletedItem();
  const updateProfile = useUpdateProfile(profileId ?? '');
  const runScan = useRunScan();
  const createIntentSheet = useCreateIntentSheet();
  const markCompleted = useMarkAsCompleted();
  const uploadDocument = useUploadPreventiveDocument();
  const extractDate = useExtractCompletionDate();
  const evidenceUrlQuery = usePreventiveDocumentUrl(
    item?.last_done_evidence_path ?? null,
  );

  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [deferModalVisible, setDeferModalVisible] = useState(false);
  const [declineModalVisible, setDeclineModalVisible] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  // Completion flow state
  const [completionPhase, setCompletionPhase] = useState<
    | 'idle'
    | 'uploading'
    | 'review_extracted_date'
    | 'enter_date'
    | 'update_date'
  >('idle');
  const [extractedDate, setExtractedDate] = useState<string | null>(null);
  const [extractedConfidence, setExtractedConfidence] = useState<number>(0);
  const [pendingEvidencePath, setPendingEvidencePath] = useState<string | null>(null);
  const [manualDate, setManualDate] = useState<Date>(new Date());
  const [iosDatePickerVisible, setIosDatePickerVisible] = useState(false);
  const [androidDatePickerVisible, setAndroidDatePickerVisible] = useState(false);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(main)/preventive');
  }, [router]);

  const handleHome = useCallback(() => {
    router.replace('/(main)/(tabs)');
  }, [router]);

  const handleOpenGuideline = useCallback(() => {
    const url = item?.rule.guideline_url;
    if (!url) return;
    Linking.openURL(url).catch(() => {
      Alert.alert('Unable to open link', 'Could not open the guideline URL.');
    });
  }, [item]);

  const handleSaveNotes = useCallback(() => {
    if (!item || notesDraft === null) return;
    const trimmed = notesDraft.trim();
    const current = item.notes ?? '';
    if (trimmed === current) {
      setNotesDraft(null);
      return;
    }
    updateItem.mutate(
      { itemId: item.id, updates: { notes: trimmed || null } },
      { onSettled: () => setNotesDraft(null) },
    );
  }, [item, notesDraft, updateItem]);

  const handleDefer = useCallback(
    (months: number | null) => {
      if (!item || !profileId || !householdId) return;
      let deferredUntil: string | null = null;
      if (months !== null) {
        const d = new Date();
        d.setMonth(d.getMonth() + months);
        deferredUntil = toDateOnly(d);
      }
      deferMutation.mutate(
        { itemId: item.id, deferredUntil, profileId, householdId },
        { onSettled: () => setDeferModalVisible(false) },
      );
    },
    [item, profileId, householdId, deferMutation],
  );

  const handleDecline = useCallback(() => {
    if (!item || !profileId || !householdId) return;
    const reason = declineReason.trim() || null;
    declineMutation.mutate(
      { itemId: item.id, reason, profileId, householdId },
      {
        onSettled: () => {
          setDeclineModalVisible(false);
          setDeclineReason('');
        },
      },
    );
  }, [item, profileId, householdId, declineMutation, declineReason]);

  const handleReopen = useCallback(() => {
    if (!item || !profileId || !householdId) return;
    reopenMutation.mutate({ itemId: item.id, profileId, householdId });
  }, [item, profileId, householdId, reopenMutation]);

  const handleAddToPlan = useCallback(() => {
    if (!item || !profileId || !householdId) return;
    const content = generatePreventiveIntentSheet({
      profileId,
      householdId,
      selectedItems: [item],
    });
    createIntentSheet.mutate(
      { profileId, householdId, content },
      {
        onSuccess: (sheet) => {
          router.push({
            pathname: '/(main)/preventive/intent-review',
            params: { sheetId: sheet.id },
          });
        },
        onError: (err) => {
          Alert.alert('Could not start plan', err instanceof Error ? err.message : 'Please try again.');
        },
      },
    );
  }, [item, profileId, householdId, createIntentSheet, router]);

  const handleNeverDone = useCallback(() => {
    if (!item) return;
    updateItem.mutate({
      itemId: item.id,
      updates: {
        last_done_date: null,
        last_done_source: null,
        status: 'due',
        rationale: 'No previous screening on record. Ready to schedule when you are.',
        missing_data: [],
      },
    });
  }, [item, updateItem]);

  // ── Completion flow callbacks ───────────────────────────────────────────

  async function handleProofUpload(fileUri: string, fileName: string, mimeType: string) {
    if (!item || !profileId || !householdId) return;

    setCompletionPhase('uploading');

    try {
      const base64Result = await readFileAsBase64(fileUri);
      if (!base64Result.success) {
        throw new Error(base64Result.error);
      }

      const [extractRes, uploadRes] = await Promise.all([
        extractDate.mutateAsync({
          documentBase64: base64Result.data,
          mimeType,
          screeningType: item.rule.category,
          screeningTitle: item.rule.title,
        }),
        uploadDocument.mutateAsync({
          itemId: item.id,
          profileId,
          householdId,
          fileUri,
          fileName,
          mimeType,
        }),
      ]);

      setPendingEvidencePath(uploadRes.filePath);

      if (extractRes.dateFound && extractRes.completionDate) {
        setExtractedDate(extractRes.completionDate);
        setExtractedConfidence(extractRes.confidence);
        setCompletionPhase('review_extracted_date');
      } else {
        // No date found — fall back to manual entry, but the evidence file is still linked
        setExtractedDate(null);
        setCompletionPhase('enter_date');
      }
    } catch (err) {
      setCompletionPhase('idle');
      setPendingEvidencePath(null);
      Alert.alert(
        'Upload failed',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  }

  async function pickImageFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const mime = asset.mimeType ?? 'image/jpeg';
    if (mime === 'image/heic' || mime === 'image/heif') {
      Alert.alert('Unsupported format', 'HEIC/HEIF images are not supported. Please use JPEG or PNG.');
      return;
    }
    const fileName = asset.fileName ?? `preventive-proof-${Date.now()}.jpg`;
    handleProofUpload(asset.uri, fileName, mime);
  }

  async function pickDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const mime = asset.mimeType ?? 'application/pdf';
      if (mime === 'image/heic' || mime === 'image/heif') {
        Alert.alert('Unsupported format', 'HEIC/HEIF images are not supported.');
        return;
      }
      handleProofUpload(asset.uri, asset.name, mime);
    } catch {
      Alert.alert('Error', 'Could not open the document picker.');
    }
  }

  const handleUploadProof = useCallback(() => {
    Alert.alert('Upload Proof', 'Choose how to add your proof document.', [
      { text: 'Choose from Library', onPress: () => void pickImageFromLibrary() },
      { text: 'Upload PDF or Image', onPress: () => void pickDocument() },
      { text: 'Cancel', style: 'cancel' },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, profileId, householdId]);

  const confirmExtractedDate = useCallback(() => {
    if (!item || !profileId || !householdId || !extractedDate) return;
    markCompleted.mutate(
      {
        itemId: item.id,
        profileId,
        householdId,
        completionDate: extractedDate,
        source: 'document_backed',
        evidenceDocumentPath: pendingEvidencePath,
      },
      {
        onSuccess: () => {
          setCompletionPhase('idle');
          setExtractedDate(null);
          setExtractedConfidence(0);
          setPendingEvidencePath(null);
        },
        onError: (err) => {
          Alert.alert(
            'Could not mark completed',
            err instanceof Error ? err.message : 'Please try again.',
          );
        },
      },
    );
  }, [item, profileId, householdId, extractedDate, pendingEvidencePath, markCompleted]);

  const saveManualDate = useCallback(
    (date: Date) => {
      if (!item || !profileId || !householdId) return;
      const isDocumentBacked = !!pendingEvidencePath;
      const completionDate = toDateOnly(date);
      markCompleted.mutate(
        {
          itemId: item.id,
          profileId,
          householdId,
          completionDate,
          source: isDocumentBacked ? 'document_backed' : 'user_reported',
          evidenceDocumentPath: pendingEvidencePath,
        },
        {
          onSuccess: () => {
            setCompletionPhase('idle');
            setExtractedDate(null);
            setPendingEvidencePath(null);
            setIosDatePickerVisible(false);
            setAndroidDatePickerVisible(false);
          },
          onError: (err) => {
            Alert.alert(
              'Could not mark completed',
              err instanceof Error ? err.message : 'Please try again.',
            );
          },
        },
      );
    },
    [item, profileId, householdId, pendingEvidencePath, markCompleted],
  );

  const handleEnterDateManually = useCallback(() => {
    setPendingEvidencePath(null);
    setExtractedDate(null);
    setManualDate(new Date());
    setCompletionPhase('enter_date');
    if (Platform.OS === 'ios') setIosDatePickerVisible(true);
    else setAndroidDatePickerVisible(true);
  }, []);

  const handleUpdateCompletion = useCallback(() => {
    if (!item) return;
    const current = item.last_done_date
      ? new Date(item.last_done_date + 'T00:00:00')
      : new Date();
    setManualDate(current);
    setPendingEvidencePath(item.last_done_evidence_path ?? null);
    setCompletionPhase('update_date');
    if (Platform.OS === 'ios') setIosDatePickerVisible(true);
    else setAndroidDatePickerVisible(true);
  }, [item]);

  const handleRejectExtractedDate = useCallback(() => {
    setExtractedDate(null);
    setManualDate(new Date());
    setCompletionPhase('enter_date');
    if (Platform.OS === 'ios') setIosDatePickerVisible(true);
    else setAndroidDatePickerVisible(true);
  }, []);

  const cancelCompletion = useCallback(() => {
    setCompletionPhase('idle');
    setExtractedDate(null);
    setExtractedConfidence(0);
    setPendingEvidencePath(null);
    setIosDatePickerVisible(false);
    setAndroidDatePickerVisible(false);
  }, []);

  const handleUndoCompletion = useCallback(() => {
    if (!item || !profileId || !householdId) return;
    Alert.alert(
      'Undo completion?',
      'This will clear the completion date and move the screening back into review.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo',
          style: 'destructive',
          onPress: () => {
            reopenCompleted.mutate(
              { itemId: item.id, profileId, householdId },
              {
                onError: (err) => {
                  Alert.alert(
                    'Could not undo',
                    err instanceof Error ? err.message : 'Please try again.',
                  );
                },
              },
            );
          },
        },
      ],
    );
  }, [item, profileId, householdId, reopenCompleted]);

  const handleViewProof = useCallback(() => {
    const url = evidenceUrlQuery.data;
    if (!url) return;
    Linking.openURL(url).catch(() => {
      Alert.alert('Unable to open', 'Could not open the proof document.');
    });
  }, [evidenceUrlQuery.data]);

  if (!itemId) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header onBack={handleBack} onHome={handleHome} title="Preventive Care" />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Item not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header onBack={handleBack} onHome={handleHome} title="Preventive Care" />
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.primary.DEFAULT} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !item) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header onBack={handleBack} onHome={handleHome} title="Preventive Care" />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={36} color={COLORS.text.tertiary} />
          <Text style={styles.errorText}>Couldn't load this item.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const statusColor = PREVENTIVE_STATUS_COLORS[item.status];
  const statusLabel = PREVENTIVE_STATUS_LABELS[item.status];
  const categoryLabel = PREVENTIVE_CATEGORY_LABELS[item.rule.category];
  const isDeferred = item.status === 'deferred';
  const isDeclined = item.status === 'declined';
  const isCompleted = item.status === 'completed' || item.status === 'up_to_date';
  const canMarkComplete =
    item.status === 'due' ||
    item.status === 'due_soon' ||
    item.status === 'scheduled' ||
    item.status === 'needs_review';
  const completionBusy =
    markCompleted.isPending ||
    uploadDocument.isPending ||
    extractDate.isPending ||
    completionPhase === 'uploading';

  const dueSoonDays =
    item.status === 'due_soon' && item.due_date
      ? daysBetween(new Date().toISOString().slice(0, 10), item.due_date)
      : null;

  const guidelineBadgeText = item.rule.guideline_version
    ? `${item.rule.guideline_source} ${item.rule.guideline_version}`
    : item.rule.guideline_source;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        {/* Header */}
        <Header onBack={handleBack} onHome={handleHome} title={item.rule.title}>
          <View style={[styles.statusBadgeLarge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusBadgeLargeText, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </View>
        </Header>

        {/* Completed banner */}
        {isCompleted && item.last_done_date && (
          <View style={styles.section}>
            <View style={styles.completedBanner}>
              <Ionicons
                name="checkmark-circle"
                size={28}
                color={COLORS.success.DEFAULT}
              />
              <View style={styles.completedBannerText}>
                <Text style={styles.completedBannerTitle}>
                  {(() => {
                    const method = findMethod(
                      item.rule.screening_methods ?? null,
                      item.selected_method,
                    );
                    return method
                      ? `${method.name} — completed ${formatDate(item.last_done_date)}`
                      : `Completed on ${formatDate(item.last_done_date)}`;
                  })()}
                </Text>
                <View style={styles.completedBannerMetaRow}>
                  {item.last_done_source && (
                    <View style={styles.completedSourceBadge}>
                      <Ionicons
                        name={
                          item.last_done_source === 'document_backed'
                            ? 'document-text-outline'
                            : 'person-outline'
                        }
                        size={12}
                        color={COLORS.secondary.dark}
                      />
                      <Text style={styles.completedSourceBadgeText}>
                        {lastDoneSourceLabel(item.last_done_source) ?? 'Source unknown'}
                      </Text>
                    </View>
                  )}
                  {item.next_due_date && (
                    <Text style={styles.completedNextDueText}>
                      Next due {formatDate(item.next_due_date)}
                    </Text>
                  )}
                </View>
                {item.last_done_source === 'document_backed' &&
                  item.last_done_evidence_path && (
                    <TouchableOpacity
                      onPress={handleViewProof}
                      disabled={!evidenceUrlQuery.data}
                      activeOpacity={0.7}
                      style={styles.viewProofRow}
                    >
                      <Ionicons
                        name="eye-outline"
                        size={14}
                        color={COLORS.primary.DEFAULT}
                      />
                      <Text style={styles.viewProofText}>View proof document</Text>
                    </TouchableOpacity>
                  )}
              </View>
            </View>
          </View>
        )}

        {/* Zone b: Rule explanation */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WHY THIS APPLIES TO YOU</Text>
          <Card>
            <Text style={styles.ruleDescription}>{item.rule.description}</Text>
            <Text style={styles.ruleMeta}>{eligibilitySummary(item)}</Text>
            <Text style={styles.ruleMeta}>
              {(() => {
                const method = findMethod(
                  item.rule.screening_methods ?? null,
                  item.selected_method,
                );
                if (method) return `Recommended every ${describeMonths(method.cadence_months)}`;
                if (item.rule.screening_methods && item.rule.screening_methods.length > 0) {
                  return 'Multiple options — cadence depends on which one you choose.';
                }
                return cadenceLine(item.rule.cadence_months);
              })()}
            </Text>
            <View style={styles.ruleFooter}>
              <View style={styles.categoryChip}>
                <Text style={styles.categoryChipText}>{categoryLabel}</Text>
              </View>
              <TouchableOpacity
                onPress={handleOpenGuideline}
                disabled={!item.rule.guideline_url}
                style={styles.guidelineBadge}
                activeOpacity={item.rule.guideline_url ? 0.7 : 1}
              >
                <Text style={styles.guidelineBadgeText}>{guidelineBadgeText}</Text>
                {item.rule.guideline_url && (
                  <Ionicons
                    name="open-outline"
                    size={12}
                    color={COLORS.primary.DEFAULT}
                    style={{ marginLeft: 4 }}
                  />
                )}
              </TouchableOpacity>
            </View>
          </Card>
        </View>

        {/* Zone c: Current status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CURRENT STATUS</Text>
          <Card>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusLabelBig, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            {item.rationale && <Text style={styles.rationaleText}>{item.rationale}</Text>}
            {item.status === 'due' && item.due_date && (
              <View style={styles.metaRow}>
                <Ionicons name="alert-circle" size={16} color={COLORS.error.DEFAULT} />
                <Text style={styles.metaText}>Due now</Text>
              </View>
            )}
            {dueSoonDays !== null && (
              <View style={styles.metaRow}>
                <Ionicons name="time-outline" size={16} color={COLORS.warning.DEFAULT} />
                <Text style={styles.metaText}>
                  {dueSoonDays <= 0
                    ? 'Due now'
                    : `Due in ${dueSoonDays} day${dueSoonDays === 1 ? '' : 's'}`}
                </Text>
              </View>
            )}
            {item.next_due_date && item.status !== 'due' && (
              <View style={styles.metaRow}>
                <Ionicons name="calendar-outline" size={16} color={COLORS.text.tertiary} />
                <Text style={styles.metaText}>Next due: {formatDate(item.next_due_date)}</Text>
              </View>
            )}
          </Card>
        </View>

        {/* Zone c2: Screening method (when rule supports multiple) */}
        {item.rule.screening_methods && item.rule.screening_methods.length > 0 && (
          <ScreeningMethodSection
            methods={item.rule.screening_methods}
            selectedMethod={item.selected_method}
            onSelect={(methodId) => {
              if (!profileId || !householdId) return;
              setMethod.mutate({
                itemId: item.id,
                methodId,
                profileId,
                householdId,
              });
            }}
            submitting={setMethod.isPending}
          />
        )}

        {/* Zone d: Last screening */}
        <LastScreeningSection
          item={item}
          onEnterDate={(date) => {
            if (!profileId || !householdId) return;
            updateLastDone.mutate({
              itemId: item.id,
              date: toDateOnly(date),
              source: 'user_reported',
              profileId,
              householdId,
            });
          }}
          onNeverDone={handleNeverDone}
          submitting={updateLastDone.isPending || updateItem.isPending}
        />

        {/* Zone e: Missing data prompts (excluding selected_method, handled above) */}
        {item.missing_data && item.missing_data.filter((e) => e.field !== 'selected_method').length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>HELP US GIVE YOU A BETTER RECOMMENDATION</Text>
            {item.missing_data.filter((e) => e.field !== 'selected_method').map((entry, idx) => (
              <MissingDataCard
                key={`${entry.field}-${idx}`}
                entry={entry}
                onSubmit={async (value) => {
                  if (!profileId || !householdId) return;
                  if (entry.field === 'date_of_birth') {
                    await updateProfile.mutateAsync({ date_of_birth: value });
                    runScan.mutate({ profileId, householdId });
                  } else if (entry.field === 'sex') {
                    await updateProfile.mutateAsync({ gender: value });
                    runScan.mutate({ profileId, householdId });
                  } else if (entry.field === 'last_done_date') {
                    updateLastDone.mutate({
                      itemId: item.id,
                      date: value,
                      source: 'user_reported',
                      profileId,
                      householdId,
                    });
                  }
                }}
              />
            ))}
          </View>
        )}

        {/* Mark as Complete */}
        {canMarkComplete && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>MARK AS COMPLETE</Text>
            <Card>
              <Text style={styles.markCompleteHelper}>
                Recording a completion here updates your preventive care and schedules
                the next one when it's due.
              </Text>
              <TouchableOpacity
                style={styles.completeOption}
                onPress={handleUploadProof}
                disabled={completionBusy}
                activeOpacity={0.7}
              >
                <View style={styles.completeOptionIcon}>
                  <Ionicons
                    name="document-text-outline"
                    size={20}
                    color={COLORS.primary.DEFAULT}
                  />
                </View>
                <View style={styles.completeOptionText}>
                  <Text style={styles.completeOptionTitle}>Upload Proof</Text>
                  <Text style={styles.completeOptionSubtitle}>
                    Share a lab result, vaccination card, or other document
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={COLORS.text.tertiary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.completeOption}
                onPress={handleEnterDateManually}
                disabled={completionBusy}
                activeOpacity={0.7}
              >
                <View style={styles.completeOptionIcon}>
                  <Ionicons
                    name="calendar-outline"
                    size={20}
                    color={COLORS.primary.DEFAULT}
                  />
                </View>
                <View style={styles.completeOptionText}>
                  <Text style={styles.completeOptionTitle}>Enter Completion Date</Text>
                  <Text style={styles.completeOptionSubtitle}>
                    I know the date but don't have a document
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={COLORS.text.tertiary}
                />
              </TouchableOpacity>

              {completionBusy && (
                <View style={styles.completionBusyRow}>
                  <ActivityIndicator size="small" color={COLORS.primary.DEFAULT} />
                  <Text style={styles.completionBusyText}>
                    {completionPhase === 'uploading'
                      ? 'Uploading and reading your document...'
                      : 'Saving...'}
                  </Text>
                </View>
              )}
            </Card>
          </View>
        )}

        {/* Update completion for already-completed items */}
        {isCompleted && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>COMPLETION</Text>
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={handleUpdateCompletion}
              disabled={completionBusy}
              activeOpacity={0.7}
            >
              <Ionicons
                name="create-outline"
                size={18}
                color={COLORS.primary.DEFAULT}
              />
              <Text style={styles.secondaryActionText}>Update Completion Date</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tertiaryAction}
              onPress={handleUndoCompletion}
              disabled={reopenCompleted.isPending}
              activeOpacity={0.7}
            >
              {reopenCompleted.isPending ? (
                <ActivityIndicator size="small" color={COLORS.text.tertiary} />
              ) : (
                <Text style={styles.tertiaryActionText}>Reopen</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Zone f: Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACTIONS</Text>
          {isCompleted ? (
            <View style={[styles.primaryAction, styles.primaryActionActive]}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.success.DEFAULT} />
              <View style={styles.primaryActionTextWrap}>
                <Text style={styles.primaryActionTitle}>Up to Date</Text>
                <Text style={styles.primaryActionSubtitle}>
                  {item.next_due_date
                    ? `Next due ${formatDate(item.next_due_date)}`
                    : 'No further action needed'}
                </Text>
              </View>
            </View>
          ) : item.status === 'scheduled' ? (
            <View style={[styles.primaryAction, styles.primaryActionActive]}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.success.DEFAULT} />
              <View style={styles.primaryActionTextWrap}>
                <Text style={styles.primaryActionTitle}>In Your Plan</Text>
                <Text style={styles.primaryActionSubtitle}>Tasks created — track them in Tasks</Text>
              </View>
            </View>
          ) : !isDeferred && !isDeclined ? (
            <TouchableOpacity
              style={styles.primaryAction}
              onPress={handleAddToPlan}
              disabled={createIntentSheet.isPending}
              activeOpacity={0.7}
            >
              {createIntentSheet.isPending ? (
                <ActivityIndicator color={COLORS.primary.DEFAULT} />
              ) : (
                <Ionicons name="add-circle" size={20} color={COLORS.primary.DEFAULT} />
              )}
              <View style={styles.primaryActionTextWrap}>
                <Text style={styles.primaryActionTitle}>Add to My Plan</Text>
                <Text style={styles.primaryActionSubtitle}>
                  Generate follow-up tasks and reminders you can review
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.text.tertiary} />
            </TouchableOpacity>
          ) : null}

          {isDeferred ? (
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={handleReopen}
              disabled={reopenMutation.isPending}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh-outline" size={18} color={COLORS.primary.DEFAULT} />
              <Text style={styles.secondaryActionText}>Reopen</Text>
            </TouchableOpacity>
          ) : isDeclined ? (
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={handleReopen}
              disabled={reopenMutation.isPending}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh-outline" size={18} color={COLORS.primary.DEFAULT} />
              <Text style={styles.secondaryActionText}>Reconsider</Text>
            </TouchableOpacity>
          ) : isCompleted ? null : (
            <>
              <TouchableOpacity
                style={styles.secondaryAction}
                onPress={() => setDeferModalVisible(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="time-outline" size={18} color={COLORS.primary.DEFAULT} />
                <Text style={styles.secondaryActionText}>Defer</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.tertiaryAction}
                onPress={() => setDeclineModalVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.tertiaryActionText}>Decline</Text>
              </TouchableOpacity>
            </>
          )}

          {isDeferred && item.deferred_until && (
            <Text style={styles.actionNote}>
              We'll remind you around {formatDate(item.deferred_until)}.
            </Text>
          )}
          {isDeferred && !item.deferred_until && (
            <Text style={styles.actionNote}>
              Deferred indefinitely. You can reopen this anytime.
            </Text>
          )}
          {isDeclined && (
            <Text style={styles.actionNote}>
              You can revisit this anytime from Preventive Care.
            </Text>
          )}
        </View>

        {/* Zone h: Notes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>NOTES</Text>
          <Card>
            <TextInput
              style={styles.notesInput}
              placeholder="Add private notes about this screening..."
              placeholderTextColor={COLORS.text.tertiary}
              multiline
              value={notesDraft !== null ? notesDraft : item.notes ?? ''}
              onChangeText={setNotesDraft}
              onBlur={handleSaveNotes}
            />
          </Card>
        </View>

        {/* Zone g: Event history */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.historyHeader}
            onPress={() => setHistoryExpanded((v) => !v)}
            activeOpacity={0.7}
          >
            <Text style={styles.sectionTitle}>HISTORY</Text>
            <Ionicons
              name={historyExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={COLORS.text.tertiary}
            />
          </TouchableOpacity>
          {historyExpanded && (
            <Card>
              {(events ?? []).length === 0 ? (
                <Text style={styles.emptyHistoryText}>No activity yet.</Text>
              ) : (
                (events ?? []).map((ev, i) => (
                  <HistoryRow
                    key={ev.id}
                    event={ev}
                    isLast={i === (events ?? []).length - 1}
                  />
                ))
              )}
            </Card>
          )}
        </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Defer modal */}
      <Modal
        visible={deferModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeferModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setDeferModalVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            <Text style={styles.modalTitle}>Defer this screening</Text>
            <Text style={styles.modalSubtitle}>
              When should we check back in with you?
            </Text>
            {DEFER_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.label}
                style={styles.deferOption}
                onPress={() => handleDefer(opt.months)}
                activeOpacity={0.7}
              >
                <Text style={styles.deferOptionText}>{opt.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.text.tertiary} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => setDeferModalVisible(false)}
              style={styles.modalCancelRow}
              activeOpacity={0.7}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Decline modal */}
      <Modal
        visible={declineModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeclineModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setDeclineModalVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalCard}>
            <Text style={styles.modalTitle}>Decline this screening</Text>
            <Text style={styles.modalSubtitle}>
              Share a reason if you'd like — it's optional and helps us keep your
              records accurate.
            </Text>
            <TextInput
              style={styles.declineInput}
              placeholder="Reason (optional)"
              placeholderTextColor={COLORS.text.tertiary}
              multiline
              value={declineReason}
              onChangeText={setDeclineReason}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSecondaryButton}
                onPress={() => {
                  setDeclineModalVisible(false);
                  setDeclineReason('');
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.modalSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalPrimaryButton}
                onPress={handleDecline}
                disabled={declineMutation.isPending}
                activeOpacity={0.7}
              >
                {declineMutation.isPending ? (
                  <ActivityIndicator color={COLORS.text.inverse} />
                ) : (
                  <Text style={styles.modalPrimaryText}>Decline</Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* Review extracted date modal */}
      <Modal
        visible={completionPhase === 'review_extracted_date'}
        transparent
        animationType="fade"
        onRequestClose={cancelCompletion}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Does this date look right?</Text>
            <Text style={styles.modalSubtitle}>
              CareLead found a date of{' '}
              <Text style={styles.modalSubtitleEmphasis}>
                {extractedDate ? formatDate(extractedDate) : ''}
              </Text>{' '}
              in this document. Is this when the screening was done?
            </Text>
            {extractedConfidence > 0 && extractedConfidence < 0.7 && (
              <View style={styles.lowConfidenceHint}>
                <Ionicons
                  name="information-circle-outline"
                  size={14}
                  color={COLORS.warning.DEFAULT}
                />
                <Text style={styles.lowConfidenceText}>
                  Low confidence — please double-check.
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.modalPrimaryButtonWide}
              onPress={confirmExtractedDate}
              disabled={markCompleted.isPending}
              activeOpacity={0.8}
            >
              {markCompleted.isPending ? (
                <ActivityIndicator color={COLORS.text.inverse} />
              ) : (
                <Text style={styles.modalPrimaryText}>Yes, confirm</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalSecondaryButtonWide}
              onPress={handleRejectExtractedDate}
              disabled={markCompleted.isPending}
              activeOpacity={0.7}
            >
              <Text style={styles.modalSecondaryText}>No, enter correct date</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancelRow}
              onPress={cancelCompletion}
              disabled={markCompleted.isPending}
              activeOpacity={0.7}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Manual date picker — iOS */}
      {Platform.OS === 'ios' && iosDatePickerVisible && (
        <Modal transparent animationType="slide" visible={iosDatePickerVisible}>
          <View style={styles.iosPickerBackdrop}>
            <View style={styles.iosPickerSheet}>
              <View style={styles.iosPickerHeader}>
                <TouchableOpacity
                  onPress={() => {
                    setIosDatePickerVisible(false);
                    if (completionPhase === 'enter_date') cancelCompletion();
                    else setCompletionPhase('idle');
                  }}
                >
                  <Text style={styles.iosPickerCancel}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.iosPickerTitle}>
                  {completionPhase === 'update_date'
                    ? 'Update completion date'
                    : 'When was it done?'}
                </Text>
                <TouchableOpacity
                  onPress={() => saveManualDate(manualDate)}
                  disabled={markCompleted.isPending}
                >
                  {markCompleted.isPending ? (
                    <ActivityIndicator color={COLORS.primary.DEFAULT} size="small" />
                  ) : (
                    <Text style={styles.iosPickerDone}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={manualDate}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                minimumDate={new Date(1900, 0, 1)}
                onChange={(_, d) => d && setManualDate(d)}
                style={styles.iosPicker}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* Manual date picker — Android */}
      {Platform.OS === 'android' && androidDatePickerVisible && (
        <DateTimePicker
          value={manualDate}
          mode="date"
          display="default"
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
          onChange={(_, d) => {
            setAndroidDatePickerVisible(false);
            if (d) saveManualDate(d);
            else if (completionPhase === 'enter_date') cancelCompletion();
            else setCompletionPhase('idle');
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────

function Header({
  onBack,
  onHome,
  title,
  children,
}: {
  onBack: () => void;
  onHome?: () => void;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTopRow}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary.DEFAULT} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        {onHome && (
          <TouchableOpacity
            onPress={onHome}
            style={styles.homeButton}
            activeOpacity={0.7}
            hitSlop={8}
            accessibilityLabel="Go to Home"
          >
            <Ionicons name="home-outline" size={20} color={COLORS.text.secondary} />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.headerTitleRow}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      </View>
      {children && <View style={styles.headerChildren}>{children}</View>}
    </View>
  );
}

// ── Screening Method Section ───────────────────────────────────────────────

function ScreeningMethodSection({
  methods,
  selectedMethod,
  onSelect,
  submitting,
}: {
  methods: ScreeningMethod[];
  selectedMethod: string | null;
  onSelect: (methodId: string) => void;
  submitting: boolean;
}) {
  const current = methods.find((m) => m.method_id === selectedMethod) ?? null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {current ? 'SCREENING TYPE' : 'WHICH TYPE APPLIES TO YOU?'}
      </Text>
      <Card>
        <Text style={styles.methodIntroText}>
          {current
            ? 'You can update this if you used a different test.'
            : 'This screening has multiple options. Pick the one you had (or plan to have) so we can set the right follow-up schedule.'}
        </Text>
        <View style={styles.methodList}>
          {methods.map((m) => {
            const isSelected = m.method_id === selectedMethod;
            return (
              <TouchableOpacity
                key={m.method_id}
                style={[styles.methodCard, isSelected && styles.methodCardSelected]}
                onPress={() => onSelect(m.method_id)}
                disabled={submitting}
                activeOpacity={0.7}
              >
                <View style={styles.methodCardHeader}>
                  <View style={styles.methodCardTitleRow}>
                    <Text
                      style={[
                        styles.methodCardTitle,
                        isSelected && styles.methodCardTitleSelected,
                      ]}
                    >
                      {m.name}
                    </Text>
                    <Text style={styles.methodCardCadence}>
                      every {describeMonths(m.cadence_months)}
                    </Text>
                  </View>
                  {isSelected && (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={COLORS.primary.DEFAULT}
                    />
                  )}
                </View>
                <Text style={styles.methodCardDescription}>{m.description}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>
    </View>
  );
}

// ── Last Screening Section ─────────────────────────────────────────────────

function LastScreeningSection({
  item,
  onEnterDate,
  onNeverDone,
  submitting,
}: {
  item: PreventiveItemWithRule;
  onEnterDate: (date: Date) => void;
  onNeverDone: () => void;
  submitting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pickerValue, setPickerValue] = useState<Date>(
    item.last_done_date ? new Date(item.last_done_date + 'T00:00:00') : new Date(),
  );
  const [iosPickerVisible, setIosPickerVisible] = useState(false);

  const sourceLabel = lastDoneSourceLabel(item.last_done_source);

  function openPicker() {
    setPickerValue(
      item.last_done_date
        ? new Date(item.last_done_date + 'T00:00:00')
        : new Date(),
    );
    setIosPickerVisible(true);
    setEditing(true);
  }

  function handleAndroidChange(_: unknown, selectedDate?: Date) {
    setEditing(false);
    if (selectedDate) {
      setPickerValue(selectedDate);
      onEnterDate(selectedDate);
    }
  }

  function handleIosDone() {
    setIosPickerVisible(false);
    setEditing(false);
    onEnterDate(pickerValue);
  }

  function handleIosCancel() {
    setIosPickerVisible(false);
    setEditing(false);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>LAST SCREENING</Text>
      <Card>
        {item.last_done_date ? (
          <>
            <Text style={styles.lastDoneLabel}>Last completed</Text>
            <Text style={styles.lastDoneValue}>{formatDate(item.last_done_date)}</Text>
            {sourceLabel && (
              <View style={styles.sourceBadge}>
                <Ionicons name="checkmark-outline" size={12} color={COLORS.secondary.dark} />
                <Text style={styles.sourceBadgeText}>{sourceLabel}</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.linkButton}
              onPress={openPicker}
              activeOpacity={0.7}
              disabled={submitting}
            >
              <Ionicons name="create-outline" size={16} color={COLORS.primary.DEFAULT} />
              <Text style={styles.linkButtonText}>Update date</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.lastDonePrompt}>
              Do you know when you last had this done?
            </Text>
            <Text style={styles.lastDoneHelper}>
              Even an approximate month works — it helps us schedule the next one.
            </Text>
            <View style={styles.lastDoneButtonsColumn}>
              <TouchableOpacity
                style={styles.lastDonePrimaryButton}
                onPress={openPicker}
                activeOpacity={0.8}
                disabled={submitting}
              >
                <Ionicons name="calendar-outline" size={16} color={COLORS.text.inverse} />
                <Text style={styles.lastDonePrimaryText}>Enter Date</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.lastDoneSecondaryButton}
                onPress={onNeverDone}
                activeOpacity={0.7}
                disabled={submitting}
              >
                <Text style={styles.lastDoneSecondaryText}>I've never had this</Text>
              </TouchableOpacity>
              <Text style={styles.lastDoneHint}>
                Not sure? No problem — leave it blank for now.
              </Text>
            </View>
          </>
        )}
      </Card>

      {Platform.OS === 'android' && editing && (
        <DateTimePicker
          value={pickerValue}
          mode="date"
          display="default"
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
          onChange={handleAndroidChange}
        />
      )}

      {Platform.OS === 'ios' && iosPickerVisible && (
        <Modal transparent animationType="slide" visible={iosPickerVisible}>
          <View style={styles.iosPickerBackdrop}>
            <View style={styles.iosPickerSheet}>
              <View style={styles.iosPickerHeader}>
                <TouchableOpacity onPress={handleIosCancel}>
                  <Text style={styles.iosPickerCancel}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.iosPickerTitle}>When was it done?</Text>
                <TouchableOpacity onPress={handleIosDone}>
                  <Text style={styles.iosPickerDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerValue}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                minimumDate={new Date(1900, 0, 1)}
                onChange={(_, d) => d && setPickerValue(d)}
                style={styles.iosPicker}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ── Missing Data Card ──────────────────────────────────────────────────────

const SEX_OPTIONS = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
];

function MissingDataCard({
  entry,
  onSubmit,
}: {
  entry: PreventiveMissingDataEntry;
  onSubmit: (value: string) => Promise<void> | void;
}) {
  const [dateValue, setDateValue] = useState<Date | null>(null);
  const [sexValue, setSexValue] = useState<string | null>(null);
  const [conditionsText, setConditionsText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);
  const [iosPickerVisible, setIosPickerVisible] = useState(false);
  const [pickerDraft, setPickerDraft] = useState<Date>(new Date());

  const isDate = entry.field === 'last_done_date' || entry.field === 'date_of_birth';
  const isSex = entry.field === 'sex';
  const isConditions = entry.field === 'conditions';

  function openPicker() {
    setPickerDraft(dateValue ?? new Date());
    if (Platform.OS === 'ios') {
      setIosPickerVisible(true);
    } else {
      setShowAndroidPicker(true);
    }
  }

  async function handleSave() {
    setSubmitting(true);
    try {
      if (isDate && dateValue) {
        await onSubmit(toDateOnly(dateValue));
      } else if (isSex && sexValue) {
        await onSubmit(sexValue);
      } else if (isConditions && conditionsText.trim()) {
        await onSubmit(conditionsText.trim());
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canSave =
    (isDate && dateValue !== null) ||
    (isSex && sexValue !== null) ||
    (isConditions && conditionsText.trim().length > 0);

  return (
    <Card style={styles.missingCard}>
      <View style={styles.missingHeaderRow}>
        <Ionicons
          name="help-circle-outline"
          size={18}
          color={COLORS.accent.dark}
          style={{ marginTop: 2 }}
        />
        <Text style={styles.missingPrompt}>{entry.prompt}</Text>
      </View>

      <View style={styles.missingInputWrap}>
        {isDate && (
          <TouchableOpacity
            style={styles.missingDateField}
            onPress={openPicker}
            activeOpacity={0.7}
          >
            <Text
              style={dateValue ? styles.missingDateText : styles.missingDatePlaceholder}
            >
              {dateValue ? formatShortDate(dateValue) : 'Tap to select a date'}
            </Text>
            <Ionicons name="calendar-outline" size={16} color={COLORS.text.tertiary} />
          </TouchableOpacity>
        )}

        {isSex && (
          <View style={styles.sexOptionsRow}>
            {SEX_OPTIONS.map((opt) => {
              const selected = sexValue === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.sexChip, selected && styles.sexChipSelected]}
                  onPress={() => setSexValue(opt.value)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[styles.sexChipText, selected && styles.sexChipTextSelected]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {isConditions && (
          <TextInput
            style={styles.conditionsInput}
            placeholder="e.g. overweight, high blood pressure"
            placeholderTextColor={COLORS.text.tertiary}
            value={conditionsText}
            onChangeText={setConditionsText}
          />
        )}
      </View>

      <TouchableOpacity
        style={[styles.missingSaveButton, !canSave && styles.missingSaveButtonDisabled]}
        onPress={handleSave}
        disabled={!canSave || submitting}
        activeOpacity={0.8}
      >
        {submitting ? (
          <ActivityIndicator color={COLORS.text.inverse} />
        ) : (
          <Text style={styles.missingSaveText}>Save</Text>
        )}
      </TouchableOpacity>

      {Platform.OS === 'android' && showAndroidPicker && (
        <DateTimePicker
          value={pickerDraft}
          mode="date"
          display="default"
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
          onChange={(_, d) => {
            setShowAndroidPicker(false);
            if (d) setDateValue(d);
          }}
        />
      )}

      {Platform.OS === 'ios' && iosPickerVisible && (
        <Modal transparent animationType="slide" visible={iosPickerVisible}>
          <View style={styles.iosPickerBackdrop}>
            <View style={styles.iosPickerSheet}>
              <View style={styles.iosPickerHeader}>
                <TouchableOpacity onPress={() => setIosPickerVisible(false)}>
                  <Text style={styles.iosPickerCancel}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.iosPickerTitle}>Select date</Text>
                <TouchableOpacity
                  onPress={() => {
                    setDateValue(pickerDraft);
                    setIosPickerVisible(false);
                  }}
                >
                  <Text style={styles.iosPickerDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerDraft}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                minimumDate={new Date(1900, 0, 1)}
                onChange={(_, d) => d && setPickerDraft(d)}
                style={styles.iosPicker}
              />
            </View>
          </View>
        </Modal>
      )}
    </Card>
  );
}

// ── History Row ────────────────────────────────────────────────────────────

function HistoryRow({ event, isLast }: { event: PreventiveItemEvent; isLast: boolean }) {
  const label = EVENT_LABELS[event.event_type] ?? event.event_type;
  const fromTo =
    event.from_status && event.to_status && event.from_status !== event.to_status
      ? `${PREVENTIVE_STATUS_LABELS[event.from_status]} → ${PREVENTIVE_STATUS_LABELS[event.to_status]}`
      : null;

  return (
    <View style={[styles.historyRow, !isLast && styles.historyRowBorder]}>
      <View style={styles.historyDot} />
      <View style={styles.historyBody}>
        <Text style={styles.historyLabel}>{label}</Text>
        {fromTo && <Text style={styles.historyFromTo}>{fromTo}</Text>}
        <Text style={styles.historyTime}>
          {formatEventTime(event.created_at)} · {event.created_by}
        </Text>
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 60,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  loadingText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },

  // Header
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -4,
  },
  homeButton: {
    padding: 6,
    marginRight: -6,
  },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  headerTitleRow: {
    marginTop: 4,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  headerChildren: {
    marginTop: 10,
    flexDirection: 'row',
  },
  statusBadgeLarge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  statusBadgeLargeText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Section
  section: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Rule card
  ruleDescription: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },
  ruleMeta: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 8,
    lineHeight: 19,
  },
  ruleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  categoryChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.secondary.DEFAULT + '1A',
  },
  categoryChipText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.secondary.dark,
  },
  guidelineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  guidelineBadgeText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.primary.DEFAULT,
  },

  // Current status
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusLabelBig: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  rationaleText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  metaText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },

  // Screening method
  methodIntroText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  methodList: {
    gap: 10,
  },
  methodCard: {
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    padding: 12,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  methodCardSelected: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  methodCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  methodCardTitleRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 8,
  },
  methodCardTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  methodCardTitleSelected: {
    color: COLORS.primary.dark,
  },
  methodCardCadence: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  methodCardDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 19,
    marginTop: 6,
  },

  // Last screening
  lastDoneLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lastDoneValue: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginTop: 4,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.secondary.DEFAULT + '1A',
    marginTop: 10,
  },
  sourceBadgeText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.secondary.dark,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  linkButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.primary.DEFAULT,
  },
  lastDonePrompt: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  lastDoneHelper: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 6,
    lineHeight: 19,
  },
  lastDoneButtonsColumn: {
    marginTop: 14,
    gap: 10,
  },
  lastDonePrimaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary.DEFAULT,
    paddingVertical: 12,
    borderRadius: 10,
  },
  lastDonePrimaryText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
  lastDoneSecondaryButton: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  lastDoneSecondaryText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  lastDoneHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textAlign: 'center',
    marginTop: 2,
  },

  // Missing data
  missingCard: {
    marginBottom: 10,
  },
  missingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  missingPrompt: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  missingInputWrap: {
    marginTop: 12,
  },
  missingDateField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  missingDateText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
  },
  missingDatePlaceholder: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.tertiary,
  },
  sexOptionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  sexChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  sexChipSelected: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  sexChipText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  sexChipTextSelected: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  conditionsInput: {
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  missingSaveButton: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  missingSaveButtonDisabled: {
    backgroundColor: COLORS.primary.DEFAULT + '55',
  },
  missingSaveText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },

  // Actions
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '33',
  },
  primaryActionActive: {
    borderColor: COLORS.success.DEFAULT + '55',
    backgroundColor: COLORS.success.light,
  },
  primaryActionDisabled: {
    opacity: 0.6,
  },
  primaryActionTextWrap: {
    flex: 1,
  },
  primaryActionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  primaryActionTitleDisabled: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
  },
  primaryActionSubtitle: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  secondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT,
  },
  secondaryActionText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  tertiaryAction: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 8,
  },
  tertiaryActionText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  actionNote: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 17,
  },

  // Notes
  notesInput: {
    minHeight: 80,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    textAlignVertical: 'top',
    padding: 0,
  },

  // History
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  historyRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
  },
  historyRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  historyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary.DEFAULT,
    marginTop: 7,
  },
  historyBody: {
    flex: 1,
  },
  historyLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  historyFromTo: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  historyTime: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  emptyHistoryText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    textAlign: 'center',
    paddingVertical: 8,
  },

  // Modals
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 30,
  },
  modalTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 19,
    marginBottom: 16,
  },
  deferOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  deferOptionText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  modalCancelRow: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  modalCancelText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  declineInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    textAlignVertical: 'top',
    backgroundColor: COLORS.surface.DEFAULT,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalSecondaryButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  modalSecondaryText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  modalPrimaryButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.error.DEFAULT,
  },
  modalPrimaryText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },

  // iOS picker sheet
  iosPickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  iosPickerSheet: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 20,
  },
  iosPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  iosPickerTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  iosPickerCancel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  iosPickerDone: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  iosPicker: {
    height: 220,
  },

  // Completed banner
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: COLORS.success.light,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.success.DEFAULT + '33',
  },
  completedBannerText: {
    flex: 1,
  },
  completedBannerTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  completedBannerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  completedSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.secondary.DEFAULT + '1A',
  },
  completedSourceBadgeText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.secondary.dark,
  },
  completedNextDueText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  viewProofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  viewProofText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // Mark as Complete section
  markCompleteHelper: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  completeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  completeOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  completeOptionText: {
    flex: 1,
  },
  completeOptionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  completeOptionSubtitle: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
    lineHeight: 17,
  },
  completionBusyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  completionBusyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },

  // Review extracted date modal
  modalSubtitleEmphasis: {
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  lowConfidenceHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.warning.light,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  lowConfidenceText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.warning.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  modalPrimaryButtonWide: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT,
    marginBottom: 8,
  },
  modalSecondaryButtonWide: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    marginBottom: 4,
  },
});
