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
  useFindings,
  useRunReconciliation,
  useActions,
  useGenerateActionPlan,
  useActivateActions,
  useDismissAction,
  useUpdateActionStatus,
  useCallLogs,
  useCasePayments,
  useCreatePayment,
  useDeletePayment,
  useDenialRecords,
  useAppealPackets,
  useBillingTimeline,
} from '@/hooks/useBilling';
import { formatRelativeTime } from '@/lib/utils/relativeTime';
import type { TimelineEvent, TimelineEventType } from '@/services/billingTimeline';
import { computePaymentSummary } from '@/services/billing';
import {
  autoCompleteActions,
  autoDismissResolvedActions,
} from '@/services/billingActionPlan';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  BillingDocument,
  BillingLedgerLine,
  BillingCaseStatus,
  BillingCaseFinding,
  BillingCaseAction,
  BillingActionStatus,
  BillingCaseCallLog,
  BillingCasePayment,
  BillingPaymentKind,
  BillingPaymentMethod,
  PaymentSummary,
  FindingSeverity,
  BillingDenialRecord,
  BillingAppealPacket,
  AppealPacketStatus,
} from '@/lib/types/billing';
import {
  BILLING_STATUS_LABELS,
  BILLING_DOC_TYPE_LABELS,
  BILLING_PAYMENT_METHOD_LABELS,
  DENIAL_CATEGORY_LABELS,
  APPEAL_STATUS_LABELS,
} from '@/lib/types/billing';

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
  const { data: findings } = useFindings(id ?? null);
  const { reconcile, isReconciling } = useRunReconciliation(id ?? null);
  const { data: actions } = useActions(id ?? null);
  const { data: callLogs } = useCallLogs(id ?? null);
  const { data: payments } = useCasePayments(id ?? null);
  const { data: denialRecords } = useDenialRecords(id ?? null);
  const { data: appealPackets } = useAppealPackets(id ?? null);
  const { data: timelineEvents } = useBillingTimeline(id ?? null);
  const generateActionPlan = useGenerateActionPlan(id ?? null);
  const activateActionsMutation = useActivateActions();
  const dismissActionMutation = useDismissAction(id ?? null);
  const updateActionMutation = useUpdateActionStatus(id ?? null);
  const createPaymentMutation = useCreatePayment();
  const deletePaymentMutation = useDeletePayment();
  const updateCase = useUpdateBillingCase();
  const deleteDocument = useDeleteBillingDocument();
  const retryExtraction = useTriggerDocumentExtraction();

  // Scroll-to-action-plan support
  const scrollRef = useRef<ScrollView | null>(null);
  const actionPlanY = useRef<number>(0);
  const scrollToActionPlan = () => {
    scrollRef.current?.scrollTo({ y: Math.max(0, actionPlanY.current - 24), animated: true });
  };

  // Selected action IDs (for activation)
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());
  const [activationConfirmation, setActivationConfirmation] = useState<string | null>(null);

  // Extraction state
  const isExtracting = extractionJobs?.some((j) => j.status === 'processing') ?? false;
  const lastJob = extractionJobs?.[0] ?? null;
  const lastJobFailed = lastJob?.status === 'failed' && !isExtracting;
  const extractionCompleted = (billingCase?.last_extracted_at ?? null) !== null;
  const hasCase = !!billingCase;
  const lastReconciledAt = billingCase?.last_reconciled_at ?? null;

  // When extraction finishes, refresh cached data and re-run reconciliation.
  const prevIsExtracting = useRef(false);
  useEffect(() => {
    if (prevIsExtracting.current && !isExtracting && id) {
      queryClient.invalidateQueries({ queryKey: ['billing', 'case', id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'ledgerLines', id] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'denialRecords', id] });
      reconcile();
    }
    prevIsExtracting.current = isExtracting;
  }, [isExtracting, id, queryClient, reconcile]);

  // When a new document is added, re-run reconciliation.
  const prevDocCount = useRef<number | null>(null);
  useEffect(() => {
    const current = documents?.length ?? 0;
    if (prevDocCount.current !== null && current > prevDocCount.current && id) {
      reconcile();
    }
    prevDocCount.current = current;
  }, [documents?.length, id, reconcile]);

  // When payments change (added/updated/deleted), re-run reconciliation
  // because possible_overpayment depends on payment data.
  const paymentsFingerprint = (payments ?? [])
    .map((p) => `${p.id}:${p.kind}:${p.amount}`)
    .sort()
    .join('|');
  const lastPaymentsFingerprint = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !hasCase || isExtracting) return;
    if (payments === undefined) return;
    const prev = lastPaymentsFingerprint.current;
    if (prev === paymentsFingerprint) return;
    lastPaymentsFingerprint.current = paymentsFingerprint;
    if (prev !== null) {
      reconcile();
    }
  }, [paymentsFingerprint, id, hasCase, isExtracting, payments, reconcile]);

  // First-time reconciliation when the case loads and has never been reconciled.
  const initialReconcileFired = useRef(false);
  useEffect(() => {
    if (hasCase && lastReconciledAt === null && !initialReconcileFired.current && !isExtracting) {
      initialReconcileFired.current = true;
      reconcile();
    }
  }, [hasCase, lastReconciledAt, isExtracting, reconcile]);

  // Auto-generate the action plan after reconciliation settles (findings present & not reconciling).
  const generateActionPlanFn = generateActionPlan.mutate;
  const findingsFingerprint = (findings ?? [])
    .map((f) => `${f.code}:${f.severity}`)
    .sort()
    .join('|');
  const lastGeneratedFingerprint = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !hasCase || isReconciling) return;
    if (!lastReconciledAt) return;
    if (findingsFingerprint === '') return;
    if (lastGeneratedFingerprint.current === findingsFingerprint) return;
    lastGeneratedFingerprint.current = findingsFingerprint;
    generateActionPlanFn();
  }, [id, hasCase, isReconciling, lastReconciledAt, findingsFingerprint, generateActionPlanFn]);

  // Auto-complete actions whose underlying condition is satisfied, and
  // auto-dismiss proposed actions whose source finding has been resolved.
  const updateActionMutate = updateActionMutation.mutate;
  const dismissActionMutate = dismissActionMutation.mutate;
  const autoCleanupFingerprint = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !hasCase || isReconciling) return;
    if (!lastReconciledAt) return;
    if (!documents || !actions || !findings) return;
    if (actions.length === 0) return;

    const fp = [
      documents.map((d) => `${d.id}:${d.doc_type}`).sort().join('|'),
      actions.map((a) => `${a.id}:${a.status}`).sort().join('|'),
      findings.map((f) => f.code).sort().join('|'),
    ].join('||');
    if (autoCleanupFingerprint.current === fp) return;
    autoCleanupFingerprint.current = fp;

    const toComplete = autoCompleteActions({ documents, actions });
    const completeSet = new Set(toComplete);
    const toDismiss = autoDismissResolvedActions({ findings, actions }).filter(
      (aid) => !completeSet.has(aid),
    );

    for (const actionId of toComplete) {
      updateActionMutate({ actionId, status: 'done' });
    }
    for (const actionId of toDismiss) {
      dismissActionMutate(actionId);
    }
  }, [
    id,
    hasCase,
    isReconciling,
    lastReconciledAt,
    documents,
    actions,
    findings,
    updateActionMutate,
    dismissActionMutate,
  ]);

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

  // ── Case strength (derived from findings) ──
  const reconciled = billingCase.last_reconciled_at !== null;
  const caseStrength = getCaseStrength(findings, reconciled);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
      <ScrollView
        ref={scrollRef}
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

        {/* Case Strength */}
        <View style={styles.sectionPadded}>
          <CaseStrengthCard strength={caseStrength} />
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

        {/* What We Found (findings) */}
        <FindingsSection
          findings={findings ?? []}
          reconciled={reconciled}
          extractionCompleted={extractionCompleted}
          isReconciling={isReconciling}
          onRefresh={() => reconcile()}
          hasActionPlan={(actions ?? []).length > 0}
          onSeeActionPlan={scrollToActionPlan}
        />

        {/* Your Action Plan */}
        <View
          onLayout={(e) => {
            actionPlanY.current = e.nativeEvent.layout.y;
          }}
        >
          <ActionPlanSection
            actions={actions ?? []}
            findings={findings ?? []}
            selectedIds={selectedActionIds}
            onToggleSelect={(actionId) => {
              setSelectedActionIds((prev) => {
                const next = new Set(prev);
                if (next.has(actionId)) {
                  next.delete(actionId);
                } else {
                  next.add(actionId);
                }
                return next;
              });
            }}
            onDismiss={(actionId) => {
              dismissActionMutation.mutate(actionId);
              setSelectedActionIds((prev) => {
                const next = new Set(prev);
                next.delete(actionId);
                return next;
              });
            }}
            onActivate={() => {
              if (!billingCase) return;
              const toActivate = (actions ?? []).filter(
                (a) => a.status === 'proposed' && selectedActionIds.has(a.id),
              );
              if (toActivate.length === 0) return;
              activateActionsMutation.mutate(
                {
                  actions: toActivate,
                  caseId: billingCase.id,
                  profileId: billingCase.profile_id,
                  householdId: billingCase.household_id,
                },
                {
                  onSuccess: (result) => {
                    setSelectedActionIds(new Set());
                    const count = result.updated.length;
                    setActivationConfirmation(
                      `${count} task${count === 1 ? '' : 's'} created. Track them in your Tasks.`,
                    );
                    setTimeout(() => setActivationConfirmation(null), 3500);
                  },
                },
              );
            }}
            isActivating={activateActionsMutation.isPending}
            onMarkDone={(actionId) => {
              updateActionMutation.mutate({ actionId, status: 'done' });
            }}
            onViewTask={(taskId) => {
              router.push(`/(main)/tasks/${taskId}`);
            }}
            activationConfirmation={activationConfirmation}
          />
        </View>

        {/* Denials & Appeals */}
        <DenialsAppealsSection
          denialRecords={denialRecords ?? []}
          appealPackets={appealPackets ?? []}
          onManage={() => router.push(`/(main)/billing/${billingCase.id}/appeals`)}
        />

        <CallsSection
          callLogs={callLogs ?? []}
          onNewCall={() => router.push(`/(main)/billing/${id}/call-helper`)}
        />

        <PaymentsSection
          payments={payments ?? []}
          patientResponsibility={billingCase.total_patient_responsibility}
          onCreate={(input, onDone) =>
            createPaymentMutation.mutate(
              {
                caseId: billingCase.id,
                profileId: billingCase.profile_id,
                householdId: billingCase.household_id,
                ...input,
              },
              { onSuccess: () => onDone?.() },
            )
          }
          isCreating={createPaymentMutation.isPending}
          onDelete={(paymentId) => deletePaymentMutation.mutate(paymentId)}
        />

        {/* Timeline */}
        <TimelineSection events={timelineEvents ?? []} />

        {/* Resolve / Reopen */}
        <ResolveCaseSection
          status={billingCase.status}
          onResolve={() => {
            Alert.alert(
              'Resolve Case',
              'Mark this case as resolved? You can reopen it later.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Resolve',
                  onPress: () => {
                    updateCase.mutate({
                      caseId: billingCase.id,
                      updates: { status: 'resolved' },
                    });
                  },
                },
              ],
            );
          }}
          onReopen={() => {
            updateCase.mutate({
              caseId: billingCase.id,
              updates: { status: 'open' },
            });
          }}
          isPending={updateCase.isPending}
        />

        <View style={styles.bottomSpacer} />
      </ScrollView>
      </KeyboardAvoidingView>

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

// ── Case Strength (derived from findings) ────────────────────────────────────

type StrengthLevel = 'strong' | 'getting_there' | 'needs_attention' | 'unknown';

interface CaseStrengthInfo {
  level: StrengthLevel;
  label: string;
  color: string;
  ratio: number;
  suggestion: string | null;
}

function getCaseStrength(
  findings: BillingCaseFinding[] | undefined,
  reconciled: boolean,
): CaseStrengthInfo {
  if (!reconciled || !findings) {
    return {
      level: 'unknown',
      label: 'Checking...',
      color: COLORS.text.tertiary,
      ratio: 0.15,
      suggestion: null,
    };
  }

  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasWarning = findings.some((f) => f.severity === 'warning');
  const topSuggestion = findings[0]?.message ?? null;

  if (hasCritical) {
    return {
      level: 'needs_attention',
      label: 'Needs attention',
      color: COLORS.error.DEFAULT,
      ratio: 0.3,
      suggestion: topSuggestion,
    };
  }
  if (hasWarning) {
    return {
      level: 'getting_there',
      label: 'Getting there',
      color: COLORS.warning.DEFAULT,
      ratio: 0.65,
      suggestion: topSuggestion,
    };
  }
  return {
    level: 'strong',
    label: 'Strong',
    color: COLORS.success.DEFAULT,
    ratio: 1,
    suggestion: findings.length > 0 ? topSuggestion : null,
  };
}

function CaseStrengthCard({ strength }: { strength: CaseStrengthInfo }) {
  const { label, color, ratio, suggestion, level } = strength;
  return (
    <Card style={styles.completenessCard}>
      <View style={styles.strengthHeaderRow}>
        <Text style={styles.completenessTitle}>Case strength</Text>
        <View style={[styles.strengthChip, { backgroundColor: color + '1A' }]}>
          <Text style={[styles.strengthChipText, { color }]}>{label}</Text>
        </View>
      </View>
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { flex: ratio, backgroundColor: color }]} />
        {ratio < 1 && <View style={{ flex: 1 - ratio }} />}
      </View>
      {suggestion && (
        <View style={styles.suggestionRow}>
          <Ionicons name="bulb-outline" size={14} color={COLORS.secondary.DEFAULT} />
          <Text style={styles.suggestionText}>{suggestion}</Text>
        </View>
      )}
      {level === 'strong' && !suggestion && (
        <View style={styles.suggestionRow}>
          <Ionicons name="checkmark-circle" size={14} color={COLORS.success.DEFAULT} />
          <Text style={styles.completeText}>
            Looking good! CareLead has what it needs to help with this case.
          </Text>
        </View>
      )}
    </Card>
  );
}

// ── Findings ("What We Found") ───────────────────────────────────────────────

const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  critical: COLORS.error.DEFAULT,
  warning: COLORS.warning.DEFAULT,
  info: COLORS.primary.DEFAULT,
};

const SEVERITY_ICONS: Record<FindingSeverity, keyof typeof Ionicons.glyphMap> = {
  critical: 'alert-circle',
  warning: 'warning',
  info: 'information-circle',
};

function FindingsSection({
  findings,
  reconciled,
  extractionCompleted,
  isReconciling,
  onRefresh,
  hasActionPlan,
  onSeeActionPlan,
}: {
  findings: BillingCaseFinding[];
  reconciled: boolean;
  extractionCompleted: boolean;
  isReconciling: boolean;
  onRefresh: () => void;
  hasActionPlan: boolean;
  onSeeActionPlan: () => void;
}) {
  const hasFindings = findings.length > 0;
  const showAllClear = reconciled && !hasFindings && extractionCompleted;

  if (!hasFindings && !showAllClear) return null;

  return (
    <View style={styles.sectionPadded}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>WHAT WE FOUND</Text>
        <TouchableOpacity onPress={onRefresh} disabled={isReconciling} activeOpacity={0.7}>
          <View style={styles.refreshButton}>
            {isReconciling ? (
              <ActivityIndicator size="small" color={COLORS.primary.DEFAULT} />
            ) : (
              <Ionicons name="refresh" size={14} color={COLORS.primary.DEFAULT} />
            )}
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </View>
        </TouchableOpacity>
      </View>

      {hasFindings ? (
        findings.map((f) => (
          <FindingCard
            key={f.id}
            finding={f}
            hasActionPlan={hasActionPlan}
            onSeeActionPlan={onSeeActionPlan}
          />
        ))
      ) : (
        <Card style={styles.allClearCard}>
          <View style={styles.allClearRow}>
            <Ionicons
              name="checkmark-circle"
              size={22}
              color={COLORS.success.DEFAULT}
            />
            <Text style={styles.allClearText}>
              Everything looks good so far. No issues detected.
            </Text>
          </View>
        </Card>
      )}
    </View>
  );
}

function FindingCard({
  finding,
  hasActionPlan,
  onSeeActionPlan,
}: {
  finding: BillingCaseFinding;
  hasActionPlan: boolean;
  onSeeActionPlan: () => void;
}) {
  const severity = finding.severity as FindingSeverity;
  const color = SEVERITY_COLORS[severity] ?? COLORS.text.secondary;
  const iconName = SEVERITY_ICONS[severity] ?? 'information-circle';
  const bgColor = color + '0D';
  const borderColor = color + '33';
  const hasActions =
    Array.isArray(finding.recommended_actions) && finding.recommended_actions.length > 0;

  return (
    <Card
      style={{
        ...styles.findingCard,
        backgroundColor: bgColor,
        borderColor,
        borderWidth: 1,
      }}
    >
      <View style={styles.findingRow}>
        <Ionicons name={iconName} size={20} color={color} style={styles.findingIcon} />
        <View style={styles.findingContent}>
          <Text style={styles.findingMessage}>{finding.message}</Text>
          {hasActions && hasActionPlan && (
            <TouchableOpacity
              onPress={onSeeActionPlan}
              activeOpacity={0.7}
              style={styles.findingActionButton}
            >
              <Ionicons name="arrow-down" size={12} color={COLORS.primary.DEFAULT} />
              <Text style={styles.findingActionText}>See action plan below</Text>
            </TouchableOpacity>
          )}
          {hasActions && !hasActionPlan && (
            <Text style={styles.findingActionMutedText}>Action plan coming up…</Text>
          )}
        </View>
      </View>
    </Card>
  );
}

// ── Action Plan Section ──────────────────────────────────────────────────────

const ACTION_STATUS_LABELS: Record<BillingActionStatus, string> = {
  proposed: 'Proposed',
  active: 'Active',
  in_progress: 'In Progress',
  done: 'Done',
  dismissed: 'Dismissed',
};

const ACTION_STATUS_COLORS: Record<BillingActionStatus, string> = {
  proposed: COLORS.text.tertiary,
  active: COLORS.primary.DEFAULT,
  in_progress: COLORS.secondary.DEFAULT,
  done: COLORS.success.DEFAULT,
  dismissed: COLORS.text.tertiary,
};

function ActionPlanSection({
  actions,
  findings,
  selectedIds,
  onToggleSelect,
  onDismiss,
  onActivate,
  isActivating,
  onMarkDone,
  onViewTask,
  activationConfirmation,
}: {
  actions: BillingCaseAction[];
  findings: BillingCaseFinding[];
  selectedIds: Set<string>;
  onToggleSelect: (actionId: string) => void;
  onDismiss: (actionId: string) => void;
  onActivate: () => void;
  isActivating: boolean;
  onMarkDone: (actionId: string) => void;
  onViewTask: (taskId: string) => void;
  activationConfirmation: string | null;
}) {
  const proposed = actions.filter((a) => a.status === 'proposed');
  const activeOrInProgress = actions.filter(
    (a) => a.status === 'active' || a.status === 'in_progress',
  );
  const done = actions.filter((a) => a.status === 'done');

  // No findings & no actions → hide entirely.
  if (actions.length === 0 && findings.length === 0) return null;

  // Findings exist but no actions were generated (only non-actionable findings).
  if (actions.length === 0) {
    return (
      <View style={styles.sectionPadded}>
        <Text style={styles.sectionLabel}>YOUR ACTION PLAN</Text>
        <Card>
          <View style={styles.actionPlanEmptyRow}>
            <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.text.tertiary} />
            <Text style={styles.actionPlanEmptyText}>
              No specific actions needed right now.
            </Text>
          </View>
        </Card>
      </View>
    );
  }

  const selectedCount = proposed.reduce(
    (acc, a) => acc + (selectedIds.has(a.id) ? 1 : 0),
    0,
  );

  const hasPending = proposed.length > 0 || activeOrInProgress.length > 0;

  return (
    <View style={styles.sectionPadded}>
      <Text style={styles.sectionLabel}>YOUR ACTION PLAN</Text>

      {!hasPending && (
        <Card style={styles.allClearCard}>
          <View style={styles.allClearRow}>
            <Ionicons
              name="checkmark-circle"
              size={22}
              color={COLORS.success.DEFAULT}
            />
            <Text style={styles.allClearText}>
              All caught up. No pending actions.
            </Text>
          </View>
        </Card>
      )}

      {activationConfirmation && (
        <Card style={styles.activationConfirmationCard}>
          <View style={styles.activationConfirmationRow}>
            <Ionicons name="checkmark-circle" size={18} color={COLORS.success.DEFAULT} />
            <Text style={styles.activationConfirmationText}>{activationConfirmation}</Text>
          </View>
        </Card>
      )}

      {proposed.length > 0 && (
        <Card style={styles.proposedCard}>
          <Text style={styles.proposedHeader}>
            Suggested next steps based on what we found
          </Text>
          {proposed.map((action) => {
            const isSelected = selectedIds.has(action.id);
            return (
              <View key={action.id} style={styles.proposedRow}>
                <TouchableOpacity
                  onPress={() => onToggleSelect(action.id)}
                  activeOpacity={0.7}
                  style={styles.proposedCheckboxArea}
                >
                  <View
                    style={[
                      styles.proposedCheckbox,
                      isSelected && styles.proposedCheckboxChecked,
                    ]}
                  >
                    {isSelected && (
                      <Ionicons name="checkmark" size={14} color={COLORS.text.inverse} />
                    )}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onToggleSelect(action.id)}
                  activeOpacity={0.7}
                  style={styles.proposedBodyArea}
                >
                  <Text style={styles.proposedTitle}>{action.title}</Text>
                  {action.description ? (
                    <Text style={styles.proposedDescription}>{action.description}</Text>
                  ) : null}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onDismiss(action.id)}
                  activeOpacity={0.7}
                  style={styles.proposedDismissButton}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                >
                  <Ionicons name="close" size={18} color={COLORS.text.tertiary} />
                </TouchableOpacity>
              </View>
            );
          })}
          <View style={styles.proposedFooter}>
            <Text style={styles.proposedSelectionCount}>
              {selectedCount} selected
            </Text>
            <TouchableOpacity
              onPress={onActivate}
              disabled={selectedCount === 0 || isActivating}
              activeOpacity={0.7}
              style={[
                styles.activateButton,
                (selectedCount === 0 || isActivating) && styles.activateButtonDisabled,
              ]}
            >
              {isActivating ? (
                <ActivityIndicator size="small" color={COLORS.text.inverse} />
              ) : (
                <Text style={styles.activateButtonText}>Activate Selected</Text>
              )}
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {activeOrInProgress.map((action) => (
        <ActiveActionCard
          key={action.id}
          action={action}
          onViewTask={onViewTask}
          onMarkDone={onMarkDone}
        />
      ))}

      {done.map((action) => (
        <ActiveActionCard
          key={action.id}
          action={action}
          onViewTask={onViewTask}
          onMarkDone={onMarkDone}
        />
      ))}
    </View>
  );
}

function ActiveActionCard({
  action,
  onViewTask,
  onMarkDone,
}: {
  action: BillingCaseAction;
  onViewTask: (taskId: string) => void;
  onMarkDone: (actionId: string) => void;
}) {
  const status = action.status;
  const statusColor = ACTION_STATUS_COLORS[status];
  const isDone = status === 'done';
  const canMarkDone = status === 'active' || status === 'in_progress';

  return (
    <Card style={styles.activeActionCard}>
      <View style={styles.activeActionHeader}>
        <View style={[styles.activeActionBadge, { backgroundColor: statusColor + '1A' }]}>
          <Text style={[styles.activeActionBadgeText, { color: statusColor }]}>
            {ACTION_STATUS_LABELS[status]}
          </Text>
        </View>
      </View>
      <Text style={[styles.activeActionTitle, isDone && styles.activeActionTitleDone]}>
        {action.title}
      </Text>
      {action.description ? (
        <Text style={styles.activeActionDescription}>{action.description}</Text>
      ) : null}
      <View style={styles.activeActionFooter}>
        {action.linked_task_id && (
          <TouchableOpacity
            onPress={() => onViewTask(action.linked_task_id!)}
            activeOpacity={0.7}
            style={styles.viewTaskButton}
          >
            <Ionicons name="open-outline" size={14} color={COLORS.primary.DEFAULT} />
            <Text style={styles.viewTaskText}>View Task</Text>
          </TouchableOpacity>
        )}
        {canMarkDone && (
          <TouchableOpacity
            onPress={() => onMarkDone(action.id)}
            activeOpacity={0.7}
            style={styles.markDoneButton}
          >
            <Text style={styles.markDoneText}>Mark Done</Text>
          </TouchableOpacity>
        )}
      </View>
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

const CALL_PARTY_LABELS: Record<BillingCaseCallLog['party'], string> = {
  provider: 'Provider Billing',
  payer: 'Insurance',
  pharmacy: 'Pharmacy',
  other: 'Other',
};

function formatCallDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatFollowUpDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function CallLogCard({ log }: { log: BillingCaseCallLog }) {
  const [expanded, setExpanded] = useState(false);
  const partyLabel = log.party_name ?? CALL_PARTY_LABELS[log.party];

  return (
    <Card style={styles.callLogCard}>
      <View style={styles.callLogHeader}>
        <View style={styles.flex}>
          <Text style={styles.callLogParty}>{partyLabel}</Text>
          <Text style={styles.callLogDate}>{formatCallDate(log.called_at)}</Text>
        </View>
        {log.created_task_id ? (
          <View style={styles.callTaskPill}>
            <Ionicons name="checkmark-circle" size={12} color={COLORS.success.DEFAULT} />
            <Text style={styles.callTaskPillText}>Follow-up created</Text>
          </View>
        ) : null}
      </View>

      {(log.rep_name || log.reference_number) && (
        <View style={styles.callLogMeta}>
          {log.rep_name ? (
            <View style={styles.callMetaItem}>
              <Ionicons name="person-outline" size={13} color={COLORS.text.tertiary} />
              <Text style={styles.callMetaText}>{log.rep_name}</Text>
            </View>
          ) : null}
          {log.reference_number ? (
            <View style={styles.callMetaItem}>
              <Ionicons name="pricetag-outline" size={13} color={COLORS.text.tertiary} />
              <Text style={styles.callMetaText}>Ref #{log.reference_number}</Text>
            </View>
          ) : null}
        </View>
      )}

      {log.outcome ? (
        <TouchableOpacity activeOpacity={0.7} onPress={() => setExpanded((v) => !v)}>
          <Text
            style={styles.callLogOutcome}
            numberOfLines={expanded ? undefined : 2}
          >
            {log.outcome}
          </Text>
          {log.outcome.length > 140 ? (
            <Text style={styles.callLogExpandText}>
              {expanded ? 'Show less' : 'Show more'}
            </Text>
          ) : null}
        </TouchableOpacity>
      ) : null}

      {log.follow_up_due ? (
        <View style={styles.callFollowUpRow}>
          <Ionicons name="alarm-outline" size={14} color={COLORS.accent.dark} />
          <Text style={styles.callFollowUpText}>
            Follow up by {formatFollowUpDate(log.follow_up_due)}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function CallsSection({
  callLogs,
  onNewCall,
}: {
  callLogs: BillingCaseCallLog[];
  onNewCall: () => void;
}) {
  if (callLogs.length === 0) {
    return (
      <View style={styles.sectionPadded}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.callsHeaderLeft}>
            <Ionicons name="call-outline" size={16} color={COLORS.text.tertiary} />
            <Text style={styles.sectionLabel}>CALLS</Text>
          </View>
        </View>
        <Card>
          <View style={styles.callsEmpty}>
            <Text style={styles.callsEmptyText}>
              Track phone calls with providers and insurers
            </Text>
            <TouchableOpacity
              onPress={onNewCall}
              activeOpacity={0.8}
              style={styles.callsEmptyCta}
            >
              <Ionicons name="call" size={16} color={COLORS.text.inverse} />
              <Text style={styles.callsEmptyCtaText}>Start a Call</Text>
            </TouchableOpacity>
          </View>
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.sectionPadded}>
      <View style={styles.sectionHeaderRow}>
        <View style={styles.callsHeaderLeft}>
          <Ionicons name="call-outline" size={16} color={COLORS.text.tertiary} />
          <Text style={styles.sectionLabel}>CALLS</Text>
        </View>
        <TouchableOpacity
          onPress={onNewCall}
          activeOpacity={0.7}
          style={styles.newCallButton}
        >
          <Ionicons name="add" size={16} color={COLORS.primary.DEFAULT} />
          <Text style={styles.newCallButtonText}>New Call</Text>
        </TouchableOpacity>
      </View>
      {callLogs.map((log) => (
        <CallLogCard key={log.id} log={log} />
      ))}
    </View>
  );
}

// ── Denials & Appeals (compact summary) ─────────────────────────────────────

const DENIAL_APPEAL_STATUS_COLORS: Record<AppealPacketStatus, string> = {
  draft: COLORS.text.tertiary,
  ready: COLORS.accent.dark,
  submitted: COLORS.primary.DEFAULT,
  accepted: COLORS.success.DEFAULT,
  rejected: COLORS.error.DEFAULT,
};

function formatDeadline(iso: string | null): { label: string; color: string } | null {
  if (!iso) return null;
  const target = new Date(iso);
  const days = Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const dateStr = target.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  let color: string = COLORS.success.DEFAULT;
  if (days < 15) color = COLORS.error.DEFAULT;
  else if (days <= 30) color = COLORS.warning.DEFAULT;
  const suffix =
    days < 0 ? `${Math.abs(days)}d overdue` :
    days === 0 ? 'today' :
    `${days}d left`;
  return { label: `${dateStr} · ${suffix}`, color };
}

function DenialsAppealsSection({
  denialRecords,
  appealPackets,
  onManage,
}: {
  denialRecords: BillingDenialRecord[];
  appealPackets: BillingAppealPacket[];
  onManage: () => void;
}) {
  const hasDenials = denialRecords.length > 0;
  const topDenial = denialRecords[0] ?? null;
  const deadlineInfo = topDenial ? formatDeadline(topDenial.deadline) : null;
  const packetCount = appealPackets.length;
  const latestPacket = appealPackets[0] ?? null;

  return (
    <View style={styles.sectionPadded}>
      <View style={styles.denialsHeaderRow}>
        <Ionicons name="alert-circle-outline" size={16} color={COLORS.text.tertiary} />
        <Text style={styles.sectionLabel}>DENIALS & APPEALS</Text>
      </View>

      {hasDenials ? (
        <Card>
          {topDenial?.category && (
            <View style={styles.denialSummaryHeader}>
              <View style={[styles.denialCategoryBadge, { backgroundColor: COLORS.error.DEFAULT + '1A' }]}>
                <Text style={[styles.denialCategoryText, { color: COLORS.error.DEFAULT }]}>
                  {DENIAL_CATEGORY_LABELS[topDenial.category]}
                </Text>
              </View>
              {denialRecords.length > 1 && (
                <Text style={styles.denialExtraText}>
                  +{denialRecords.length - 1} more
                </Text>
              )}
            </View>
          )}
          {topDenial?.denial_reason && (
            <Text style={styles.denialSummaryReason} numberOfLines={2}>
              {topDenial.denial_reason}
            </Text>
          )}
          {deadlineInfo && (
            <View style={styles.denialSummaryDeadline}>
              <Ionicons name="time-outline" size={14} color={deadlineInfo.color} />
              <Text style={[styles.denialSummaryDeadlineText, { color: deadlineInfo.color }]}>
                Appeal by {deadlineInfo.label}
              </Text>
            </View>
          )}
          {packetCount > 0 && latestPacket && (
            <View style={styles.packetSummaryRow}>
              <View
                style={[
                  styles.packetStatusChip,
                  { backgroundColor: DENIAL_APPEAL_STATUS_COLORS[latestPacket.status] + '1A' },
                ]}
              >
                <Text
                  style={[
                    styles.packetStatusChipText,
                    { color: DENIAL_APPEAL_STATUS_COLORS[latestPacket.status] },
                  ]}
                >
                  {APPEAL_STATUS_LABELS[latestPacket.status]}
                </Text>
              </View>
              <Text style={styles.packetSummaryCount}>
                {packetCount} appeal packet{packetCount === 1 ? '' : 's'}
              </Text>
            </View>
          )}
          <TouchableOpacity
            onPress={onManage}
            activeOpacity={0.7}
            style={styles.manageAppealButton}
          >
            <Text style={styles.manageAppealButtonText}>
              {packetCount > 0 ? 'Manage Appeal' : 'Start an Appeal'}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={COLORS.primary.DEFAULT} />
          </TouchableOpacity>
        </Card>
      ) : (
        <Card>
          <Text style={styles.noDenialsText}>
            No denials detected. If you've received a denial letter, upload it or report it here.
          </Text>
          <TouchableOpacity
            onPress={onManage}
            activeOpacity={0.7}
            style={styles.reportDenialButton}
          >
            <Ionicons name="add-circle-outline" size={14} color={COLORS.primary.DEFAULT} />
            <Text style={styles.reportDenialButtonText}>Report a Denial</Text>
          </TouchableOpacity>
        </Card>
      )}
    </View>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────

const TIMELINE_COLORS: Record<TimelineEventType, string> = {
  status: COLORS.text.secondary,
  document: COLORS.primary.DEFAULT,
  extraction: COLORS.secondary.DEFAULT,
  finding: COLORS.accent.dark,
  action: COLORS.success.DEFAULT,
  call: COLORS.primary.light,
  payment: COLORS.success.DEFAULT,
  denial: COLORS.error.DEFAULT,
  appeal: COLORS.tertiary.DEFAULT,
};

const TIMELINE_ICONS: Record<TimelineEventType, keyof typeof Ionicons.glyphMap> = {
  status: 'flag-outline',
  document: 'document-text-outline',
  extraction: 'sparkles-outline',
  finding: 'warning-outline',
  action: 'checkmark-done-outline',
  call: 'call-outline',
  payment: 'card-outline',
  denial: 'close-circle-outline',
  appeal: 'megaphone-outline',
};

function TimelineSection({ events }: { events: TimelineEvent[] }) {
  const [showAll, setShowAll] = useState(false);

  if (events.length === 0) {
    return (
      <View style={styles.sectionPadded}>
        <Text style={styles.sectionLabel}>TIMELINE</Text>
        <Card>
          <View style={styles.timelineEmpty}>
            <Ionicons name="time-outline" size={20} color={COLORS.text.tertiary} />
            <Text style={styles.timelineEmptyText}>
              The history of this case will appear here as things happen.
            </Text>
          </View>
        </Card>
      </View>
    );
  }

  const visible = showAll ? events : events.slice(0, 10);

  return (
    <View style={styles.sectionPadded}>
      <Text style={styles.sectionLabel}>TIMELINE</Text>
      <Card style={styles.timelineCard}>
        {visible.map((event, index) => {
          const isLast = index === visible.length - 1;
          const color = TIMELINE_COLORS[event.type] ?? COLORS.text.tertiary;
          const iconName = TIMELINE_ICONS[event.type] ?? 'ellipse-outline';
          return (
            <View key={event.id} style={styles.timelineRow}>
              <View style={styles.timelineGutter}>
                <View style={[styles.timelineDot, { backgroundColor: color + '1A', borderColor: color }]}>
                  <Ionicons name={iconName} size={12} color={color} />
                </View>
                {!isLast && <View style={styles.timelineLine} />}
              </View>
              <View style={styles.timelineContent}>
                <Text style={styles.timelineDescription}>{event.description}</Text>
                {event.subtext ? (
                  <Text style={styles.timelineSubtext}>{event.subtext}</Text>
                ) : null}
                <Text style={styles.timelineTimestamp}>
                  {formatRelativeTime(event.timestamp)}
                </Text>
              </View>
            </View>
          );
        })}
      </Card>
      {events.length > 10 && (
        <TouchableOpacity
          onPress={() => setShowAll((v) => !v)}
          activeOpacity={0.7}
          style={styles.timelineToggle}
        >
          <Text style={styles.timelineToggleText}>
            {showAll ? 'Show less' : `Show all (${events.length})`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Resolve / Reopen ──────────────────────────────────────────────────────

function ResolveCaseSection({
  status,
  onResolve,
  onReopen,
  isPending,
}: {
  status: BillingCaseStatus;
  onResolve: () => void;
  onReopen: () => void;
  isPending: boolean;
}) {
  const isResolved = status === 'resolved' || status === 'closed';
  return (
    <View style={styles.sectionPadded}>
      {isResolved ? (
        <TouchableOpacity
          onPress={onReopen}
          disabled={isPending}
          activeOpacity={0.7}
          style={[styles.reopenButton, isPending && styles.resolveButtonDisabled]}
        >
          <Ionicons name="refresh-outline" size={16} color={COLORS.primary.DEFAULT} />
          <Text style={styles.reopenButtonText}>Reopen Case</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={onResolve}
          disabled={isPending}
          activeOpacity={0.7}
          style={[styles.resolveButton, isPending && styles.resolveButtonDisabled]}
        >
          <Ionicons name="checkmark-circle-outline" size={16} color={COLORS.text.secondary} />
          <Text style={styles.resolveButtonText}>Resolve Case</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Payments ──────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

function formatPaymentDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface PaymentFormInput {
  kind: BillingPaymentKind;
  amount: number;
  paidAt: string;
  method?: BillingPaymentMethod | null;
  note?: string | null;
  externalRef?: string | null;
}

function PaymentsSection({
  payments,
  patientResponsibility,
  onCreate,
  isCreating,
  onDelete,
}: {
  payments: BillingCasePayment[];
  patientResponsibility: number | null;
  onCreate: (input: PaymentFormInput, onDone?: () => void) => void;
  isCreating: boolean;
  onDelete: (paymentId: string) => void;
}) {
  const [formVisible, setFormVisible] = useState(false);
  const [formKind, setFormKind] = useState<BillingPaymentKind>('payment');

  const summary = computePaymentSummary(payments, patientResponsibility);

  function openForm(kind: BillingPaymentKind) {
    setFormKind(kind);
    setFormVisible(true);
  }

  function handleDelete(payment: BillingCasePayment) {
    const label = payment.kind === 'refund' ? 'refund' : 'payment';
    Alert.alert(
      `Delete ${label}?`,
      `Remove this ${label} of ${formatCurrency(Number(payment.amount))}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(payment.id),
        },
      ],
    );
  }

  return (
    <View style={styles.sectionPadded}>
      <View style={styles.paymentsHeaderRow}>
        <Ionicons name="card-outline" size={16} color={COLORS.text.tertiary} />
        <Text style={styles.sectionLabel}>PAYMENTS & REFUNDS</Text>
      </View>

      <PaymentSummaryCard summary={summary} />

      {payments.length === 0 ? (
        <Card style={styles.paymentsEmptyCard}>
          <Text style={styles.paymentsEmptyText}>No payments recorded yet</Text>
        </Card>
      ) : (
        payments.map((p) => (
          <PaymentCard key={p.id} payment={p} onDelete={() => handleDelete(p)} />
        ))
      )}

      <View style={styles.paymentsActions}>
        <TouchableOpacity
          onPress={() => openForm('payment')}
          activeOpacity={0.8}
          style={[styles.paymentAddButton, styles.paymentAddPrimary]}
        >
          <Ionicons name="add" size={16} color={COLORS.text.inverse} />
          <Text style={styles.paymentAddPrimaryText}>Add Payment</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => openForm('refund')}
          activeOpacity={0.8}
          style={[styles.paymentAddButton, styles.paymentAddSecondary]}
        >
          <Ionicons name="return-down-back" size={16} color={COLORS.primary.DEFAULT} />
          <Text style={styles.paymentAddSecondaryText}>Add Refund</Text>
        </TouchableOpacity>
      </View>

      <PaymentFormModal
        visible={formVisible}
        initialKind={formKind}
        isSaving={isCreating}
        onClose={() => setFormVisible(false)}
        onSave={(input) => {
          onCreate(input, () => setFormVisible(false));
        }}
      />
    </View>
  );
}

function PaymentSummaryCard({ summary }: { summary: PaymentSummary }) {
  const {
    totalPaid,
    totalRefunded,
    netPaid,
    patientResponsibility,
    estimatedBalance,
    possibleOverpayment,
  } = summary;

  const balanceLabel =
    patientResponsibility === null
      ? 'Not yet determined'
      : estimatedBalance !== null && estimatedBalance <= 0.01
        ? 'Paid in full'
        : formatCurrency(estimatedBalance ?? 0);

  return (
    <View style={styles.paymentSummaryCard}>
      <PaymentSummaryRow label="Total Paid" value={formatCurrency(totalPaid)} />
      {totalRefunded > 0 ? (
        <PaymentSummaryRow
          label="Refunds Received"
          value={formatCurrency(totalRefunded)}
        />
      ) : null}
      <PaymentSummaryRow
        label="Net Paid"
        value={formatCurrency(netPaid)}
        emphasize
      />

      <View style={styles.paymentSummaryDivider} />

      <PaymentSummaryRow
        label="Patient Responsibility"
        value={
          patientResponsibility === null
            ? 'Not yet determined'
            : formatCurrency(patientResponsibility)
        }
        muted={patientResponsibility === null}
      />
      <PaymentSummaryRow
        label="Estimated Balance"
        value={balanceLabel}
        muted={patientResponsibility === null}
        emphasize={
          patientResponsibility !== null && estimatedBalance !== null && estimatedBalance > 0.01
        }
      />

      {possibleOverpayment !== null && possibleOverpayment > 0 ? (
        <View style={styles.overpaymentAlert}>
          <View style={styles.overpaymentAlertRow}>
            <Ionicons name="alert-circle-outline" size={16} color={COLORS.tertiary.dark} />
            <Text style={styles.overpaymentAlertText}>
              You may have overpaid by {formatCurrency(possibleOverpayment)}
            </Text>
          </View>
          <Text style={styles.overpaymentAlertDetail}>
            This is based on extracted amounts. Verify with your provider before requesting a refund.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function PaymentSummaryRow({
  label,
  value,
  emphasize,
  muted,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  muted?: boolean;
}) {
  return (
    <View style={styles.paymentSummaryRow}>
      <Text style={[styles.paymentSummaryLabel, muted && styles.paymentSummaryMuted]}>
        {label}
      </Text>
      <Text
        style={[
          styles.paymentSummaryValue,
          emphasize && styles.paymentSummaryValueEmphasis,
          muted && styles.paymentSummaryMuted,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function PaymentCard({
  payment,
  onDelete,
}: {
  payment: BillingCasePayment;
  onDelete: () => void;
}) {
  const isRefund = payment.kind === 'refund';
  const badgeColor = isRefund ? COLORS.primary.DEFAULT : COLORS.success.DEFAULT;
  const methodLabel =
    payment.method && payment.method in BILLING_PAYMENT_METHOD_LABELS
      ? BILLING_PAYMENT_METHOD_LABELS[payment.method as BillingPaymentMethod]
      : payment.method;

  return (
    <Card style={styles.paymentCard}>
      <View style={styles.paymentCardRow}>
        <View style={styles.flex}>
          <View style={styles.paymentCardHeader}>
            <View style={[styles.paymentKindBadge, { backgroundColor: badgeColor + '20' }]}>
              <Text style={[styles.paymentKindBadgeText, { color: badgeColor }]}>
                {isRefund ? 'Refund' : 'Payment'}
              </Text>
            </View>
            <Text style={styles.paymentAmount}>{formatCurrency(Number(payment.amount))}</Text>
          </View>
          <Text style={styles.paymentDate}>{formatPaymentDate(payment.paid_at)}</Text>
          {(methodLabel || payment.external_ref) && (
            <View style={styles.paymentMetaRow}>
              {methodLabel ? (
                <View style={styles.paymentMetaItem}>
                  <Ionicons name="card-outline" size={12} color={COLORS.text.tertiary} />
                  <Text style={styles.paymentMetaText}>{methodLabel}</Text>
                </View>
              ) : null}
              {payment.external_ref ? (
                <View style={styles.paymentMetaItem}>
                  <Ionicons name="pricetag-outline" size={12} color={COLORS.text.tertiary} />
                  <Text style={styles.paymentMetaText}>Conf #{payment.external_ref}</Text>
                </View>
              ) : null}
            </View>
          )}
          {payment.note ? (
            <Text style={styles.paymentNote} numberOfLines={2}>
              {payment.note}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity onPress={onDelete} style={styles.paymentDeleteButton} activeOpacity={0.7}>
          <Ionicons name="trash-outline" size={18} color={COLORS.error.DEFAULT} />
        </TouchableOpacity>
      </View>
    </Card>
  );
}

const PAYMENT_METHOD_ORDER: BillingPaymentMethod[] = ['card', 'check', 'cash', 'portal', 'other'];

function PaymentFormModal({
  visible,
  initialKind,
  isSaving,
  onClose,
  onSave,
}: {
  visible: boolean;
  initialKind: BillingPaymentKind;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: PaymentFormInput) => void;
}) {
  const [kind, setKind] = useState<BillingPaymentKind>(initialKind);
  const [amountText, setAmountText] = useState('');
  const [paidAt, setPaidAt] = useState<Date | null>(null);
  const [method, setMethod] = useState<BillingPaymentMethod | null>(null);
  const [note, setNote] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setKind(initialKind);
      setAmountText('');
      setPaidAt(new Date());
      setMethod(null);
      setNote('');
      setConfirmation('');
      setAmountError(null);
    }
  }, [visible, initialKind]);

  function handleSave() {
    const trimmed = amountText.trim().replace(/[$,]/g, '');
    const amount = Number(trimmed);
    if (!trimmed || Number.isNaN(amount) || amount <= 0) {
      setAmountError('Enter an amount greater than $0');
      return;
    }
    if (!paidAt) {
      setAmountError(null);
      return;
    }
    setAmountError(null);
    onSave({
      kind,
      amount,
      paidAt: paidAt.toISOString(),
      method: method ?? null,
      note: note.trim() || null,
      externalRef: confirmation.trim() || null,
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
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
              <TouchableOpacity onPress={onClose} disabled={isSaving}>
                <Text style={styles.backText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {kind === 'refund' ? 'Add Refund' : 'Add Payment'}
              </Text>
              <TouchableOpacity onPress={handleSave} disabled={isSaving}>
                <Text style={[styles.modalSaveText, isSaving && styles.modalSaveTextDisabled]}>
                  Save
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalForm}>
              <View style={styles.paymentKindToggleRow}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setKind('payment')}
                  style={[
                    styles.paymentKindToggle,
                    kind === 'payment' && styles.paymentKindToggleActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.paymentKindToggleText,
                      kind === 'payment' && styles.paymentKindToggleTextActive,
                    ]}
                  >
                    Payment
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setKind('refund')}
                  style={[
                    styles.paymentKindToggle,
                    kind === 'refund' && styles.paymentKindToggleActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.paymentKindToggleText,
                      kind === 'refund' && styles.paymentKindToggleTextActive,
                    ]}
                  >
                    Refund
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.amountFieldWrap}>
                <Text style={styles.amountLabel}>Amount</Text>
                <View
                  style={[
                    styles.amountInputRow,
                    amountError ? styles.amountInputRowError : null,
                  ]}
                >
                  <Text style={styles.amountPrefix}>$</Text>
                  <TextInput
                    style={styles.amountInput}
                    value={amountText}
                    onChangeText={(t) => {
                      setAmountText(t);
                      if (amountError) setAmountError(null);
                    }}
                    placeholder="0.00"
                    placeholderTextColor={COLORS.text.tertiary}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                </View>
                {amountError ? (
                  <Text style={styles.amountErrorText}>{amountError}</Text>
                ) : null}
              </View>

              <DatePicker
                label="Date"
                value={paidAt}
                onChange={setPaidAt}
                mode="date"
                maximumDate={new Date()}
              />

              <View style={styles.methodFieldWrap}>
                <Text style={styles.amountLabel}>Method (optional)</Text>
                <View style={styles.methodChipsRow}>
                  {PAYMENT_METHOD_ORDER.map((m) => {
                    const selected = method === m;
                    return (
                      <TouchableOpacity
                        key={m}
                        activeOpacity={0.7}
                        onPress={() => setMethod(selected ? null : m)}
                        style={[
                          styles.methodChip,
                          selected && styles.methodChipSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.methodChipText,
                            selected && styles.methodChipTextSelected,
                          ]}
                        >
                          {BILLING_PAYMENT_METHOD_LABELS[m]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <Input
                label="Note (optional)"
                placeholder="Any additional context..."
                value={note}
                onChangeText={setNote}
                multiline
                numberOfLines={3}
                style={styles.multilineInput}
              />

              <Input
                label="Confirmation # (optional)"
                placeholder="e.g., 123456"
                value={confirmation}
                onChangeText={setConfirmation}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
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

  // Case strength
  completenessCard: {
    padding: 14,
  },
  strengthHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  completenessTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  strengthChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  strengthChipText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
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

  // Findings
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  refreshButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  findingCard: {
    marginBottom: 8,
  },
  findingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  findingIcon: {
    marginRight: 10,
    marginTop: 1,
  },
  findingContent: {
    flex: 1,
  },
  findingMessage: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  findingActionButton: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  findingActionText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  findingActionMutedText: {
    marginTop: 8,
    fontSize: 11,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
  },
  allClearCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success.DEFAULT,
    backgroundColor: COLORS.success.DEFAULT + '0D',
  },
  allClearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  allClearText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    flex: 1,
    fontWeight: FONT_WEIGHTS.medium,
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

  // Calls section
  callsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  newCallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  newCallButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  callsEmpty: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  callsEmptyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    textAlign: 'center',
  },
  callsEmptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  callsEmptyCtaText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  callLogCard: {
    marginBottom: 10,
  },
  callLogHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 6,
  },
  callLogParty: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  callLogDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  callTaskPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.success.DEFAULT + '1A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  callTaskPillText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  callLogMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 6,
  },
  callMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  callMetaText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  callLogOutcome: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  callLogExpandText: {
    marginTop: 4,
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  callFollowUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  callFollowUpText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.accent.dark,
    fontWeight: FONT_WEIGHTS.medium,
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

  // Action Plan
  actionPlanEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  actionPlanEmptyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    flex: 1,
  },
  activationConfirmationCard: {
    backgroundColor: COLORS.success.DEFAULT + '0D',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success.DEFAULT,
    marginBottom: 8,
  },
  activationConfirmationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activationConfirmationText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    flex: 1,
  },
  proposedCard: {
    paddingVertical: 12,
  },
  proposedHeader: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
  },
  proposedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  proposedCheckboxArea: {
    paddingRight: 10,
    paddingTop: 1,
  },
  proposedCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.border.dark,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
  },
  proposedCheckboxChecked: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
  },
  proposedBodyArea: {
    flex: 1,
    paddingRight: 8,
  },
  proposedTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  proposedDescription: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 3,
    lineHeight: 18,
  },
  proposedDismissButton: {
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  proposedFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  proposedSelectionCount: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  activateButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT,
    minWidth: 140,
    alignItems: 'center',
  },
  activateButtonDisabled: {
    opacity: 0.4,
  },
  activateButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  activeActionCard: {
    marginBottom: 8,
  },
  activeActionHeader: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  activeActionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activeActionBadgeText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  activeActionTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  activeActionTitleDone: {
    color: COLORS.text.secondary,
    textDecorationLine: 'line-through',
  },
  activeActionDescription: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 3,
    lineHeight: 18,
  },
  activeActionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  viewTaskButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  viewTaskText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  markDoneButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: COLORS.success.DEFAULT + '14',
  },
  markDoneText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Payments
  paymentsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  paymentSummaryCard: {
    backgroundColor: COLORS.secondary.DEFAULT + '14',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.secondary.DEFAULT + '33',
  },
  paymentSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  paymentSummaryLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  paymentSummaryValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  paymentSummaryValueEmphasis: {
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  paymentSummaryMuted: {
    color: COLORS.text.tertiary,
  },
  paymentSummaryDivider: {
    height: 1,
    backgroundColor: COLORS.border.DEFAULT,
    marginVertical: 8,
  },
  overpaymentAlert: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: COLORS.tertiary.DEFAULT + '14',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.tertiary.DEFAULT,
  },
  overpaymentAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  overpaymentAlertText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.tertiary.dark,
    flex: 1,
  },
  overpaymentAlertDetail: {
    marginTop: 4,
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    lineHeight: 16,
  },
  paymentsEmptyCard: {
    marginBottom: 8,
  },
  paymentsEmptyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    textAlign: 'center',
    paddingVertical: 6,
  },
  paymentsActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  paymentAddButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  paymentAddPrimary: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  paymentAddPrimaryText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
  paymentAddSecondary: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  paymentAddSecondaryText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  paymentCard: {
    marginBottom: 8,
  },
  paymentCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  paymentCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  paymentKindBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  paymentKindBadgeText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  paymentAmount: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  paymentDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  paymentMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 6,
  },
  paymentMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  paymentMetaText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  paymentNote: {
    marginTop: 6,
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    lineHeight: 16,
  },
  paymentDeleteButton: {
    padding: 6,
    marginLeft: 8,
  },

  // Payment form
  paymentKindToggleRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface.muted,
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  paymentKindToggle: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  paymentKindToggleActive: {
    backgroundColor: COLORS.surface.DEFAULT,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  paymentKindToggleText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  paymentKindToggleTextActive: {
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  amountFieldWrap: {
    marginBottom: 16,
  },
  amountLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 6,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  amountInputRowError: {
    borderColor: COLORS.error.DEFAULT,
  },
  amountPrefix: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.text.secondary,
    marginRight: 6,
    fontWeight: FONT_WEIGHTS.medium,
  },
  amountInput: {
    flex: 1,
    fontSize: FONT_SIZES.lg,
    color: COLORS.text.DEFAULT,
    paddingVertical: 12,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  amountErrorText: {
    marginTop: 4,
    fontSize: FONT_SIZES.xs,
    color: COLORS.error.DEFAULT,
  },
  methodFieldWrap: {
    marginBottom: 16,
  },
  methodChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  methodChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  methodChipSelected: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
    borderColor: COLORS.primary.DEFAULT,
  },
  methodChipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  methodChipTextSelected: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Denials & Appeals (compact)
  denialsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  denialSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  denialCategoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
  },
  denialCategoryText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  denialExtraText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  denialSummaryReason: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
    marginBottom: 8,
  },
  denialSummaryDeadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  denialSummaryDeadlineText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
  },
  packetSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  packetStatusChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 16,
  },
  packetStatusChipText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  packetSummaryCount: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  manageAppealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    marginTop: 4,
  },
  manageAppealButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  noDenialsText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
    marginBottom: 10,
  },
  reportDenialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  reportDenialButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // Timeline
  timelineCard: {
    paddingVertical: 4,
  },
  timelineEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  timelineEmptyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    flex: 1,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  timelineGutter: {
    width: 28,
    alignItems: 'center',
  },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: COLORS.border.DEFAULT,
    marginTop: 2,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: 10,
    paddingVertical: 8,
    paddingBottom: 12,
  },
  timelineDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  timelineSubtext: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  timelineTimestamp: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 4,
  },
  timelineToggle: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  timelineToggleText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // Resolve / Reopen
  resolveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  resolveButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  resolveButtonDisabled: {
    opacity: 0.5,
  },
  reopenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '33',
  },
  reopenButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
