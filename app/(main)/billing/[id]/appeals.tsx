import { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import {
  useBillingCase,
  useBillingDocuments,
  useDenialRecords,
  useCaseParties,
  useAppealPackets,
  useCreateDenialRecord,
  useCreateAppealPacket,
  useUpdateAppealPacket,
  useDeleteAppealPacket,
  useGenerateAppealLetter,
} from '@/hooks/useBilling';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  DENIAL_CATEGORY_LABELS,
  APPEAL_STATUS_LABELS,
  BILLING_DOC_TYPE_LABELS,
} from '@/lib/types/billing';
import type {
  BillingAppealPacket,
  BillingDenialRecord,
  BillingDocument,
  AppealChecklistItem,
  AppealChecklist,
  AppealPacketStatus,
  DenialCategory,
} from '@/lib/types/billing';

const DENIAL_CATEGORIES: DenialCategory[] = [
  'prior_auth',
  'medical_necessity',
  'not_covered',
  'timely_filing',
  'coding_error',
  'duplicate',
  'other',
];

const APPEAL_STATUS_COLORS: Record<AppealPacketStatus, string> = {
  draft: COLORS.text.tertiary,
  ready: COLORS.accent.dark,
  submitted: COLORS.primary.DEFAULT,
  accepted: COLORS.success.DEFAULT,
  rejected: COLORS.error.DEFAULT,
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((target.getTime() - now.getTime()) / msPerDay);
}

function deadlineColor(days: number | null): string {
  if (days == null) return COLORS.text.tertiary;
  if (days < 15) return COLORS.error.DEFAULT;
  if (days <= 30) return COLORS.warning.DEFAULT;
  return COLORS.success.DEFAULT;
}

export default function AppealsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const caseId = id ?? null;

  const { data: billingCase, isLoading: caseLoading } = useBillingCase(caseId);
  const { data: denialRecords } = useDenialRecords(caseId);
  const { data: appealPackets } = useAppealPackets(caseId);
  const { data: caseParties } = useCaseParties(caseId);
  const { data: documents } = useBillingDocuments(caseId);

  const createDenial = useCreateDenialRecord();
  const createPacket = useCreateAppealPacket();
  const updatePacket = useUpdateAppealPacket();
  const deletePacket = useDeleteAppealPacket();

  const [reportFormVisible, setReportFormVisible] = useState(false);
  const [expandedPacketId, setExpandedPacketId] = useState<string | null>(null);

  const denials = denialRecords ?? [];
  const packets = appealPackets ?? [];

  const latestDenial = denials[0] ?? null;
  const latestDeadline = latestDenial?.deadline ?? null;

  if (caseLoading || !billingCase) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  function handleStartAppeal() {
    if (!billingCase) return;
    createPacket.mutate(
      {
        caseId: billingCase.id,
        profileId: billingCase.profile_id,
        householdId: billingCase.household_id,
        denialId: latestDenial?.id ?? null,
      },
      {
        onSuccess: (pkt) => {
          setExpandedPacketId(pkt.id);
        },
      },
    );
  }

  function handleDeletePacket(packet: BillingAppealPacket) {
    Alert.alert('Delete appeal packet?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deletePacket.mutate(packet.id);
          if (expandedPacketId === packet.id) setExpandedPacketId(null);
        },
      },
    ]);
  }

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
          <View style={styles.headerTopRow}>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.backText}>{'\u2039'} Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.replace('/(main)/(tabs)')}
              style={styles.homeButton}
              activeOpacity={0.7}
              hitSlop={8}
              accessibilityLabel="Go to Home"
            >
              <Ionicons name="home-outline" size={20} color={COLORS.text.secondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.title}>Denials & Appeals</Text>
          <Text style={styles.subtitle}>{billingCase.title}</Text>
        </View>

        {/* Denials section */}
        <View style={styles.sectionPadded}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>DENIALS</Text>
          </View>

          {denials.length > 0 ? (
            denials.map((denial) => <DenialCard key={denial.id} denial={denial} />)
          ) : (
            <Card style={styles.emptyCard}>
              <View style={styles.emptyIconRow}>
                <Ionicons
                  name="shield-checkmark-outline"
                  size={28}
                  color={COLORS.text.tertiary}
                />
                <Text style={styles.emptyTitle}>No denial detected</Text>
              </View>
              <Text style={styles.emptySubtext}>
                If you've received a denial letter, you can report it manually to start an appeal.
              </Text>
              <TouchableOpacity
                style={styles.reportButton}
                activeOpacity={0.7}
                onPress={() => setReportFormVisible((v) => !v)}
              >
                <Ionicons
                  name={reportFormVisible ? 'close-outline' : 'add-circle-outline'}
                  size={16}
                  color={COLORS.primary.DEFAULT}
                />
                <Text style={styles.reportButtonText}>
                  {reportFormVisible ? 'Cancel' : 'Report a Denial Manually'}
                </Text>
              </TouchableOpacity>
            </Card>
          )}

          {reportFormVisible && (
            <ManualDenialForm
              onCancel={() => setReportFormVisible(false)}
              onSubmit={(input) => {
                if (!billingCase) return;
                createDenial.mutate(
                  {
                    caseId: billingCase.id,
                    profileId: billingCase.profile_id,
                    householdId: billingCase.household_id,
                    category: input.category,
                    denialReason: input.reason,
                    deadline: input.deadline,
                  },
                  { onSuccess: () => setReportFormVisible(false) },
                );
              }}
              isSubmitting={createDenial.isPending}
            />
          )}
        </View>

        {/* Appeal Packets section */}
        <View style={styles.sectionPadded}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>APPEAL PACKETS</Text>
            {packets.length > 0 && (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleStartAppeal}
                disabled={createPacket.isPending}
              >
                <View style={styles.newPacketButton}>
                  <Ionicons name="add" size={16} color={COLORS.primary.DEFAULT} />
                  <Text style={styles.newPacketButtonText}>New</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {packets.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No appeal started yet</Text>
              <Text style={styles.emptySubtext}>
                Start an appeal packet to organize your documents, checklist, and letter.
              </Text>
              <View style={styles.startAppealButtonWrap}>
                <Button
                  title={createPacket.isPending ? 'Starting…' : 'Start an Appeal'}
                  onPress={handleStartAppeal}
                  variant="primary"
                  size="md"
                  disabled={createPacket.isPending}
                  loading={createPacket.isPending}
                />
              </View>
            </Card>
          ) : (
            packets.map((packet) => (
              <AppealPacketCard
                key={packet.id}
                packet={packet}
                expanded={expandedPacketId === packet.id}
                onToggle={() =>
                  setExpandedPacketId((prev) => (prev === packet.id ? null : packet.id))
                }
                onDelete={() => handleDeletePacket(packet)}
                documents={documents ?? []}
                denial={
                  (packet.billing_denial_id
                    ? denials.find((d) => d.id === packet.billing_denial_id)
                    : null) ?? latestDenial
                }
                deadline={latestDeadline}
                caseId={billingCase.id}
                profileId={billingCase.profile_id}
                billingCase={billingCase}
                caseParties={caseParties ?? null}
              />
            ))
          )}
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Denial Card ──────────────────────────────────────────────────────────

function DenialCard({ denial }: { denial: BillingDenialRecord }) {
  const days = daysUntil(denial.deadline);
  const deadlineLabel =
    denial.deadline && days != null
      ? days < 0
        ? `Deadline passed (${Math.abs(days)}d ago)`
        : days === 0
        ? 'Deadline today'
        : `${days} day${days === 1 ? '' : 's'} remaining`
      : null;
  const color = deadlineColor(days);

  return (
    <Card style={styles.denialCard}>
      <View style={styles.denialTopRow}>
        {denial.category && (
          <View style={[styles.categoryBadge, { backgroundColor: COLORS.error.DEFAULT + '1A' }]}>
            <Text style={[styles.categoryBadgeText, { color: COLORS.error.DEFAULT }]}>
              {DENIAL_CATEGORY_LABELS[denial.category]}
            </Text>
          </View>
        )}
        {denial.confidence != null && (
          <Text style={styles.confidenceText}>
            {Math.round(denial.confidence * 100)}% confidence
          </Text>
        )}
      </View>

      {denial.denial_reason && <Text style={styles.denialReason}>{denial.denial_reason}</Text>}

      {denial.deadline && (
        <View style={styles.deadlineRow}>
          <Ionicons name="time-outline" size={14} color={color} />
          <Text style={[styles.deadlineText, { color }]}>
            Appeal by {formatDate(denial.deadline)} · {deadlineLabel}
          </Text>
        </View>
      )}
    </Card>
  );
}

// ── Manual Denial Form ───────────────────────────────────────────────────

function ManualDenialForm({
  onCancel,
  onSubmit,
  isSubmitting,
}: {
  onCancel: () => void;
  onSubmit: (input: {
    category: DenialCategory;
    reason: string;
    deadline: string | null;
  }) => void;
  isSubmitting: boolean;
}) {
  const [category, setCategory] = useState<DenialCategory>('other');
  const [reason, setReason] = useState('');
  const [deadline, setDeadline] = useState<Date | null>(null);

  const canSubmit = reason.trim().length > 0 && !isSubmitting;

  return (
    <Card style={styles.formCard}>
      <Text style={styles.formTitle}>Report a Denial</Text>

        <Text style={styles.formLabel}>Denial Category</Text>
        <View style={styles.categoryGrid}>
          {DENIAL_CATEGORIES.map((cat) => {
            const active = cat === category;
            return (
              <TouchableOpacity
                key={cat}
                activeOpacity={0.7}
                style={[
                  styles.categoryChip,
                  active && styles.categoryChipActive,
                ]}
                onPress={() => setCategory(cat)}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    active && styles.categoryChipTextActive,
                  ]}
                >
                  {DENIAL_CATEGORY_LABELS[cat]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.formFieldSpacing}>
          <Input
            label="Denial Reason"
            placeholder="What does the denial letter say?"
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={3}
          />
        </View>

        <View style={styles.formFieldSpacing}>
          <DatePicker
            label="Appeal Deadline (optional)"
            value={deadline}
            onChange={setDeadline}
            mode="date"
            minimumDate={new Date()}
          />
        </View>

        <View style={styles.formButtonRow}>
          <TouchableOpacity onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Button
            title={isSubmitting ? 'Saving…' : 'Save Denial'}
            onPress={() =>
              onSubmit({
                category,
                reason: reason.trim(),
                deadline: deadline ? deadline.toISOString().split('T')[0] : null,
              })
            }
            variant="primary"
            size="md"
            disabled={!canSubmit}
            loading={isSubmitting}
          />
        </View>
    </Card>
  );
}

// ── Appeal Packet Card ───────────────────────────────────────────────────

function AppealPacketCard({
  packet,
  expanded,
  onToggle,
  onDelete,
  documents,
  denial,
  deadline,
  caseId,
  profileId,
  billingCase,
  caseParties,
}: {
  packet: BillingAppealPacket;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  documents: BillingDocument[];
  denial: BillingDenialRecord | null;
  deadline: string | null;
  caseId: string;
  profileId: string;
  billingCase: NonNullable<ReturnType<typeof useBillingCase>['data']>;
  caseParties: ReturnType<typeof useCaseParties>['data'];
}) {
  const updatePacket = useUpdateAppealPacket();
  const generateLetter = useGenerateAppealLetter();

  const [letterDraft, setLetterDraft] = useState(packet.letter_draft ?? '');
  const [letterDirty, setLetterDirty] = useState(false);
  const [outcomeText, setOutcomeText] = useState(packet.outcome ?? '');
  const [outcomeFormVisible, setOutcomeFormVisible] = useState(false);
  const [outcomeChoice, setOutcomeChoice] = useState<'accepted' | 'rejected'>('accepted');

  const statusColor = APPEAL_STATUS_COLORS[packet.status];
  const deadlineDays = daysUntil(deadline);

  const checklist: AppealChecklist = useMemo(
    () => (packet.checklist as AppealChecklist | null) ?? [],
    [packet.checklist],
  );
  const completedCount = checklist.filter((item) => item.done).length;
  const includedDocIds: string[] = useMemo(
    () => (Array.isArray(packet.included_doc_ids) ? (packet.included_doc_ids as string[]) : []),
    [packet.included_doc_ids],
  );

  function toggleChecklistItem(itemId: string) {
    const next: AppealChecklist = checklist.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item,
    );
    updatePacket.mutate({
      packetId: packet.id,
      updates: { checklist: next },
    });
  }

  function toggleDocument(docId: string) {
    const next = includedDocIds.includes(docId)
      ? includedDocIds.filter((id) => id !== docId)
      : [...includedDocIds, docId];
    updatePacket.mutate({
      packetId: packet.id,
      updates: { includedDocIds: next },
    });
  }

  function handleGenerate() {
    if (!denial) {
      Alert.alert(
        'No denial linked',
        'Link a denial record before generating a letter.',
      );
      return;
    }
    generateLetter.mutate(
      {
        caseId,
        profileId,
        denialRecord: denial,
        billingCase,
        caseParties: caseParties ?? null,
      },
      {
        onSuccess: (letter) => {
          setLetterDraft(letter);
          setLetterDirty(false);
          updatePacket.mutate({
            packetId: packet.id,
            updates: { letterDraft: letter },
          });
        },
        onError: (err) => {
          Alert.alert('Letter generation failed', err.message);
        },
      },
    );
  }

  function handleRegenerate() {
    Alert.alert(
      'Regenerate letter?',
      'Current edits to the draft will be replaced.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Regenerate', style: 'destructive', onPress: handleGenerate },
      ],
    );
  }

  function handleSaveLetter() {
    updatePacket.mutate(
      {
        packetId: packet.id,
        updates: { letterDraft },
      },
      {
        onSuccess: () => setLetterDirty(false),
      },
    );
  }

  function updateStatus(status: AppealPacketStatus) {
    updatePacket.mutate({ packetId: packet.id, updates: { status } });
  }

  function handleRecordOutcome() {
    updatePacket.mutate(
      {
        packetId: packet.id,
        updates: {
          status: outcomeChoice,
          outcome: outcomeText.trim() || null,
        },
      },
      {
        onSuccess: () => setOutcomeFormVisible(false),
      },
    );
  }

  return (
    <Card style={styles.packetCard}>
      {/* Header — always visible */}
      <TouchableOpacity activeOpacity={0.7} onPress={onToggle}>
        <View style={styles.packetHeaderRow}>
          <View style={styles.packetHeaderLeft}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '1A' }]}>
              <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                {APPEAL_STATUS_LABELS[packet.status]}
              </Text>
            </View>
            <Text style={styles.packetMeta}>Created {formatDate(packet.created_at)}</Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={COLORS.text.tertiary}
          />
        </View>

        <View style={styles.packetProgressRow}>
          <Text style={styles.packetProgressText}>
            {completedCount} of {checklist.length} checklist items complete
          </Text>
          {includedDocIds.length > 0 && (
            <Text style={styles.packetProgressText}>
              · {includedDocIds.length} doc{includedDocIds.length === 1 ? '' : 's'}
            </Text>
          )}
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.packetBody}>
          {/* Deadline */}
          {deadline && deadlineDays != null && (
            <View
              style={[
                styles.deadlineCallout,
                { backgroundColor: deadlineColor(deadlineDays) + '14' },
              ]}
            >
              <Ionicons
                name="time-outline"
                size={18}
                color={deadlineColor(deadlineDays)}
              />
              <Text style={[styles.deadlineCalloutText, { color: deadlineColor(deadlineDays) }]}>
                {deadlineDays < 0
                  ? `Appeal deadline passed ${Math.abs(deadlineDays)} days ago`
                  : deadlineDays === 0
                  ? `Appeal deadline is today (${formatDate(deadline)})`
                  : `${deadlineDays} days remaining to file · due ${formatDate(deadline)}`}
              </Text>
            </View>
          )}

          {/* Checklist */}
          <View style={styles.packetSection}>
            <Text style={styles.packetSectionLabel}>CHECKLIST</Text>
            {checklist.map((item) => (
              <ChecklistRow
                key={item.id}
                item={item}
                onToggle={() => toggleChecklistItem(item.id)}
              />
            ))}
          </View>

          {/* Documents */}
          <View style={styles.packetSection}>
            <Text style={styles.packetSectionLabel}>DOCUMENTS TO INCLUDE</Text>
            {documents.length === 0 ? (
              <Text style={styles.emptyInlineText}>
                No documents on this case yet. Upload bills, EOBs, or denial letters from the case detail.
              </Text>
            ) : (
              documents.map((doc) => {
                const selected = includedDocIds.includes(doc.id);
                return (
                  <TouchableOpacity
                    key={doc.id}
                    activeOpacity={0.7}
                    onPress={() => toggleDocument(doc.id)}
                    style={styles.docRow}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        selected && styles.checkboxChecked,
                      ]}
                    >
                      {selected && (
                        <Ionicons name="checkmark" size={14} color={COLORS.text.inverse} />
                      )}
                    </View>
                    <View style={styles.docRowInfo}>
                      <Text style={styles.docRowName} numberOfLines={1}>
                        {doc.file_name ?? 'Untitled document'}
                      </Text>
                      <Text style={styles.docRowType}>
                        {BILLING_DOC_TYPE_LABELS[doc.doc_type]}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {/* Appeal Letter */}
          <View style={styles.packetSection}>
            <Text style={styles.packetSectionLabel}>APPEAL LETTER</Text>
            <View style={styles.disclaimerBanner}>
              <Ionicons name="information-circle-outline" size={14} color={COLORS.accent.dark} />
              <Text style={styles.disclaimerText}>
                This is a template. Review and customize before sending. This is not legal advice.
              </Text>
            </View>

            {!packet.letter_draft && !generateLetter.isPending ? (
              <View style={styles.generateButtonWrap}>
                <Button
                  title="Generate Letter Draft"
                  onPress={handleGenerate}
                  variant="primary"
                  size="md"
                />
                <Text style={styles.generateHint}>
                  CareLead will draft a starting point from your denial and case info. You can edit it freely.
                </Text>
              </View>
            ) : generateLetter.isPending ? (
              <View style={styles.generatingContainer}>
                <ActivityIndicator color={COLORS.primary.DEFAULT} />
                <Text style={styles.generatingText}>Drafting your letter…</Text>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.letterEditor}
                  value={letterDraft}
                  onChangeText={(text) => {
                    setLetterDraft(text);
                    setLetterDirty(true);
                  }}
                  multiline
                  textAlignVertical="top"
                  placeholder="Your appeal letter will appear here..."
                  placeholderTextColor={COLORS.text.tertiary}
                />
                <View style={styles.letterActions}>
                  <TouchableOpacity
                    onPress={handleRegenerate}
                    activeOpacity={0.7}
                    style={styles.regenerateButton}
                    disabled={generateLetter.isPending}
                  >
                    <Ionicons name="refresh-outline" size={14} color={COLORS.text.secondary} />
                    <Text style={styles.regenerateText}>Regenerate</Text>
                  </TouchableOpacity>
                  {letterDirty && (
                    <Button
                      title={updatePacket.isPending ? 'Saving…' : 'Save Changes'}
                      onPress={handleSaveLetter}
                      variant="primary"
                      size="sm"
                      disabled={updatePacket.isPending}
                    />
                  )}
                </View>
              </>
            )}
          </View>

          {/* Actions */}
          <View style={styles.packetSection}>
            <Text style={styles.packetSectionLabel}>STATUS</Text>
            <View style={styles.statusButtonRow}>
              {packet.status === 'draft' && (
                <TouchableOpacity
                  style={styles.statusActionButton}
                  activeOpacity={0.7}
                  onPress={() => updateStatus('ready')}
                >
                  <Ionicons name="checkmark-circle-outline" size={16} color={COLORS.primary.DEFAULT} />
                  <Text style={styles.statusActionText}>Mark as Ready</Text>
                </TouchableOpacity>
              )}
              {(packet.status === 'draft' || packet.status === 'ready') && (
                <TouchableOpacity
                  style={styles.statusActionButton}
                  activeOpacity={0.7}
                  onPress={() => updateStatus('submitted')}
                >
                  <Ionicons name="send-outline" size={16} color={COLORS.primary.DEFAULT} />
                  <Text style={styles.statusActionText}>Mark as Submitted</Text>
                </TouchableOpacity>
              )}
              {packet.status === 'submitted' && (
                <TouchableOpacity
                  style={styles.statusActionButton}
                  activeOpacity={0.7}
                  onPress={() => setOutcomeFormVisible((v) => !v)}
                >
                  <Ionicons
                    name={outcomeFormVisible ? 'close-outline' : 'create-outline'}
                    size={16}
                    color={COLORS.primary.DEFAULT}
                  />
                  <Text style={styles.statusActionText}>
                    {outcomeFormVisible ? 'Cancel' : 'Record Outcome'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {packet.submitted_at && (
              <Text style={styles.submittedMeta}>
                Submitted {formatDate(packet.submitted_at)}
              </Text>
            )}
            {packet.outcome && (
              <View style={styles.outcomeDisplay}>
                <Text style={styles.outcomeDisplayLabel}>Outcome notes</Text>
                <Text style={styles.outcomeDisplayText}>{packet.outcome}</Text>
              </View>
            )}

            {outcomeFormVisible && (
              <View style={styles.outcomeForm}>
                <View style={styles.outcomeChoiceRow}>
                  {(['accepted', 'rejected'] as const).map((choice) => {
                    const active = outcomeChoice === choice;
                    const color =
                      choice === 'accepted' ? COLORS.success.DEFAULT : COLORS.error.DEFAULT;
                    return (
                      <TouchableOpacity
                        key={choice}
                        activeOpacity={0.7}
                        style={[
                          styles.outcomeChoiceButton,
                          active && { backgroundColor: color + '1A', borderColor: color },
                        ]}
                        onPress={() => setOutcomeChoice(choice)}
                      >
                        <Text
                          style={[
                            styles.outcomeChoiceText,
                            active && { color, fontWeight: FONT_WEIGHTS.semibold },
                          ]}
                        >
                          {choice === 'accepted' ? 'Accepted' : 'Rejected'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Input
                  label="Notes (optional)"
                  placeholder="What did the insurance company say?"
                  value={outcomeText}
                  onChangeText={setOutcomeText}
                  multiline
                  numberOfLines={3}
                />
                <View style={styles.outcomeFormButtonRow}>
                  <Button
                    title={updatePacket.isPending ? 'Saving…' : 'Save Outcome'}
                    onPress={handleRecordOutcome}
                    variant="primary"
                    size="md"
                    disabled={updatePacket.isPending}
                  />
                </View>
              </View>
            )}
          </View>

          {/* Delete */}
          <TouchableOpacity
            onPress={onDelete}
            activeOpacity={0.7}
            style={styles.deletePacketButton}
          >
            <Ionicons name="trash-outline" size={14} color={COLORS.error.DEFAULT} />
            <Text style={styles.deletePacketText}>Delete packet</Text>
          </TouchableOpacity>
        </View>
      )}
    </Card>
  );
}

// ── Checklist Row ────────────────────────────────────────────────────────

function ChecklistRow({
  item,
  onToggle,
}: {
  item: AppealChecklistItem;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.checklistRow}
      activeOpacity={0.7}
      onPress={onToggle}
    >
      <View style={[styles.checkbox, item.done && styles.checkboxChecked]}>
        {item.done && <Ionicons name="checkmark" size={14} color={COLORS.text.inverse} />}
      </View>
      <Text
        style={[
          styles.checklistLabel,
          item.done && styles.checklistLabelDone,
        ]}
      >
        {item.label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: { flex: 1 },
  scrollContent: {
    paddingBottom: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: COLORS.surface.DEFAULT,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
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
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },

  sectionPadded: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // Empty state
  emptyCard: {
    gap: 8,
  },
  emptyIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  emptySubtext: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  reportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    marginTop: 4,
  },
  reportButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  startAppealButtonWrap: {
    alignItems: 'flex-start',
    marginTop: 4,
  },

  // Denial card
  denialCard: {
    marginBottom: 10,
    gap: 10,
  },
  denialTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
  },
  categoryBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  confidenceText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  denialReason: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },
  deadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deadlineText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // Form
  formCard: {
    marginTop: 10,
    gap: 12,
  },
  formTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  formLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  formFieldSpacing: {
    marginTop: 4,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  categoryChipActive: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
    borderColor: COLORS.primary.DEFAULT,
  },
  categoryChipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  categoryChipTextActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  formButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  cancelText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },

  // Packet card
  packetCard: {
    marginBottom: 10,
  },
  packetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  packetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
  },
  statusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  packetMeta: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  packetProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  packetProgressText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  packetBody: {
    marginTop: 16,
    gap: 16,
  },

  // Packet detail sections
  packetSection: {
    gap: 8,
  },
  packetSectionLabel: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },

  deadlineCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
  },
  deadlineCalloutText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    flex: 1,
  },

  // Checklist
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.border.dark,
    backgroundColor: COLORS.surface.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
  },
  checklistLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    flex: 1,
    lineHeight: 20,
  },
  checklistLabelDone: {
    color: COLORS.text.tertiary,
    textDecorationLine: 'line-through',
  },

  // Documents selector
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  docRowInfo: {
    flex: 1,
  },
  docRowName: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  docRowType: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  emptyInlineText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontStyle: 'italic',
    paddingVertical: 4,
  },

  // Letter
  disclaimerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.accent.DEFAULT + '1A',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  disclaimerText: {
    flex: 1,
    fontSize: FONT_SIZES.xs,
    color: COLORS.accent.dark,
    lineHeight: 16,
  },
  generateButtonWrap: {
    gap: 8,
    marginTop: 8,
    alignItems: 'flex-start',
  },
  generateHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    lineHeight: 16,
  },
  generatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  generatingText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  letterEditor: {
    minHeight: 280,
    backgroundColor: COLORS.surface.muted,
    borderRadius: 10,
    padding: 16,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  letterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  regenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  regenerateText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // Status actions
  statusButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  statusActionText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  submittedMeta: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 4,
  },
  outcomeDisplay: {
    backgroundColor: COLORS.surface.muted,
    padding: 12,
    borderRadius: 8,
    marginTop: 4,
  },
  outcomeDisplayLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  outcomeDisplayText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  outcomeForm: {
    marginTop: 8,
    gap: 8,
  },
  outcomeChoiceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  outcomeChoiceButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    alignItems: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
  },
  outcomeChoiceText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  outcomeFormButtonRow: {
    alignItems: 'flex-start',
    marginTop: 4,
  },

  // Delete
  deletePacketButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginTop: 4,
  },
  deletePacketText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // New packet button
  newPacketButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  newPacketButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },

  bottomSpacer: {
    height: 40,
  },
});
