/**
 * SkipReasonSheet
 *
 * Lightweight, optional follow-up surfaced after a user taps Skip on a
 * medication dose. The skip itself is already logged by the time this
 * sheet renders — the sheet just lets the user annotate *why*, which
 * powers downstream prompts (refill task on "Ran out", stop suggestion
 * on "Doctor told me to stop").
 *
 * Never block the skip action: the sheet is dismissable with no answer,
 * and the host screen should always have moved on by the time the sheet
 * closes. Side-effect callbacks (suggestRefill, suggestStop) are passed
 * in so the host can decide what to do next without coupling this
 * component to navigation.
 */

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { SkipReason } from '@/services/medicationRefillCheck';

interface SkipReasonSheetProps {
  visible: boolean;
  medicationName: string;
  busy: boolean;
  onSubmit: (reason: SkipReason, freeformNote?: string) => void;
  onDismiss: () => void;
  /** Fired in addition to onSubmit when the reason is "ran_out". */
  onSuggestRefill?: () => void;
  /** Fired in addition to onSubmit when the reason is "doctor_stop". */
  onSuggestStop?: () => void;
}

interface ReasonOption {
  key: SkipReason;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const REASONS: ReasonOption[] = [
  {
    key: 'forgot',
    label: 'Just forgot',
    sub: 'Or will take it later',
    icon: 'time-outline',
  },
  {
    key: 'ran_out',
    label: 'Ran out',
    sub: "We'll line up a refill task",
    icon: 'flask-outline',
  },
  {
    key: 'doctor_stop',
    label: 'Doctor told me to stop',
    sub: "We'll prompt to mark it stopped",
    icon: 'medical-outline',
  },
  {
    key: 'side_effects',
    label: 'Side effects',
    sub: 'Worth flagging at your next visit',
    icon: 'alert-circle-outline',
  },
  {
    key: 'other',
    label: 'Something else',
    sub: 'Add a quick note',
    icon: 'ellipsis-horizontal-circle-outline',
  },
];

export function SkipReasonSheet({
  visible,
  medicationName,
  busy,
  onSubmit,
  onDismiss,
  onSuggestRefill,
  onSuggestStop,
}: SkipReasonSheetProps) {
  const [otherText, setOtherText] = useState('');
  const [showOtherInput, setShowOtherInput] = useState(false);

  function reset() {
    setOtherText('');
    setShowOtherInput(false);
  }

  function handleClose() {
    reset();
    onDismiss();
  }

  function handlePick(reason: SkipReason) {
    if (reason === 'other') {
      setShowOtherInput(true);
      return;
    }
    onSubmit(reason);
    if (reason === 'ran_out') onSuggestRefill?.();
    if (reason === 'doctor_stop') onSuggestStop?.();
    reset();
  }

  function handleSubmitOther() {
    onSubmit('other', otherText.trim() || undefined);
    reset();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={styles.headerIconWrap}>
                <Ionicons
                  name="help-circle-outline"
                  size={20}
                  color={COLORS.primary.DEFAULT}
                />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.title}>Why are you skipping?</Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {medicationName} · skip already logged
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={8}
                disabled={busy}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color={COLORS.text.secondary} />
              </TouchableOpacity>
            </View>

            {!showOtherInput ? (
              <View style={styles.list}>
                {REASONS.map((r) => (
                  <TouchableOpacity
                    key={r.key}
                    style={styles.reasonRow}
                    activeOpacity={0.7}
                    onPress={() => handlePick(r.key)}
                    disabled={busy}
                  >
                    <View style={styles.iconBubble}>
                      <Ionicons
                        name={r.icon}
                        size={18}
                        color={COLORS.primary.DEFAULT}
                      />
                    </View>
                    <View style={styles.reasonText}>
                      <Text style={styles.reasonLabel}>{r.label}</Text>
                      <Text style={styles.reasonSub}>{r.sub}</Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={COLORS.text.tertiary}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.list}>
                <Text style={styles.fieldLabel}>What happened?</Text>
                <TextInput
                  style={styles.notesInput}
                  placeholder="Optional — quick note"
                  placeholderTextColor={COLORS.text.tertiary}
                  value={otherText}
                  onChangeText={setOtherText}
                  multiline
                  autoFocus
                  textAlignVertical="top"
                />
                <View style={styles.actionRow}>
                  <Button title="Save" onPress={handleSubmitOther} loading={busy} />
                </View>
              </View>
            )}

            {!showOtherInput && (
              <TouchableOpacity
                style={styles.dismissRow}
                onPress={handleClose}
                disabled={busy}
                activeOpacity={0.7}
              >
                <Text style={styles.dismissText}>No reason — just dismiss</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  headerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary.DEFAULT + '14',
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
  list: {
    gap: 8,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface.muted,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonText: {
    flex: 1,
    gap: 2,
  },
  reasonLabel: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  reasonSub: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
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
    marginTop: 8,
  },
  dismissRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  dismissText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
