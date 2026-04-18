import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { useQueryClient } from '@tanstack/react-query';
import {
  useResult,
  useResultDocuments,
  useUpdateResult,
  useDeleteResult,
  useDeleteResultDocument,
  useExtractJobs,
  useLabObservations,
  useTriggerExtraction,
} from '@/hooks/useResults';
import { useProfileDetail } from '@/hooks/useProfileDetail';
import { getEffectiveData } from '@/services/results';
import {
  generateResultSummary,
  generateAndShareSummary,
} from '@/services/resultExport';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  ResultDocument,
  ResultItem,
  ResultType,
  ResultStatus,
  ResultSourceMethod,
  ResultLabObservation,
  LabFlag,
} from '@/lib/types/results';
import {
  RESULT_TYPE_LABELS,
  RESULT_STATUS_LABELS,
  RESULT_SOURCE_METHOD_LABELS,
} from '@/lib/types/results';

const TYPE_COLORS: Record<ResultType, string> = {
  lab: '#2563EB',
  imaging: '#7C3AED',
  other: '#0D9488',
};

const STATUS_COLORS: Record<ResultStatus, string> = {
  draft: COLORS.text.tertiary,
  processing: COLORS.primary.DEFAULT,
  needs_review: COLORS.accent.dark,
  ready: COLORS.success.DEFAULT,
  archived: COLORS.text.tertiary,
};

const TYPES: ResultType[] = ['lab', 'imaging', 'other'];

const COLLAPSED_LINE_COUNT = 5;

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ResultDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const resultId = id ?? null;
  const queryClient = useQueryClient();
  const { data: result, isLoading, error } = useResult(resultId);
  const { data: documents } = useResultDocuments(resultId);
  const { data: extractJobs } = useExtractJobs(resultId);
  const { data: labObservations } = useLabObservations(resultId);
  const { data: profileDetail } = useProfileDetail(result?.profile_id ?? null);
  const updateResult = useUpdateResult();
  const deleteResult = useDeleteResult();
  const deleteDoc = useDeleteResultDocument();
  const triggerExtraction = useTriggerExtraction();

  const isExtracting = extractJobs?.some((j) => j.status === 'processing') ?? false;
  const lastJob = extractJobs?.[0] ?? null;
  const lastJobFailed = lastJob?.status === 'failed' && !isExtracting;

  const prevIsExtracting = useRef(false);
  useEffect(() => {
    if (prevIsExtracting.current && !isExtracting && resultId) {
      queryClient.invalidateQueries({ queryKey: ['results', 'detail', resultId] });
      queryClient.invalidateQueries({
        queryKey: ['results', 'labObservations', resultId],
      });
    }
    prevIsExtracting.current = isExtracting;
  }, [isExtracting, resultId, queryClient]);

  // Inline title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  // Notes edit
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  // Report text collapse
  const [reportExpanded, setReportExpanded] = useState(false);

  // Edit details modal
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editType, setEditType] = useState<ResultType>('lab');
  const [editPerformed, setEditPerformed] = useState<Date | null>(null);
  const [editReported, setEditReported] = useState<Date | null>(null);
  const [editFacility, setEditFacility] = useState('');
  const [editClinician, setEditClinician] = useState('');

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !result) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Could not load this result.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.errorBack}>
            <Text style={styles.backText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const typeColor = TYPE_COLORS[result.result_type];
  const statusColor = STATUS_COLORS[result.status];

  const hasExtractedContent =
    !!result.structured_data ||
    (labObservations && labObservations.length > 0);

  const canShare =
    !!result.structured_data ||
    !!(result.raw_text && result.raw_text.trim());

  function goToReview() {
    if (!result) return;
    router.push(`/(main)/results/${result.id}/review`);
  }

  function startEditTitle() {
    if (!result) return;
    setTitleDraft(result.test_name);
    setEditingTitle(true);
  }

  function saveTitle() {
    if (!result) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === result.test_name) {
      setEditingTitle(false);
      return;
    }
    updateResult.mutate(
      { resultId: result.id, updates: { test_name: trimmed } },
      { onSettled: () => setEditingTitle(false) },
    );
  }

  function togglePin() {
    if (!result) return;
    updateResult.mutate({
      resultId: result.id,
      updates: { is_pinned: !result.is_pinned },
    });
  }

  function openEditModal() {
    if (!result) return;
    setEditType(result.result_type);
    setEditPerformed(
      result.performed_at ? new Date(result.performed_at + 'T00:00:00') : null,
    );
    setEditReported(
      result.reported_at ? new Date(result.reported_at + 'T00:00:00') : null,
    );
    setEditFacility(result.facility ?? '');
    setEditClinician(result.ordering_clinician ?? '');
    setEditModalVisible(true);
  }

  function saveEditModal() {
    if (!result) return;
    updateResult.mutate(
      {
        resultId: result.id,
        updates: {
          result_type: editType,
          performed_at: editPerformed ? toDateString(editPerformed) : null,
          reported_at: editReported ? toDateString(editReported) : null,
          facility: editFacility.trim() || null,
          ordering_clinician: editClinician.trim() || null,
        },
      },
      { onSuccess: () => setEditModalVisible(false) },
    );
  }

  function handleNotesBlur() {
    if (!result || notesDraft === null) return;
    const trimmed = notesDraft.trim();
    const current = result.notes ?? '';
    if (trimmed === current) {
      setNotesDraft(null);
      return;
    }
    updateResult.mutate(
      {
        resultId: result.id,
        updates: { notes: trimmed || null },
      },
      { onSettled: () => setNotesDraft(null) },
    );
  }

  function setStatus(status: ResultStatus) {
    if (!result) return;
    updateResult.mutate({ resultId: result.id, updates: { status } });
  }

  function handleDeleteDocument(doc: ResultDocument) {
    Alert.alert(
      'Delete Document',
      `Remove "${doc.file_name ?? 'this document'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteDoc.mutate(doc.id),
        },
      ],
    );
  }

  function handleShare() {
    if (!result) return;
    const profileName = profileDetail?.display_name ?? 'Patient';
    Alert.alert('Share Result Summary', undefined, [
      {
        text: 'Share Summary',
        onPress: async () => {
          await generateAndShareSummary({
            result,
            labObservations: labObservations ?? [],
            profileName,
          });
        },
      },
      {
        text: 'Copy to Clipboard',
        onPress: async () => {
          const summary = generateResultSummary({
            result,
            labObservations: labObservations ?? [],
            profileName,
          });
          try {
            await Clipboard.setStringAsync(summary.text);
            Alert.alert('Copied!', 'Result summary copied to clipboard.');
          } catch {
            Alert.alert('Copy failed', 'Could not copy to clipboard.');
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function handleDeleteResult() {
    if (!result) return;
    Alert.alert(
      'Delete Result',
      'This will remove the result and all attached documents. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteResult.mutate(result.id, {
              onSuccess: () => router.back(),
              onError: (err) => Alert.alert('Error', err.message),
            });
          },
        },
      ],
    );
  }

  const reportLines = (result.raw_text ?? '').split('\n');
  const reportIsLong = reportLines.length > COLLAPSED_LINE_COUNT;
  const reportPreview = reportLines.slice(0, COLLAPSED_LINE_COUNT).join('\n');

  const performedStr = formatDate(result.performed_at);
  const reportedStr = formatDate(result.reported_at);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={22} color={COLORS.primary.DEFAULT} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.titleRow}>
            {editingTitle ? (
              <TextInput
                style={styles.titleInput}
                value={titleDraft}
                onChangeText={setTitleDraft}
                onBlur={saveTitle}
                onSubmitEditing={saveTitle}
                autoFocus
                returnKeyType="done"
              />
            ) : (
              <TouchableOpacity
                onPress={startEditTitle}
                style={styles.titleTouchable}
                activeOpacity={0.6}
              >
                <Text style={styles.title} numberOfLines={3}>
                  {result.test_name}
                </Text>
                <Ionicons
                  name="pencil-outline"
                  size={16}
                  color={COLORS.text.tertiary}
                  style={styles.titleEditIcon}
                />
              </TouchableOpacity>
            )}
            {hasExtractedContent && (
              <TouchableOpacity
                onPress={goToReview}
                style={styles.headerIconButton}
                activeOpacity={0.7}
                accessibilityLabel="Review extracted data"
              >
                <Ionicons
                  name="create-outline"
                  size={20}
                  color={COLORS.primary.DEFAULT}
                />
              </TouchableOpacity>
            )}
            {canShare && (
              <TouchableOpacity
                onPress={handleShare}
                style={styles.headerIconButton}
                activeOpacity={0.7}
                accessibilityLabel="Share result summary"
              >
                <Ionicons
                  name="share-outline"
                  size={20}
                  color={COLORS.primary.DEFAULT}
                />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={togglePin}
              style={styles.headerIconButton}
              activeOpacity={0.7}
            >
              <Ionicons
                name={result.is_pinned ? 'pin' : 'pin-outline'}
                size={20}
                color={result.is_pinned ? COLORS.accent.dark : COLORS.text.tertiary}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.headerBadges}>
            <View style={[styles.typeBadge, { backgroundColor: typeColor + '1A' }]}>
              <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                {RESULT_TYPE_LABELS[result.result_type]}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '1A' }]}>
              <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                {RESULT_STATUS_LABELS[result.status]}
              </Text>
            </View>
          </View>
        </View>

        {/* Needs Review banner */}
        {result.status === 'needs_review' && (
          <View style={styles.sectionPadded}>
            <Card style={styles.needsReviewCard}>
              <View style={styles.needsReviewHeader}>
                <Ionicons
                  name="alert-circle"
                  size={20}
                  color={COLORS.accent.dark}
                />
                <Text style={styles.needsReviewTitle}>This result needs your review</Text>
              </View>
              <Text style={styles.needsReviewBody}>
                Some extracted values may be inaccurate. Review and confirm to finalize.
              </Text>
              <TouchableOpacity
                onPress={goToReview}
                style={styles.needsReviewButton}
                activeOpacity={0.8}
              >
                <Text style={styles.needsReviewButtonText}>Review & Confirm</Text>
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={COLORS.text.inverse}
                />
              </TouchableOpacity>
            </Card>
          </View>
        )}

        {/* Summary section */}
        <View style={styles.sectionPadded}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>SUMMARY</Text>
            <TouchableOpacity onPress={openEditModal} activeOpacity={0.7}>
              <View style={styles.editButton}>
                <Ionicons name="pencil-outline" size={14} color={COLORS.primary.DEFAULT} />
                <Text style={styles.editButtonText}>Edit</Text>
              </View>
            </TouchableOpacity>
          </View>
          <Card>
            {performedStr && <DetailRow label="Performed" value={performedStr} />}
            {reportedStr && <DetailRow label="Reported" value={reportedStr} />}
            {result.facility && <DetailRow label="Facility" value={result.facility} />}
            {result.ordering_clinician && (
              <DetailRow label="Clinician" value={result.ordering_clinician} />
            )}
            <DetailRow
              label="Source"
              value={
                RESULT_SOURCE_METHOD_LABELS[
                  result.source_method as ResultSourceMethod
                ] ?? result.source_method
              }
            />
            {!performedStr &&
              !reportedStr &&
              !result.facility &&
              !result.ordering_clinician && (
                <TouchableOpacity onPress={openEditModal} activeOpacity={0.7}>
                  <Text style={styles.noDetailsText}>No details yet — tap to add</Text>
                </TouchableOpacity>
              )}
          </Card>
        </View>

        {/* Report Text */}
        {result.raw_text && (
          <View style={styles.sectionPadded}>
            <Text style={styles.sectionLabel}>REPORT TEXT</Text>
            <Card>
              <Text style={styles.reportText}>
                {reportExpanded || !reportIsLong ? result.raw_text : reportPreview}
              </Text>
              {reportIsLong && (
                <TouchableOpacity
                  onPress={() => setReportExpanded(!reportExpanded)}
                  activeOpacity={0.7}
                  style={styles.expandToggle}
                >
                  <Text style={styles.expandToggleText}>
                    {reportExpanded ? 'Show less' : 'Show more'}
                  </Text>
                  <Ionicons
                    name={reportExpanded ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={COLORS.primary.DEFAULT}
                  />
                </TouchableOpacity>
              )}
            </Card>
          </View>
        )}

        {/* Extraction Status */}
        {isExtracting && (
          <View style={styles.sectionPadded}>
            <Card style={styles.extractionStatusCard}>
              <View style={styles.extractionStatusRow}>
                <ActivityIndicator size="small" color={COLORS.primary.DEFAULT} />
                <Text style={styles.extractionStatusText}>
                  Extracting result details...
                </Text>
              </View>
            </Card>
          </View>
        )}
        {lastJobFailed && (
          <View style={styles.sectionPadded}>
            <Card style={styles.extractionWarningCard}>
              <View style={styles.extractionStatusRow}>
                <Ionicons
                  name="warning-outline"
                  size={18}
                  color={COLORS.warning.DEFAULT}
                />
                <Text style={styles.extractionWarningText}>
                  Extraction encountered an issue. You can add details manually.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.retryButton}
                activeOpacity={0.7}
                onPress={() => {
                  if (!result) return;
                  const latestDoc = (documents ?? [])[0];
                  triggerExtraction.mutate({
                    resultId: result.id,
                    profileId: result.profile_id,
                    householdId: result.household_id,
                    resultType: result.result_type,
                    rawText: result.raw_text,
                    documentId: latestDoc?.id ?? null,
                  });
                }}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </Card>
          </View>
        )}

        {/* Structured data */}
        <StructuredSection
          result={result}
          labObservations={labObservations ?? []}
          documents={documents ?? []}
          isExtracting={isExtracting}
          onRunExtraction={() => {
            if (!result) return;
            const latestDoc = (documents ?? [])[0];
            triggerExtraction.mutate({
              resultId: result.id,
              profileId: result.profile_id,
              householdId: result.household_id,
              resultType: result.result_type,
              rawText: result.raw_text,
              documentId: latestDoc?.id ?? null,
            });
          }}
          extractionPending={triggerExtraction.isPending}
        />

        {/* Documents */}
        <View style={styles.sectionPadded}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>DOCUMENTS</Text>
            <TouchableOpacity
              onPress={() =>
                Alert.alert(
                  'Add Document',
                  'Document upload from the detail screen is coming soon. For now, create a new result via Upload Report.',
                )
              }
              activeOpacity={0.7}
            >
              <View style={styles.editButton}>
                <Ionicons name="add" size={14} color={COLORS.primary.DEFAULT} />
                <Text style={styles.editButtonText}>Add</Text>
              </View>
            </TouchableOpacity>
          </View>
          {(documents ?? []).length === 0 ? (
            <Card>
              <Text style={styles.noDetailsText}>No documents attached</Text>
            </Card>
          ) : (
            (documents ?? []).map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                onDelete={() => handleDeleteDocument(doc)}
              />
            ))
          )}
        </View>

        {/* Notes */}
        <View style={styles.sectionPadded}>
          <Text style={styles.sectionLabel}>YOUR NOTES</Text>
          <Card>
            <TextInput
              style={styles.notesInput}
              placeholder="Add notes about this result..."
              placeholderTextColor={COLORS.text.tertiary}
              value={notesDraft !== null ? notesDraft : (result.notes ?? '')}
              onChangeText={(t) => setNotesDraft(t)}
              onBlur={handleNotesBlur}
              multiline
              textAlignVertical="top"
            />
          </Card>
        </View>

        {/* Status actions */}
        <View style={styles.sectionPadded}>
          <Text style={styles.sectionLabel}>STATUS</Text>
          <Card>
            <Text style={styles.statusDescription}>
              Current status:{' '}
              <Text style={{ fontWeight: FONT_WEIGHTS.semibold, color: statusColor }}>
                {RESULT_STATUS_LABELS[result.status]}
              </Text>
            </Text>
            <View style={styles.statusButtonRow}>
              {result.status !== 'ready' && (
                <TouchableOpacity
                  style={[styles.statusButton, styles.statusButtonPrimary]}
                  onPress={() => setStatus('ready')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.text.inverse} />
                  <Text style={styles.statusButtonPrimaryText}>Mark Ready</Text>
                </TouchableOpacity>
              )}
              {result.status !== 'archived' && (
                <TouchableOpacity
                  style={[styles.statusButton, styles.statusButtonOutline]}
                  onPress={() => setStatus('archived')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="archive-outline" size={16} color={COLORS.text.secondary} />
                  <Text style={styles.statusButtonOutlineText}>Archive</Text>
                </TouchableOpacity>
              )}
            </View>
          </Card>
        </View>

        {/* Delete */}
        <View style={styles.sectionPadded}>
          <TouchableOpacity
            onPress={handleDeleteResult}
            style={styles.deleteResultButton}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={16} color={COLORS.error.DEFAULT} />
            <Text style={styles.deleteResultText}>Delete Result</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Edit Details Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.flex}
          >
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <Text style={styles.backText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Edit Details</Text>
              <TouchableOpacity onPress={saveEditModal}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.modalContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.fieldLabel}>Result Type</Text>
              <View style={styles.chipRow}>
                {TYPES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, editType === t && styles.chipSelected]}
                    onPress={() => setEditType(t)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[styles.chipText, editType === t && styles.chipTextSelected]}
                    >
                      {RESULT_TYPE_LABELS[t]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ height: 16 }} />
              <DatePicker
                label="Date Performed"
                mode="date"
                value={editPerformed}
                onChange={setEditPerformed}
                placeholder="Optional"
                maximumDate={new Date()}
              />
              <DatePicker
                label="Date Reported"
                mode="date"
                value={editReported}
                onChange={setEditReported}
                placeholder="Optional"
                maximumDate={new Date()}
              />
              <Input
                label="Facility"
                placeholder="Optional"
                value={editFacility}
                onChangeText={setEditFacility}
              />
              <Input
                label="Ordering Clinician"
                placeholder="Optional"
                value={editClinician}
                onChangeText={setEditClinician}
              />
              <View style={{ height: 16 }} />
              <Button
                title="Save Changes"
                onPress={saveEditModal}
                loading={updateResult.isPending}
                size="lg"
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

// ── Structured Data Section ─────────────────────────────────────────────────

const FLAG_COLORS: Record<LabFlag, string> = {
  normal: COLORS.success.DEFAULT,
  high: '#F59E0B',
  low: '#2563EB',
  abnormal: COLORS.warning.DEFAULT,
  critical: COLORS.error.DEFAULT,
};

const FLAG_ICONS: Record<LabFlag, keyof typeof Ionicons.glyphMap> = {
  normal: 'checkmark-circle',
  high: 'arrow-up',
  low: 'arrow-down',
  abnormal: 'warning',
  critical: 'alert-circle',
};

const FLAG_LABELS: Record<LabFlag, string> = {
  normal: 'Normal',
  high: 'High',
  low: 'Low',
  abnormal: 'Abnormal',
  critical: 'Critical',
};

function ConfidenceIcon({ confidence }: { confidence: number }) {
  if (confidence >= 0.8) {
    return (
      <Ionicons
        name="checkmark-circle"
        size={12}
        color={COLORS.success.DEFAULT}
      />
    );
  }
  if (confidence >= 0.5) {
    return <Ionicons name="warning" size={12} color={COLORS.warning.DEFAULT} />;
  }
  return <Ionicons name="alert-circle" size={12} color={COLORS.error.DEFAULT} />;
}

function EditedBadge({ label }: { label: string }) {
  return (
    <View style={styles.editedBadge}>
      <Ionicons
        name="pencil"
        size={9}
        color={COLORS.secondary.dark}
      />
      <Text style={styles.editedBadgeText}>{label}</Text>
    </View>
  );
}

interface StructuredSectionProps {
  result: ResultItem;
  labObservations: ResultLabObservation[];
  documents: ResultDocument[];
  isExtracting: boolean;
  onRunExtraction: () => void;
  extractionPending: boolean;
}

function StructuredSection({
  result,
  labObservations,
  documents,
  isExtracting,
  onRunExtraction,
  extractionPending,
}: StructuredSectionProps) {
  const label =
    result.result_type === 'lab'
      ? 'LAB VALUES'
      : result.result_type === 'imaging'
        ? 'FINDINGS & IMPRESSION'
        : 'DETAILS';

  if (isExtracting) {
    return (
      <View style={styles.sectionPadded}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <Card>
          <View style={styles.structuredPending}>
            <ActivityIndicator size="small" color={COLORS.text.tertiary} />
            <Text style={styles.pendingText}>
              {result.result_type === 'lab'
                ? 'Extracting lab values...'
                : result.result_type === 'imaging'
                  ? 'Extracting findings and impression...'
                  : 'Extracting details...'}
            </Text>
          </View>
        </Card>
      </View>
    );
  }

  if (result.result_type === 'lab') {
    if (labObservations.length > 0) {
      return (
        <View style={styles.sectionPadded}>
          <Text style={styles.sectionLabel}>{label}</Text>
          <Card>
            {labObservations.map((obs, i) => (
              <LabObservationRow
                key={obs.id}
                obs={obs}
                isLast={i === labObservations.length - 1}
              />
            ))}
          </Card>
        </View>
      );
    }
    return (
      <ExtractionCTA
        label={label}
        description="Extract lab values and reference ranges from this report"
        canExtract={canExtract(result, documents)}
        onRunExtraction={onRunExtraction}
        extractionPending={extractionPending}
      />
    );
  }

  if (result.result_type === 'imaging') {
    const effective = getEffectiveData(result);
    const imaging =
      effective && 'findings' in effective
        ? effective
        : null;
    const hasImaging =
      imaging &&
      (imaging.findings ||
        imaging.impression ||
        imaging.modality ||
        imaging.radiologist);

    if (hasImaging && imaging) {
      const isEdited = (key: string) => imaging.edited_fields.has(key as never);
      return (
        <View style={styles.sectionPadded}>
          <Text style={styles.sectionLabel}>{label}</Text>
          {(imaging.modality || imaging.body_part) && (
            <View style={styles.imagingBadgeRow}>
              {imaging.modality && (
                <View style={styles.modalityBadge}>
                  <Text style={styles.modalityBadgeText}>{imaging.modality}</Text>
                </View>
              )}
              {imaging.body_part && (
                <View style={styles.modalityBadge}>
                  <Text style={styles.modalityBadgeText}>{imaging.body_part}</Text>
                </View>
              )}
            </View>
          )}
          {imaging.radiologist && (
            <Card style={styles.radiologistCard}>
              <View style={styles.subsectionLabelRow}>
                <Text style={styles.radiologistLabel}>Radiologist</Text>
                {isEdited('radiologist') && <EditedBadge label="edited" />}
              </View>
              <Text style={styles.radiologistValue}>{imaging.radiologist}</Text>
            </Card>
          )}
          {imaging.impression && (
            <Card style={styles.impressionCard}>
              <View style={styles.subsectionLabelRow}>
                <Text style={styles.subsectionLabel}>Impression</Text>
                {isEdited('impression') && <EditedBadge label="edited" />}
              </View>
              <Text style={styles.impressionText}>{imaging.impression}</Text>
            </Card>
          )}
          {imaging.findings && (
            <Card style={styles.findingsCard}>
              <View style={styles.subsectionLabelRow}>
                <Text style={styles.subsectionLabel}>Findings</Text>
                {isEdited('findings') && <EditedBadge label="edited" />}
              </View>
              <Text style={styles.findingsText}>{imaging.findings}</Text>
            </Card>
          )}
          {imaging.technique && (
            <Card style={styles.findingsCard}>
              <Text style={styles.subsectionLabel}>Technique</Text>
              <Text style={styles.findingsText}>{imaging.technique}</Text>
            </Card>
          )}
          {imaging.comparison && (
            <Card style={styles.findingsCard}>
              <View style={styles.subsectionLabelRow}>
                <Text style={styles.subsectionLabel}>Comparison</Text>
                {isEdited('comparison') && <EditedBadge label="edited" />}
              </View>
              <Text style={styles.findingsText}>{imaging.comparison}</Text>
            </Card>
          )}
        </View>
      );
    }
    return (
      <ExtractionCTA
        label={label}
        description="Extract findings and impression from this imaging report"
        canExtract={canExtract(result, documents)}
        onRunExtraction={onRunExtraction}
        extractionPending={extractionPending}
      />
    );
  }

  // OTHER
  const effective = getEffectiveData(result);
  const other =
    effective && 'key_findings' in effective
      ? effective
      : null;
  const hasOther =
    other &&
    (other.summary ||
      (other.key_findings && other.key_findings.length > 0) ||
      other.test_category);

  if (hasOther && other) {
    const isEdited = (key: string) => other.edited_fields.has(key);
    return (
      <View style={styles.sectionPadded}>
        <Text style={styles.sectionLabel}>{label}</Text>
        {other.test_category && (
          <View style={styles.imagingBadgeRow}>
            <View style={styles.modalityBadge}>
              <Text style={styles.modalityBadgeText}>{other.test_category}</Text>
            </View>
          </View>
        )}
        {other.summary && (
          <Card style={styles.impressionCard}>
            <View style={styles.subsectionLabelRow}>
              <Text style={styles.subsectionLabel}>Summary</Text>
              {isEdited('summary') && <EditedBadge label="edited" />}
            </View>
            <Text style={styles.impressionText}>{other.summary}</Text>
          </Card>
        )}
        {other.key_findings && other.key_findings.length > 0 && (
          <View>
            <View style={styles.subsectionLabelRow}>
              <Text style={styles.keyFindingsHeader}>Key Findings</Text>
              {isEdited('key_findings') && <EditedBadge label="edited" />}
            </View>
            {other.key_findings.map((f, i) => (
              <Card key={`${f.label ?? 'finding'}-${i}`} style={styles.findingCard}>
                <View style={styles.findingLabelRow}>
                  <Text style={styles.findingLabel}>{f.label ?? 'Finding'}</Text>
                  {typeof f.confidence === 'number' && (
                    <ConfidenceIcon confidence={f.confidence} />
                  )}
                </View>
                <Text style={styles.findingValue}>{f.value ?? '—'}</Text>
              </Card>
            ))}
          </View>
        )}
      </View>
    );
  }
  return (
    <ExtractionCTA
      label={label}
      description="Extract structured details from this report"
      canExtract={canExtract(result, documents)}
      onRunExtraction={onRunExtraction}
      extractionPending={extractionPending}
    />
  );
}

function canExtract(
  result: { raw_text: string | null },
  documents: ResultDocument[],
): boolean {
  return !!(result.raw_text && result.raw_text.trim()) || documents.length > 0;
}

function ExtractionCTA({
  label,
  description,
  canExtract: can,
  onRunExtraction,
  extractionPending,
}: {
  label: string;
  description: string;
  canExtract: boolean;
  onRunExtraction: () => void;
  extractionPending: boolean;
}) {
  return (
    <View style={styles.sectionPadded}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Card>
        <View style={styles.structuredPlaceholder}>
          <Ionicons
            name="sparkles-outline"
            size={22}
            color={COLORS.text.tertiary}
            style={{ marginBottom: 8 }}
          />
          <Text style={styles.structuredPlaceholderText}>
            {can
              ? description
              : 'Add report text or a document to enable extraction'}
          </Text>
          <TouchableOpacity
            style={[
              styles.extractButton,
              (!can || extractionPending) && styles.extractButtonDisabled,
            ]}
            disabled={!can || extractionPending}
            onPress={onRunExtraction}
            activeOpacity={0.7}
          >
            {extractionPending ? (
              <ActivityIndicator size="small" color={COLORS.text.inverse} />
            ) : (
              <Text style={styles.extractButtonText}>Run Extraction</Text>
            )}
          </TouchableOpacity>
        </View>
      </Card>
    </View>
  );
}

function LabObservationRow({
  obs,
  isLast,
}: {
  obs: ResultLabObservation;
  isLast: boolean;
}) {
  const flag = obs.flag as LabFlag | null;
  const flagColor = flag ? FLAG_COLORS[flag] : null;
  const flagIcon = flag ? FLAG_ICONS[flag] : null;
  const flagLabel = flag ? FLAG_LABELS[flag] : null;

  const rangeText =
    obs.ref_range_text ??
    (obs.ref_range_low != null && obs.ref_range_high != null
      ? `${obs.ref_range_low}–${obs.ref_range_high}`
      : null);

  const valueDisplay = obs.value_text ?? String(obs.numeric_value ?? '');
  const editedLabel =
    obs.source === 'user_confirmed'
      ? 'edited'
      : obs.source === 'user_entered'
        ? 'added'
        : null;

  return (
    <View style={[styles.labRow, !isLast && styles.labRowBorder]}>
      <View style={styles.labRowLeft}>
        <View style={styles.labNameRow}>
          <Text style={styles.labName}>{obs.analyte_name}</Text>
          {typeof obs.confidence === 'number' && (
            <ConfidenceIcon confidence={obs.confidence} />
          )}
          {editedLabel && <EditedBadge label={editedLabel} />}
        </View>
        {rangeText && <Text style={styles.labRange}>Ref: {rangeText}</Text>}
      </View>
      <View style={styles.labRowRight}>
        <Text style={styles.labValue}>
          {valueDisplay}
          {obs.unit ? ` ${obs.unit}` : ''}
        </Text>
        {flag && flagColor && flagIcon && flagLabel && (
          <View
            style={[styles.flagBadge, { backgroundColor: flagColor + '1A' }]}
          >
            <Ionicons name={flagIcon} size={11} color={flagColor} />
            <Text style={[styles.flagBadgeText, { color: flagColor }]}>
              {flagLabel}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function DocumentRow({
  doc,
  onDelete,
}: {
  doc: ResultDocument;
  onDelete: () => void;
}) {
  const isImage = doc.mime_type?.startsWith('image/') ?? false;
  return (
    <Card style={styles.docCard}>
      <View style={styles.docRow}>
        <View style={styles.docIconWrap}>
          <Ionicons
            name={isImage ? 'image-outline' : 'document-outline'}
            size={22}
            color={COLORS.primary.DEFAULT}
          />
        </View>
        <View style={styles.docInfo}>
          <Text style={styles.docName} numberOfLines={1}>
            {doc.file_name ?? 'Untitled document'}
          </Text>
          <Text style={styles.docDate}>
            {new Date(doc.created_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
        </View>
        <TouchableOpacity onPress={onDelete} style={styles.docDeleteButton}>
          <Ionicons name="trash-outline" size={18} color={COLORS.error.DEFAULT} />
        </TouchableOpacity>
      </View>
    </Card>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 60 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },
  errorBack: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 12,
  },
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  titleTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  title: {
    flex: 1,
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    lineHeight: 30,
  },
  titleEditIcon: {
    marginTop: 6,
    marginLeft: 8,
  },
  titleInput: {
    flex: 1,
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.primary.DEFAULT,
    paddingVertical: 4,
  },
  headerIconButton: {
    padding: 6,
    marginLeft: 4,
    marginTop: 2,
  },
  headerBadges: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  typeBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Needs Review banner
  needsReviewCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.accent.dark,
    backgroundColor: COLORS.accent.DEFAULT + '14',
  },
  needsReviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  needsReviewTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  needsReviewBody: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  needsReviewButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  needsReviewButtonText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Section
  sectionPadded: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  editButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  detailRow: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  detailLabel: {
    width: 96,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  detailValue: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  noDetailsText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
  },

  // Report Text
  reportText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },
  expandToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  expandToggleText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Structured placeholder
  structuredPlaceholder: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  structuredPlaceholderText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  extractButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  extractButtonDisabled: {
    opacity: 0.4,
  },
  extractButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  structuredPlaceholderHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 8,
  },

  // Extraction status
  extractionStatusCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary.DEFAULT,
  },
  extractionStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  extractionStatusText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    flex: 1,
  },
  extractionWarningCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warning.DEFAULT,
  },
  extractionWarningText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    flex: 1,
  },
  retryButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  retryButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Structured data — shared
  structuredPending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  pendingText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
  },

  // Lab rows
  labRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    gap: 12,
  },
  labRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  labRowLeft: {
    flex: 1,
  },
  labNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  labName: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  labRange: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  labRowRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  labValue: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  flagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  flagBadgeText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Edited indicator badge
  editedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: COLORS.secondary.DEFAULT + '1A',
  },
  editedBadgeText: {
    fontSize: 10,
    color: COLORS.secondary.dark,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'lowercase',
  },

  // Imaging
  imagingBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  modalityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#7C3AED' + '1A',
  },
  modalityBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: '#7C3AED',
  },
  radiologistCard: {
    marginBottom: 10,
  },
  radiologistLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginBottom: 2,
  },
  radiologistValue: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  impressionCard: {
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary.DEFAULT,
  },
  findingsCard: {
    marginBottom: 10,
  },
  subsectionLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  subsectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  impressionText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
    fontWeight: FONT_WEIGHTS.medium,
  },
  findingsText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },

  // Other — key findings
  keyFindingsHeader: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 6,
    marginBottom: 8,
  },
  findingCard: {
    marginBottom: 8,
  },
  findingLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  findingLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  findingValue: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },

  // Document
  docCard: {
    marginBottom: 8,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  docIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  docInfo: { flex: 1 },
  docName: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  docDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  docDeleteButton: {
    padding: 8,
  },

  // Notes
  notesInput: {
    minHeight: 80,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
    padding: 0,
  },

  // Status
  statusDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 12,
  },
  statusButtonRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  statusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  statusButtonPrimary: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  statusButtonPrimaryText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  statusButtonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  statusButtonOutlineText: {
    color: COLORS.text.secondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // Delete
  deleteResultButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 8,
  },
  deleteResultText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Modal
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  modalTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  modalSaveText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  modalContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
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
  chipTextSelected: {
    color: COLORS.text.inverse,
  },
});
