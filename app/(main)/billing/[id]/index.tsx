import { useState, useEffect, useRef } from 'react';
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
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import {
  useBillingCase,
  useBillingDocuments,
  useUpdateBillingCase,
  useDeleteBillingDocument,
  useExtractionJobs,
  useLedgerLines,
  useTriggerDocumentExtraction,
} from '@/hooks/useBilling';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { BillingDocument, BillingLedgerLine, BillingCaseStatus, BillingCaseWithDocCount } from '@/lib/types/billing';
import { BILLING_STATUS_LABELS, BILLING_DOC_TYPE_LABELS } from '@/lib/types/billing';

const STATUS_COLORS: Record<BillingCaseStatus, string> = {
  open: COLORS.accent.dark,
  in_review: COLORS.primary.DEFAULT,
  action_plan: COLORS.tertiary.DEFAULT,
  in_progress: COLORS.secondary.DEFAULT,
  resolved: COLORS.success.DEFAULT,
  closed: COLORS.text.tertiary,
};

const DOC_TYPE_COLORS: Record<string, string> = {
  bill: COLORS.tertiary.DEFAULT,
  eob: COLORS.primary.DEFAULT,
  itemized_bill: COLORS.secondary.DEFAULT,
  denial: COLORS.error.DEFAULT,
  other: COLORS.text.tertiary,
};

export default function BillingCaseDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: billingCase, isLoading, error } = useBillingCase(id ?? null);
  const { data: documents } = useBillingDocuments(id ?? null);
  const { data: extractionJobs } = useExtractionJobs(id ?? null);
  const { data: ledgerLines } = useLedgerLines(id ?? null);
  const updateCase = useUpdateBillingCase();
  const deleteDocument = useDeleteBillingDocument();
  const retryExtraction = useTriggerDocumentExtraction();

  // Extraction state
  const isExtracting = extractionJobs?.some((j) => j.status === 'processing') ?? false;
  const lastJob = extractionJobs?.[0] ?? null;
  const lastJobFailed = lastJob?.status === 'failed' && !isExtracting;

  // When extraction finishes, refresh case and ledger data
  const prevIsExtracting = useRef(false);
  useEffect(() => {
    if (prevIsExtracting.current && !isExtracting && id) {
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'ledgerLines', id] });
    }
    prevIsExtracting.current = isExtracting;
  }, [isExtracting, id, queryClient]);

  // Inline title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  // Freeform add details input
  const [addDetailsText, setAddDetailsText] = useState('');
  const [detailsSaved, setDetailsSaved] = useState(false);

  // Your Notes collapse
  const [notesExpanded, setNotesExpanded] = useState(false);

  // Edit details modal
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editProvider, setEditProvider] = useState('');
  const [editPayer, setEditPayer] = useState('');
  const [editDateStart, setEditDateStart] = useState<Date | null>(null);
  const [editDateEnd, setEditDateEnd] = useState<Date | null>(null);
  const [editNotes, setEditNotes] = useState('');

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !billingCase) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Could not load this case.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.errorBack}>
            <Text style={styles.backText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const statusColor = STATUS_COLORS[billingCase.status];
  const hasTotals = billingCase.total_billed != null || billingCase.total_patient_responsibility != null;
  const docCount = documents?.length ?? billingCase.document_count ?? 0;

  // ── Title editing ──
  function startEditTitle() {
    setTitleDraft(billingCase!.title);
    setEditingTitle(true);
  }

  function saveTitle() {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === billingCase!.title) {
      setEditingTitle(false);
      return;
    }
    updateCase.mutate(
      { caseId: billingCase!.id, updates: { title: trimmed } },
      { onSettled: () => setEditingTitle(false) },
    );
  }

  // ── Add details (append freeform) ──
  function handleSaveDetails() {
    if (!addDetailsText.trim()) return;
    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    const separator = billingCase!.freeform_input ? `\n\n--- ${timestamp} ---\n` : '';
    const newValue = (billingCase!.freeform_input ?? '') + separator + addDetailsText.trim();

    updateCase.mutate(
      { caseId: billingCase!.id, updates: { freeform_input: newValue } },
      {
        onSuccess: () => {
          setAddDetailsText('');
          setDetailsSaved(true);
          setTimeout(() => setDetailsSaved(false), 2000);
        },
      },
    );
  }

  // ── Edit details modal ──
  function openEditModal() {
    setEditProvider(billingCase!.provider_name ?? '');
    setEditPayer(billingCase!.payer_name ?? '');
    setEditDateStart(billingCase!.service_date_start ? new Date(billingCase!.service_date_start + 'T00:00:00') : null);
    setEditDateEnd(billingCase!.service_date_end ? new Date(billingCase!.service_date_end + 'T00:00:00') : null);
    setEditNotes(billingCase!.notes ?? '');
    setEditModalVisible(true);
  }

  function handleSaveEditModal() {
    updateCase.mutate(
      {
        caseId: billingCase!.id,
        updates: {
          provider_name: editProvider.trim() || null,
          payer_name: editPayer.trim() || null,
          service_date_start: editDateStart ? editDateStart.toISOString().split('T')[0] : null,
          service_date_end: editDateEnd ? editDateEnd.toISOString().split('T')[0] : null,
          notes: editNotes.trim() || null,
        },
      },
      { onSuccess: () => setEditModalVisible(false) },
    );
  }

  // ── Delete document ──
  function handleDeleteDocument(doc: BillingDocument) {
    Alert.alert(
      'Delete Document',
      `Remove "${doc.file_name ?? 'this document'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteDocument.mutate({
              docId: doc.id,
              caseId: doc.billing_case_id,
              profileId: doc.profile_id,
            });
          },
        },
      ],
    );
  }

  // ── Completeness ──
  const completeness = getCompleteness(billingCase, docCount);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.backText}>{'\u2039'} Back</Text>
            </TouchableOpacity>
          </View>

          {/* Editable title */}
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
              <TouchableOpacity onPress={startEditTitle} style={styles.titleTouchable} activeOpacity={0.6}>
                <Text style={styles.title} numberOfLines={2}>{billingCase.title}</Text>
                <Ionicons name="pencil-outline" size={16} color={COLORS.text.tertiary} style={styles.titleEditIcon} />
              </TouchableOpacity>
            )}
          </View>

          <View style={[styles.statusBadge, { backgroundColor: statusColor + '1A' }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {BILLING_STATUS_LABELS[billingCase.status]}
            </Text>
          </View>
        </View>

        {/* Completeness Indicator */}
        <View style={styles.sectionPadded}>
          <CompletenessCard completeness={completeness} />
        </View>

        {/* Details */}
        <View style={styles.sectionPadded}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>DETAILS</Text>
            <TouchableOpacity onPress={openEditModal} activeOpacity={0.7}>
              <View style={styles.editButton}>
                <Ionicons name="pencil-outline" size={14} color={COLORS.primary.DEFAULT} />
                <Text style={styles.editButtonText}>Edit</Text>
              </View>
            </TouchableOpacity>
          </View>
          <Card>
            {billingCase.provider_name && (
              <DetailRow label="Provider" value={billingCase.provider_name} />
            )}
            {billingCase.payer_name && (
              <DetailRow label="Payer" value={billingCase.payer_name} />
            )}
            {billingCase.service_date_start && (
              <DetailRow
                label="Service Date"
                value={
                  billingCase.service_date_end && billingCase.service_date_end !== billingCase.service_date_start
                    ? `${formatDate(billingCase.service_date_start)} - ${formatDate(billingCase.service_date_end)}`
                    : formatDate(billingCase.service_date_start)
                }
              />
            )}
            {billingCase.notes && (
              <DetailRow label="Notes" value={billingCase.notes} />
            )}
            {!billingCase.provider_name && !billingCase.payer_name && !billingCase.service_date_start && !billingCase.notes && (
              <TouchableOpacity onPress={openEditModal} activeOpacity={0.7}>
                <Text style={styles.noDetailsText}>No details added yet — tap to add</Text>
              </TouchableOpacity>
            )}
          </Card>
        </View>

        {/* Your Notes (freeform_input display) */}
        {billingCase.freeform_input ? (
          <View style={styles.sectionPadded}>
            <TouchableOpacity
              onPress={() => setNotesExpanded(!notesExpanded)}
              activeOpacity={0.7}
            >
              <View style={styles.notesHeaderRow}>
                <Text style={styles.sectionLabel}>YOUR NOTES</Text>
                <Ionicons
                  name={notesExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={COLORS.text.tertiary}
                />
              </View>
            </TouchableOpacity>
            {notesExpanded && (
              <Card>
                <Text style={styles.freeformDisplay}>{billingCase.freeform_input}</Text>
              </Card>
            )}
            {!notesExpanded && (
              <Card>
                <Text style={styles.freeformPreview} numberOfLines={2}>
                  {billingCase.freeform_input}
                </Text>
              </Card>
            )}
          </View>
        ) : null}

        {/* Add Details section */}
        <View style={styles.sectionPadded}>
          <View style={styles.addDetailsHeader}>
            <Ionicons name="mic-outline" size={16} color={COLORS.text.secondary} />
            <Text style={styles.addDetailsLabel}>Add Details</Text>
          </View>
          <View style={styles.addDetailsContainer}>
            <TextInput
              style={styles.addDetailsInput}
              placeholder="Type or dictate additional details about this bill..."
              placeholderTextColor={COLORS.text.tertiary}
              value={addDetailsText}
              onChangeText={setAddDetailsText}
              multiline
              textAlignVertical="top"
            />
            <View style={styles.addDetailsFooter}>
              {detailsSaved && (
                <View style={styles.savedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={COLORS.success.DEFAULT} />
                  <Text style={styles.savedText}>Saved</Text>
                </View>
              )}
              <View style={styles.addDetailsSpacer} />
              <TouchableOpacity
                onPress={handleSaveDetails}
                disabled={!addDetailsText.trim() || updateCase.isPending}
                style={[styles.saveDetailsButton, !addDetailsText.trim() && styles.saveDetailsButtonDisabled]}
                activeOpacity={0.7}
              >
                <Text style={[styles.saveDetailsText, !addDetailsText.trim() && styles.saveDetailsTextDisabled]}>
                  Save
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Extraction Status */}
        {isExtracting && (
          <View style={styles.sectionPadded}>
            <Card style={styles.extractionStatusCard}>
              <View style={styles.extractionStatusRow}>
                <ActivityIndicator size="small" color={COLORS.primary.DEFAULT} />
                <Text style={styles.extractionStatusText}>Extracting billing details...</Text>
              </View>
            </Card>
          </View>
        )}
        {lastJobFailed && (
          <View style={styles.sectionPadded}>
            <Card style={styles.extractionWarningCard}>
              <View style={styles.extractionStatusRow}>
                <Ionicons name="warning-outline" size={18} color={COLORS.warning.DEFAULT} />
                <Text style={styles.extractionWarningText}>
                  Extraction encountered an issue. You can add details manually.
                </Text>
              </View>
              {lastJob?.billing_document_id && billingCase && (
                <TouchableOpacity
                  style={styles.retryButton}
                  activeOpacity={0.7}
                  onPress={() => {
                    retryExtraction.mutate({
                      documentId: lastJob.billing_document_id!,
                      caseId: billingCase.id,
                      profileId: billingCase.profile_id,
                      householdId: billingCase.household_id,
                    });
                  }}
                >
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              )}
            </Card>
          </View>
        )}

        {/* Totals */}
        <View style={styles.sectionPadded}>
          <Text style={styles.sectionLabel}>TOTALS</Text>
          <Card>
            {hasTotals ? (
              <>
                {billingCase.total_billed != null && (
                  <TotalRow label="Billed" amount={billingCase.total_billed} confidence={billingCase.totals_confidence} />
                )}
                {billingCase.total_allowed != null && (
                  <TotalRow label="Allowed" amount={billingCase.total_allowed} confidence={billingCase.totals_confidence} />
                )}
                {billingCase.total_plan_paid != null && (
                  <TotalRow label="Plan Paid" amount={billingCase.total_plan_paid} confidence={billingCase.totals_confidence} />
                )}
                {billingCase.total_patient_responsibility != null && (
                  <TotalRow
                    label="Your Responsibility"
                    amount={billingCase.total_patient_responsibility}
                    confidence={billingCase.totals_confidence}
                    bold
                  />
                )}
              </>
            ) : (
              <View style={styles.pendingContainer}>
                {isExtracting ? (
                  <>
                    <ActivityIndicator size="small" color={COLORS.text.tertiary} />
                    <Text style={styles.pendingText}>Extracting totals...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="receipt-outline" size={20} color={COLORS.text.tertiary} />
                    <Text style={styles.pendingText}>
                      No billing totals yet — upload a document or describe your bill to extract details
                    </Text>
                  </>
                )}
              </View>
            )}
          </Card>
        </View>

        {/* Line Items */}
        <LineItemsSection ledgerLines={ledgerLines ?? []} />

        {/* Documents */}
        <View style={styles.sectionPadded}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>DOCUMENTS</Text>
            <TouchableOpacity
              onPress={() => router.push(`/(main)/billing/${billingCase.id}/add-document`)}
              activeOpacity={0.7}
            >
              <View style={styles.addDocButton}>
                <Ionicons name="add" size={16} color={COLORS.primary.DEFAULT} />
                <Text style={styles.addDocText}>Add</Text>
              </View>
            </TouchableOpacity>
          </View>
          {(documents ?? []).length === 0 ? (
            <Card>
              <View style={styles.emptyDocsContainer}>
                <Ionicons name="document-attach-outline" size={32} color={COLORS.text.tertiary} />
                <Text style={styles.emptyDocsText}>No documents yet</Text>
                <Text style={styles.emptyDocsSubtext}>
                  Upload a bill or EOB to get started
                </Text>
              </View>
            </Card>
          ) : (
            (documents ?? []).map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                onDelete={() => handleDeleteDocument(doc)}
              />
            ))
          )}
        </View>

        {/* Placeholder sections for future steps */}
        <PlaceholderSection
          icon="search-outline"
          title="Findings"
          description="Will appear after document extraction"
        />
        <PlaceholderSection
          icon="list-outline"
          title="Action Plan"
          description="Will appear after findings review"
        />
        <PlaceholderSection
          icon="call-outline"
          title="Calls"
          description="Track phone calls with providers and insurers"
        />
        <PlaceholderSection
          icon="card-outline"
          title="Payments"
          description="Record payments made and refunds received"
        />
        <PlaceholderSection
          icon="time-outline"
          title="Timeline"
          description="Full history of this case"
        />

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Edit Details Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                  <Text style={styles.backText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>Edit Details</Text>
                <TouchableOpacity onPress={handleSaveEditModal} disabled={updateCase.isPending}>
                  <Text style={[styles.modalSaveText, updateCase.isPending && styles.modalSaveTextDisabled]}>
                    Save
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.modalForm}>
                <Input
                  label="Provider"
                  placeholder="e.g., City General Hospital"
                  value={editProvider}
                  onChangeText={setEditProvider}
                />
                <Input
                  label="Insurance / Payer"
                  placeholder="e.g., Blue Cross PPO"
                  value={editPayer}
                  onChangeText={setEditPayer}
                />
                <DatePicker
                  label="Service Date (Start)"
                  value={editDateStart}
                  onChange={setEditDateStart}
                  mode="date"
                  maximumDate={new Date()}
                />
                <DatePicker
                  label="Service Date (End)"
                  value={editDateEnd}
                  onChange={setEditDateEnd}
                  mode="date"
                  minimumDate={editDateStart ?? undefined}
                  maximumDate={new Date()}
                />
                <Input
                  label="Notes"
                  placeholder="Any additional context..."
                  value={editNotes}
                  onChangeText={setEditNotes}
                  multiline
                  numberOfLines={3}
                  style={styles.multilineInput}
                />
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Completeness Logic ────────────────────────────────────────────────────────

interface CompletenessInfo {
  score: number;
  max: number;
  suggestion: string | null;
}

function getCompleteness(
  billingCase: BillingCaseWithDocCount,
  docCount: number,
): CompletenessInfo {
  let score = 0;
  const max = 5;

  const hasProvider = !!billingCase.provider_name;
  const hasPayer = !!billingCase.payer_name;
  const hasDates = !!billingCase.service_date_start;
  const hasDocs = docCount > 0;
  const hasFreeform = !!(billingCase.freeform_input || billingCase.notes);

  if (hasProvider) score++;
  if (hasPayer) score++;
  if (hasDates) score++;
  if (hasDocs) score++;
  if (hasFreeform) score++;

  let suggestion: string | null = null;
  if (score < max) {
    if (!hasDocs) {
      suggestion = 'Upload a bill or EOB to unlock extraction and mismatch detection';
    } else if (!hasPayer) {
      suggestion = 'Add your insurance company to enable call scripts';
    } else if (!hasProvider) {
      suggestion = 'Add the provider name to keep your cases organized';
    } else if (!hasDates) {
      suggestion = 'Add service dates to track filing deadlines';
    } else if (!hasFreeform) {
      suggestion = 'Describe what happened — CareLead can extract key details';
    }
  }

  return { score, max, suggestion };
}

function CompletenessCard({ completeness }: { completeness: CompletenessInfo }) {
  const { score, max, suggestion } = completeness;
  const ratio = score / max;
  const isComplete = score === max;

  return (
    <Card style={styles.completenessCard}>
      <View style={styles.completenessHeader}>
        <Text style={styles.completenessTitle}>Case strength: {score}/{max}</Text>
      </View>
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { flex: ratio }]} />
        {ratio < 1 && <View style={{ flex: 1 - ratio }} />}
      </View>
      {suggestion && (
        <View style={styles.suggestionRow}>
          <Ionicons name="bulb-outline" size={14} color={COLORS.secondary.DEFAULT} />
          <Text style={styles.suggestionText}>{suggestion}</Text>
        </View>
      )}
      {isComplete && (
        <View style={styles.suggestionRow}>
          <Ionicons name="checkmark-circle" size={14} color={COLORS.success.DEFAULT} />
          <Text style={styles.completeText}>Looking good! CareLead has what it needs to help with this case.</Text>
        </View>
      )}
    </Card>
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

function TotalRow({ label, amount, bold, confidence }: { label: string; amount: number; bold?: boolean; confidence?: number | null }) {
  return (
    <View style={styles.totalRow}>
      <View style={styles.totalLabelRow}>
        <Text style={[styles.totalLabel, bold && styles.totalLabelBold]}>{label}</Text>
        {confidence != null && <ConfidenceIcon confidence={confidence} />}
      </View>
      <Text style={[styles.totalAmount, bold && styles.totalAmountBold]}>
        ${amount.toFixed(2)}
      </Text>
    </View>
  );
}

function ConfidenceIcon({ confidence }: { confidence: number }) {
  if (confidence >= 0.8) {
    return <Ionicons name="checkmark-circle" size={14} color={COLORS.success.DEFAULT} style={styles.confidenceIcon} />;
  }
  if (confidence >= 0.5) {
    return <Ionicons name="warning" size={14} color={COLORS.warning.DEFAULT} style={styles.confidenceIcon} />;
  }
  return (
    <View style={styles.lowConfidenceRow}>
      <Ionicons name="alert-circle" size={14} color={COLORS.error.DEFAULT} style={styles.confidenceIcon} />
      <Text style={styles.needsReviewText}>Needs review</Text>
    </View>
  );
}

function LineItemsSection({ ledgerLines }: { ledgerLines: BillingLedgerLine[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const lineItems = ledgerLines.filter((l) => l.line_kind !== 'total');

  if (lineItems.length === 0) {
    return (
      <View style={styles.sectionPadded}>
        <Text style={styles.sectionLabel}>LINE ITEMS</Text>
        <Card>
          <Text style={styles.noLineItemsText}>No line items extracted yet</Text>
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.sectionPadded}>
      <Text style={styles.sectionLabel}>LINE ITEMS ({lineItems.length})</Text>
      {lineItems.map((item) => {
        const isExpanded = expandedId === item.id;
        return (
          <TouchableOpacity
            key={item.id}
            activeOpacity={0.7}
            onPress={() => setExpandedId(isExpanded ? null : item.id)}
          >
            <Card style={styles.lineItemCard}>
              <View style={styles.lineItemHeader}>
                <View style={styles.lineItemInfo}>
                  <Text style={styles.lineItemDescription} numberOfLines={isExpanded ? undefined : 1}>
                    {item.description ?? 'Line item'}
                  </Text>
                  {item.procedure_code && (
                    <Text style={styles.lineItemCode}>Code: {item.procedure_code}</Text>
                  )}
                </View>
                <View style={styles.lineItemAmounts}>
                  {item.amount_billed != null && (
                    <Text style={styles.lineItemAmount}>${item.amount_billed.toFixed(2)}</Text>
                  )}
                  {item.amount_patient != null && item.amount_patient !== item.amount_billed && (
                    <Text style={styles.lineItemPatientAmount}>You: ${item.amount_patient.toFixed(2)}</Text>
                  )}
                </View>
                {item.confidence != null && <ConfidenceIcon confidence={item.confidence} />}
              </View>
              {isExpanded && (
                <View style={styles.lineItemExpanded}>
                  {item.service_date && (
                    <Text style={styles.lineItemMeta}>Date: {formatDate(item.service_date)}</Text>
                  )}
                  {item.amount_allowed != null && (
                    <Text style={styles.lineItemMeta}>Allowed: ${item.amount_allowed.toFixed(2)}</Text>
                  )}
                  {item.amount_plan_paid != null && (
                    <Text style={styles.lineItemMeta}>Plan Paid: ${item.amount_plan_paid.toFixed(2)}</Text>
                  )}
                  {item.evidence_snippet && (
                    <View style={styles.evidenceContainer}>
                      <Text style={styles.evidenceLabel}>Source text:</Text>
                      <Text style={styles.evidenceText}>{item.evidence_snippet}</Text>
                    </View>
                  )}
                </View>
              )}
            </Card>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function DocumentCard({
  document,
  onDelete,
}: {
  document: BillingDocument;
  onDelete: () => void;
}) {
  const typeColor = DOC_TYPE_COLORS[document.doc_type] ?? COLORS.text.tertiary;

  return (
    <Card style={styles.docCard}>
      <View style={styles.docRow}>
        <View style={styles.docInfo}>
          <View style={styles.docTypeRow}>
            <View style={[styles.docTypeBadge, { backgroundColor: typeColor + '20' }]}>
              <Text style={[styles.docTypeBadgeText, { color: typeColor }]}>
                {BILLING_DOC_TYPE_LABELS[document.doc_type as keyof typeof BILLING_DOC_TYPE_LABELS] ?? document.doc_type}
              </Text>
            </View>
          </View>
          <Text style={styles.docName} numberOfLines={1}>
            {document.file_name ?? 'Untitled document'}
          </Text>
          <Text style={styles.docDate}>
            {new Date(document.created_at).toLocaleDateString('en-US', {
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

function PlaceholderSection({
  icon,
  title,
  description,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.sectionPadded}>
      <Text style={styles.sectionLabel}>{title.toUpperCase()}</Text>
      <Card>
        <View style={styles.placeholderContainer}>
          <Ionicons name={icon} size={20} color={COLORS.text.tertiary} />
          <Text style={styles.placeholderText}>{description}</Text>
        </View>
      </Card>
    </View>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
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
    paddingHorizontal: 24,
  },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.error.DEFAULT,
    marginBottom: 12,
  },
  errorBack: {
    marginTop: 8,
  },

  // Header
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
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  titleRow: {
    marginBottom: 8,
  },
  titleTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
  titleEditIcon: {
    marginLeft: 8,
  },
  titleInput: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary.DEFAULT,
    paddingVertical: 2,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Completeness
  completenessCard: {
    padding: 14,
  },
  completenessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  completenessTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.surface.muted,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    backgroundColor: COLORS.secondary.DEFAULT,
    borderRadius: 3,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  suggestionText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    flex: 1,
    lineHeight: 18,
  },
  completeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
    flex: 1,
    lineHeight: 18,
  },

  // Sections
  sectionPadded: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },

  // Edit button
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  editButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // Detail rows
  detailRow: {
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },
  noDetailsText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    textAlign: 'center',
  },
  placeholderText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    textAlign: 'center',
  },

  // Your Notes
  notesHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  freeformDisplay: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  freeformPreview: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },

  // Add Details
  addDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  addDetailsLabel: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  addDetailsContainer: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    overflow: 'hidden',
  },
  addDetailsInput: {
    minHeight: 80,
    padding: 14,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  addDetailsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  savedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  savedText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  addDetailsSpacer: { flex: 1 },
  saveDetailsButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  saveDetailsButtonDisabled: {
    opacity: 0.4,
  },
  saveDetailsText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  saveDetailsTextDisabled: {
    color: COLORS.text.tertiary,
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

  // Totals
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  totalLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  totalLabelBold: {
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  totalAmount: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
  },
  totalAmountBold: {
    fontWeight: FONT_WEIGHTS.bold,
    fontSize: FONT_SIZES.base,
  },
  pendingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  pendingText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    flex: 1,
  },

  // Documents
  addDocButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  addDocText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  emptyDocsContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  emptyDocsText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginTop: 8,
  },
  emptyDocsSubtext: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  docCard: {
    marginBottom: 8,
  },
  docRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  docInfo: {
    flex: 1,
    marginRight: 12,
  },
  docTypeRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  docTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  docTypeBadgeText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  docName: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
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

  // Confidence
  confidenceIcon: {
    marginLeft: 6,
  },
  lowConfidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  needsReviewText: {
    fontSize: 11,
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    marginLeft: 2,
  },

  // Line items
  noLineItemsText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    textAlign: 'center',
    paddingVertical: 4,
  },
  lineItemCard: {
    marginBottom: 8,
  },
  lineItemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  lineItemInfo: {
    flex: 1,
    marginRight: 12,
  },
  lineItemDescription: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  lineItemCode: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  lineItemAmounts: {
    alignItems: 'flex-end',
    marginRight: 4,
  },
  lineItemAmount: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  lineItemPatientAmount: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.secondary.dark,
    fontWeight: FONT_WEIGHTS.medium,
    marginTop: 2,
  },
  lineItemExpanded: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  lineItemMeta: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginBottom: 4,
  },
  evidenceContainer: {
    marginTop: 8,
    padding: 10,
    backgroundColor: COLORS.surface.muted,
    borderRadius: 8,
  },
  evidenceLabel: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  evidenceText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontStyle: 'italic',
    lineHeight: 18,
  },

  // Placeholder sections
  placeholderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },

  // Modal
  modalSafe: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  modalContent: {
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
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
  modalSaveTextDisabled: {
    opacity: 0.4,
  },
  modalForm: {
    paddingHorizontal: 24,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },

  bottomSpacer: {
    height: 40,
  },
});
