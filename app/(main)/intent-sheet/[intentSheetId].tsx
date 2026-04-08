import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIntentSheet } from '@/hooks/useIntentSheet';
import { useCommitIntentSheet } from '@/hooks/useCommitIntentSheet';
import { getFieldLabel } from '@/lib/utils/fieldLabels';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { IntentItem, IntentItemStatus } from '@/lib/types/intent-sheet';

// ── Local state per item ───────────────────────────────────────────────────

interface ItemState {
  status: IntentItemStatus;
  editedValue: string | null;
  isEditing: boolean;
}

function getDisplayValue(item: IntentItem): string {
  const value = item.proposed_value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    // Try common value fields
    const v = value as Record<string, unknown>;
    if (typeof v.value === 'string') return v.value;
    if (typeof v.name === 'string') return v.name;
    if (typeof v.title === 'string') return v.title;
    if (typeof v.description === 'string') return v.description;
    // Flatten simple objects into readable text
    const entries = Object.entries(v).filter(([, val]) => val != null && val !== '');
    if (entries.length === 1) return String(entries[0][1]);
    return entries.map(([k, val]) => `${k}: ${val}`).join(', ');
  }
  return JSON.stringify(value);
}

// ── Confidence indicator ───────────────────────────────────────────────────

function ConfidenceDot({ confidence }: { confidence: number | null }) {
  const value = confidence ?? 0;
  const color: string =
    value >= 0.8 ? COLORS.success.DEFAULT :
    value >= 0.5 ? COLORS.warning.DEFAULT :
    COLORS.error.DEFAULT;

  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

// ── Intent Item Card ───────────────────────────────────────────────────────

interface IntentItemCardProps {
  item: IntentItem;
  state: ItemState;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  onEditSubmit: (value: string) => void;
  onEditCancel: () => void;
  onEditChange: (value: string) => void;
}

function IntentItemCard({
  item,
  state,
  onAccept,
  onReject,
  onEdit,
  onEditSubmit,
  onEditCancel,
  onEditChange,
}: IntentItemCardProps) {
  const isReviewed = state.status !== 'pending';
  const displayValue = state.editedValue ?? getDisplayValue(item);

  const borderColor =
    state.status === 'accepted' || state.status === 'edited'
      ? COLORS.success.DEFAULT
      : state.status === 'rejected'
        ? COLORS.error.DEFAULT
        : COLORS.border.light;

  return (
    <View style={[styles.card, { borderLeftColor: borderColor, borderLeftWidth: isReviewed ? 4 : 1 }]}>
      {/* Header row */}
      <View style={styles.cardHeader}>
        <ConfidenceDot confidence={item.confidence} />
        <Text style={styles.fieldLabel}>{getFieldLabel(item.field_key)}</Text>
        {state.status === 'accepted' && <Text style={styles.statusIcon}>✓</Text>}
        {state.status === 'edited' && <Text style={styles.statusIcon}>✓</Text>}
        {state.status === 'rejected' && <Text style={styles.statusIconRed}>✕</Text>}
      </View>

      {/* Value */}
      {state.isEditing ? (
        <View style={styles.editContainer}>
          <TextInput
            style={styles.editInput}
            value={state.editedValue ?? displayValue}
            onChangeText={onEditChange}
            multiline
            autoFocus
          />
          <View style={styles.editActions}>
            <TouchableOpacity style={styles.editBtn} onPress={() => onEditSubmit(state.editedValue ?? displayValue)}>
              <Text style={styles.editBtnSave}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editBtn} onPress={onEditCancel}>
              <Text style={styles.editBtnCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text
          style={[
            styles.proposedValue,
            state.status === 'rejected' && styles.rejected,
          ]}
        >
          {displayValue}
        </Text>
      )}

      {/* Action buttons — only show when not editing */}
      {!state.isEditing && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.acceptBtn, state.status === 'accepted' && styles.acceptBtnActive]}
            onPress={onAccept}
          >
            <Text style={[styles.actionIcon, state.status === 'accepted' && styles.actionIconActive]}>✓</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.editActionBtn, state.status === 'edited' && styles.editBtnActive]}
            onPress={onEdit}
          >
            <Text style={[styles.actionIcon, styles.editIcon, state.status === 'edited' && styles.actionIconActive]}>✎</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.rejectBtn, state.status === 'rejected' && styles.rejectBtnActive]}
            onPress={onReject}
          >
            <Text style={[styles.actionIcon, state.status === 'rejected' && styles.actionIconActiveRed]}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────

export default function IntentSheetScreen() {
  const { intentSheetId } = useLocalSearchParams<{ intentSheetId: string }>();
  const router = useRouter();
  const { data: sheet, isLoading, error } = useIntentSheet(intentSheetId);
  const commitMutation = useCommitIntentSheet();

  // Local state: per-item review decisions
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  // After commit success
  const [commitResult, setCommitResult] = useState<{ factsCreated: number; tasksCreated: number } | null>(null);

  const items = sheet?.items ?? [];

  // Initialize item states when data loads
  const getItemState = useCallback(
    (itemId: string): ItemState =>
      itemStates[itemId] ?? { status: 'pending', editedValue: null, isEditing: false },
    [itemStates],
  );

  const updateItemState = useCallback(
    (itemId: string, patch: Partial<ItemState>) => {
      setItemStates((prev) => ({
        ...prev,
        [itemId]: { ...getItemState(itemId), ...patch },
      }));
    },
    [getItemState],
  );

  // Review progress
  const reviewedCount = useMemo(
    () => items.filter((item) => getItemState(item.id).status !== 'pending').length,
    [items, getItemState],
  );
  const allReviewed = items.length > 0 && reviewedCount === items.length;

  const handleAccept = useCallback(
    (itemId: string) => {
      const current = getItemState(itemId);
      // Toggle: if already accepted, go back to pending
      if (current.status === 'accepted') {
        updateItemState(itemId, { status: 'pending' });
      } else {
        updateItemState(itemId, { status: 'accepted', isEditing: false });
      }
    },
    [getItemState, updateItemState],
  );

  const handleReject = useCallback(
    (itemId: string) => {
      const current = getItemState(itemId);
      if (current.status === 'rejected') {
        updateItemState(itemId, { status: 'pending' });
      } else {
        updateItemState(itemId, { status: 'rejected', isEditing: false });
      }
    },
    [getItemState, updateItemState],
  );

  const handleEdit = useCallback(
    (itemId: string, item: IntentItem) => {
      const current = getItemState(itemId);
      updateItemState(itemId, {
        isEditing: true,
        editedValue: current.editedValue ?? getDisplayValue(item),
      });
    },
    [getItemState, updateItemState],
  );

  const handleEditSubmit = useCallback(
    (itemId: string, value: string) => {
      updateItemState(itemId, {
        status: 'edited',
        editedValue: value,
        isEditing: false,
      });
    },
    [updateItemState],
  );

  const handleEditCancel = useCallback(
    (itemId: string) => {
      updateItemState(itemId, { isEditing: false });
    },
    [updateItemState],
  );

  const handleEditChange = useCallback(
    (itemId: string, value: string) => {
      updateItemState(itemId, { editedValue: value });
    },
    [updateItemState],
  );

  const handleAcceptAll = useCallback(() => {
    const newStates: Record<string, ItemState> = {};
    for (const item of items) {
      const current = getItemState(item.id);
      if (current.status === 'pending') {
        newStates[item.id] = { status: 'accepted', editedValue: null, isEditing: false };
      } else {
        newStates[item.id] = current;
      }
    }
    setItemStates((prev) => ({ ...prev, ...newStates }));
  }, [items, getItemState]);

  const handleCommit = useCallback(async () => {
    if (!intentSheetId) return;

    // First, persist the review decisions to the database
    const { supabase } = await import('@/lib/supabase');

    for (const item of items) {
      const state = getItemState(item.id);
      if (state.status === 'pending') continue;

      const updateData: Record<string, unknown> = { status: state.status };
      if (state.status === 'edited' && state.editedValue) {
        updateData.edited_value = { value: state.editedValue };
      }
      await supabase.from('intent_items').update(updateData).eq('id', item.id);
    }

    // Then commit
    try {
      const result = await commitMutation.mutateAsync(intentSheetId);
      setCommitResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      Alert.alert('Error', message);
    }
  }, [intentSheetId, items, getItemState, commitMutation]);

  // ── Commit success screen ─────────────────────────────────────────────

  if (commitResult) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successContainer}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>Saved Successfully</Text>
          <Text style={styles.successDetail}>
            {commitResult.factsCreated} {commitResult.factsCreated === 1 ? 'item' : 'items'} added to profile
            {commitResult.tasksCreated > 0
              ? `, ${commitResult.tasksCreated} ${commitResult.tasksCreated === 1 ? 'task' : 'tasks'} created`
              : ''}
          </Text>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => router.replace('/(main)/(tabs)')}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading / Error ───────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading review...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !sheet) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Could not load intent sheet'}
          </Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main review UI ───────────────────────────────────────────────────

  const sourceLabel =
    sheet.source_type === 'voice'
      ? 'Voice Note'
      : sheet.source_type === 'extraction'
        ? 'Document'
        : 'Review';

  const dateLabel = new Date(sheet.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Review Extracted Data</Text>
          <Text style={styles.headerMeta}>
            {sourceLabel} · {dateLabel} · {items.length} {items.length === 1 ? 'item' : 'items'}
          </Text>
        </View>
      </View>

      {/* Accept All */}
      {reviewedCount < items.length && (
        <TouchableOpacity style={styles.acceptAllBtn} onPress={handleAcceptAll}>
          <Text style={styles.acceptAllText}>Accept All</Text>
        </TouchableOpacity>
      )}

      {/* Items */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {items.map((item) => (
          <IntentItemCard
            key={item.id}
            item={item}
            state={getItemState(item.id)}
            onAccept={() => handleAccept(item.id)}
            onReject={() => handleReject(item.id)}
            onEdit={() => handleEdit(item.id, item)}
            onEditSubmit={(value) => handleEditSubmit(item.id, value)}
            onEditCancel={() => handleEditCancel(item.id)}
            onEditChange={(value) => handleEditChange(item.id, value)}
          />
        ))}
      </ScrollView>

      {/* Sticky bottom bar */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <Text style={styles.progressText}>
          {reviewedCount} of {items.length} reviewed
        </Text>
        <TouchableOpacity
          style={[styles.commitButton, !allReviewed && styles.commitButtonDisabled]}
          disabled={!allReviewed || commitMutation.isPending}
          onPress={handleCommit}
        >
          {commitMutation.isPending ? (
            <Text style={styles.commitButtonText}>Saving...</Text>
          ) : (
            <Text style={styles.commitButtonText}>Confirm & Save</Text>
          )}
        </TouchableOpacity>
      </SafeAreaView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.error.DEFAULT,
    textAlign: 'center',
    marginBottom: 16,
  },
  backLink: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  backButton: {
    padding: 4,
    marginRight: 8,
  },
  backArrow: {
    fontSize: 32,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.bold,
    lineHeight: 32,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  headerMeta: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },

  // Accept All
  acceptAllBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.success.DEFAULT,
    backgroundColor: COLORS.success.light,
    alignItems: 'center',
  },
  acceptAllText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.success.DEFAULT,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },

  // Card
  card: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border.light,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  fieldLabel: {
    flex: 1,
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusIcon: {
    fontSize: FONT_SIZES.base,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.bold,
  },
  statusIconRed: {
    fontSize: FONT_SIZES.base,
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.bold,
  },
  proposedValue: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    lineHeight: FONT_SIZES.base * 1.5,
  },
  rejected: {
    textDecorationLine: 'line-through',
    color: COLORS.text.tertiary,
  },

  // Actions
  actions: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionIcon: {
    fontSize: 18,
    fontWeight: FONT_WEIGHTS.bold,
  },
  acceptBtn: {
    borderColor: COLORS.success.DEFAULT,
    backgroundColor: COLORS.success.light,
  },
  acceptBtnActive: {
    backgroundColor: COLORS.success.DEFAULT,
  },
  editActionBtn: {
    borderColor: COLORS.warning.DEFAULT,
    backgroundColor: COLORS.warning.light,
  },
  editBtnActive: {
    backgroundColor: COLORS.warning.DEFAULT,
  },
  editIcon: {
    color: COLORS.warning.DEFAULT,
  },
  rejectBtn: {
    borderColor: COLORS.error.DEFAULT,
    backgroundColor: COLORS.error.light,
  },
  rejectBtnActive: {
    backgroundColor: COLORS.error.DEFAULT,
  },
  actionIconActive: {
    color: COLORS.text.inverse,
  },
  actionIconActiveRed: {
    color: COLORS.text.inverse,
  },

  // Inline edit
  editContainer: {
    marginTop: 4,
  },
  editInput: {
    borderWidth: 1,
    borderColor: COLORS.border.dark,
    borderRadius: 8,
    padding: 12,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    backgroundColor: COLORS.surface.muted,
    minHeight: 44,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    gap: 12,
  },
  editBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  editBtnSave: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  editBtnCancel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface.DEFAULT,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.DEFAULT,
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  commitButton: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  commitButtonDisabled: {
    opacity: 0.4,
  },
  commitButtonText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Success screen
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  successIcon: {
    fontSize: 56,
    color: COLORS.success.DEFAULT,
    marginBottom: 16,
  },
  successTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  successDetail: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: FONT_SIZES.base * 1.5,
    marginBottom: 32,
  },
  doneButton: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 48,
    paddingVertical: 14,
    borderRadius: 12,
  },
  doneButtonText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
