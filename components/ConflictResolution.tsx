import { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { CanonicalFact } from '@/lib/types/ask';

export interface ConflictResolutionChoice {
  keepFactSourceId: string;
  keepFactSourceType: string;
  archiveFactSourceIds: { id: string; sourceType: string }[];
}

interface ConflictResolutionProps {
  visible: boolean;
  facts: CanonicalFact[];
  busy?: boolean;
  onCancel: () => void;
  onKeepOne: (choice: ConflictResolutionChoice) => void;
  onKeepAll: () => void;
}

function formatRelativeDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function factPrimaryLine(fact: CanonicalFact): string {
  const v = (fact.value as Record<string, unknown>) ?? {};
  switch (fact.factType) {
    case 'medication': {
      const dose = (v.dose as string | null) ?? null;
      const freq = (v.frequency as string | null) ?? null;
      return [dose, freq].filter(Boolean).join(' — ') || 'Active';
    }
    case 'lab_result': {
      const text = (v.valueText as string | null) ?? null;
      const unit = (v.unit as string | null) ?? null;
      return text ? `${text}${unit ? ' ' + unit : ''}` : 'No value';
    }
    case 'allergy':
      return (v.reaction as string | null) ?? 'Allergy';
    case 'condition':
      return (v.status as string | null) ?? 'On record';
    default:
      return fact.secondaryValue ?? fact.displayName;
  }
}

export function ConflictResolutionModal({
  visible,
  facts,
  busy = false,
  onCancel,
  onKeepOne,
  onKeepAll,
}: ConflictResolutionProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset selection when the set of facts changes (new conflict opened).
  const factsKey = useMemo(() => facts.map((f) => f.id).join(','), [facts]);
  useEffect(() => {
    setSelectedId(null);
  }, [factsKey]);

  const canConfirm = !!selectedId && !busy;

  function handleKeepOne() {
    const picked = facts.find((f) => f.id === selectedId);
    if (!picked || !picked.sourceId || !picked.sourceType) return;
    const losers = facts
      .filter((f) => f.id !== picked.id && !!f.sourceId && !!f.sourceType)
      .map((f) => ({ id: f.sourceId as string, sourceType: f.sourceType as string }));
    onKeepOne({
      keepFactSourceId: picked.sourceId,
      keepFactSourceType: picked.sourceType,
      archiveFactSourceIds: losers,
    });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerIconWrap}>
              <Ionicons
                name="alert-circle"
                size={22}
                color={COLORS.tertiary.DEFAULT}
              />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Resolve Conflict</Text>
              <Text style={styles.subtitle}>
                CareLead found conflicting information. Which is correct?
              </Text>
            </View>
            <TouchableOpacity
              onPress={onCancel}
              hitSlop={8}
              accessibilityLabel="Close"
              disabled={busy}
            >
              <Ionicons name="close" size={22} color={COLORS.text.secondary} />
            </TouchableOpacity>
          </View>

          {/* Choices */}
          <ScrollView
            style={styles.choicesScroll}
            contentContainerStyle={styles.choicesContent}
            showsVerticalScrollIndicator={false}
          >
            {facts.length === 0 ? (
              <Text style={styles.emptyText}>No conflicting facts found.</Text>
            ) : (
              facts.map((fact) => {
                const selected = selectedId === fact.id;
                const dateLine = formatRelativeDate(fact.dateRelevant);
                return (
                  <TouchableOpacity
                    key={fact.id}
                    style={[styles.choice, selected && styles.choiceSelected]}
                    activeOpacity={0.7}
                    onPress={() => setSelectedId(fact.id)}
                    disabled={busy}
                  >
                    <View style={styles.radio}>
                      {selected && <View style={styles.radioInner} />}
                    </View>
                    <View style={styles.choiceContent}>
                      <Text style={styles.choiceName} numberOfLines={1}>
                        {fact.displayName}
                      </Text>
                      <Text style={styles.choicePrimary} numberOfLines={2}>
                        {factPrimaryLine(fact)}
                      </Text>
                      <View style={styles.choiceMeta}>
                        <Ionicons
                          name="pulse-outline"
                          size={11}
                          color={COLORS.text.tertiary}
                        />
                        <Text style={styles.choiceMetaText} numberOfLines={1}>
                          {fact.provenance.sourceLabel}
                          {dateLine ? ` · ${dateLine}` : ''}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btnPrimary, !canConfirm && styles.btnDisabled]}
              activeOpacity={0.7}
              onPress={handleKeepOne}
              disabled={!canConfirm}
            >
              {busy ? (
                <ActivityIndicator size="small" color={COLORS.text.inverse} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={16} color={COLORS.text.inverse} />
                  <Text style={styles.btnPrimaryText}>Keep this one</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnSecondary}
              activeOpacity={0.7}
              onPress={onKeepAll}
              disabled={busy}
            >
              <Text style={styles.btnSecondaryText}>Keep all — not a conflict</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnGhost}
              activeOpacity={0.7}
              onPress={onCancel}
              disabled={busy}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 16,
  },
  headerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.tertiary.DEFAULT + '14',
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
  choicesScroll: {
    maxHeight: 380,
  },
  choicesContent: {
    gap: 10,
    paddingBottom: 12,
  },
  emptyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    paddingVertical: 20,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  choiceSelected: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '08',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  choiceContent: {
    flex: 1,
    gap: 2,
  },
  choiceName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  choicePrimary: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    marginTop: 2,
  },
  choiceMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  choiceMetaText: {
    flex: 1,
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  actions: {
    marginTop: 16,
    gap: 8,
  },
  btnPrimary: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  btnDisabled: {
    backgroundColor: COLORS.border.DEFAULT,
  },
  btnPrimaryText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
  btnSecondary: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    alignItems: 'center',
  },
  btnSecondaryText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  btnGhost: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnGhostText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
