/**
 * SmartSnoozeSheet
 *
 * Bottom sheet surfaced when the user wants to defer a task. Offers
 * contextual presets ("tomorrow morning", "after my appointment", etc.)
 * plus a custom date picker. Also offers a "Not relevant anymore" exit
 * that dismisses the task — used to train implicit signals.
 *
 * The sheet itself doesn't mutate the task — it just tells the host what
 * the user chose. The host wires snoozeTask + updateTaskStatus mutations.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  buildSnoozeOptions,
  fetchNextAppointment,
  type SnoozeOption,
} from '@/services/taskSnooze';
import type { Task } from '@/lib/types/tasks';

interface Props {
  visible: boolean;
  task: Task | null;
  onDismiss: () => void;
  onSnooze: (isoTarget: string) => void;
  onMarkIrrelevant: () => void;
}

export function SmartSnoozeSheet({
  visible,
  task,
  onDismiss,
  onSnooze,
  onMarkIrrelevant,
}: Props) {
  const [options, setOptions] = useState<SnoozeOption[]>(
    () => buildSnoozeOptions(new Date(), null),
  );
  const [showPicker, setShowPicker] = useState(false);
  const [customDate, setCustomDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    d.setHours(9, 0, 0, 0);
    return d;
  });

  // Refresh option list when the sheet opens — pulls the next appointment
  // so "After [provider]" is context-aware for this specific task.
  useEffect(() => {
    if (!visible || !task) return;
    let cancelled = false;
    (async () => {
      const result = await fetchNextAppointment(task.profile_id);
      if (cancelled) return;
      if (!result.success) {
        setOptions(buildSnoozeOptions(new Date(), null));
        return;
      }
      setOptions(buildSnoozeOptions(new Date(), result.data));
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, task]);

  const snoozedCount = task?.snoozed_count ?? 0;
  const isRepeatSnooze = snoozedCount >= 3;

  const title = useMemo(() => {
    if (isRepeatSnooze) {
      return "You've snoozed this a few times";
    }
    return 'Remind me later';
  }, [isRepeatSnooze]);

  function handlePick(option: SnoozeOption) {
    if (option.key === 'custom') {
      setShowPicker(true);
      return;
    }
    if (option.isoTarget) {
      onSnooze(option.isoTarget);
    }
  }

  function handlePickerChange(_: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === 'android') setShowPicker(false);
    if (date) setCustomDate(date);
  }

  function confirmCustomDate() {
    setShowPicker(false);
    onSnooze(customDate.toISOString());
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onDismiss}
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerIconWrap}>
              <Ionicons
                name={isRepeatSnooze ? 'alert-circle-outline' : 'time-outline'}
                size={20}
                color={COLORS.primary.DEFAULT}
              />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>{title}</Text>
              {isRepeatSnooze ? (
                <Text style={styles.subtitle}>
                  Would you like to keep reminding yourself, or remove it?
                </Text>
              ) : (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {task?.title}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onDismiss} hitSlop={8}>
              <Ionicons name="close" size={22} color={COLORS.text.secondary} />
            </TouchableOpacity>
          </View>

          {!showPicker && (
            <>
              <View style={styles.list}>
                {options.map((opt) => (
                  <TouchableOpacity
                    key={opt.key}
                    style={styles.optionRow}
                    activeOpacity={0.7}
                    onPress={() => handlePick(opt)}
                  >
                    <Ionicons
                      name={iconForOption(opt.key)}
                      size={18}
                      color={COLORS.primary.DEFAULT}
                      style={styles.optionIcon}
                    />
                    <View style={styles.optionText}>
                      <Text style={styles.optionLabel}>{opt.label}</Text>
                      {opt.detail && (
                        <Text style={styles.optionDetail}>{opt.detail}</Text>
                      )}
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={COLORS.text.tertiary}
                    />
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.irrelevantRow}
                onPress={onMarkIrrelevant}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color={COLORS.text.secondary}
                  style={styles.optionIcon}
                />
                <Text style={styles.irrelevantText}>
                  {isRepeatSnooze ? 'Remove it' : 'Not relevant anymore'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {showPicker && (
            <View style={styles.pickerWrap}>
              <Text style={styles.pickerLabel}>Pick a reminder date</Text>
              <View style={styles.pickerInner}>
                <DateTimePicker
                  value={customDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  minimumDate={new Date()}
                  onChange={handlePickerChange}
                />
              </View>
              <View style={styles.pickerActions}>
                <TouchableOpacity
                  style={styles.pickerCancel}
                  onPress={() => setShowPicker(false)}
                >
                  <Text style={styles.pickerCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pickerConfirm}
                  onPress={confirmCustomDate}
                >
                  <Text style={styles.pickerConfirmText}>Remind me then</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function iconForOption(
  key: SnoozeOption['key'],
): keyof typeof Ionicons.glyphMap {
  switch (key) {
    case 'tomorrow_morning':
      return 'sunny-outline';
    case 'this_weekend':
      return 'calendar-outline';
    case 'monday':
      return 'calendar-outline';
    case 'after_appointment':
      return 'medical-outline';
    case 'in_1_week':
      return 'time-outline';
    case 'in_1_month':
      return 'time-outline';
    case 'custom':
      return 'create-outline';
  }
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border.DEFAULT,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
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
    gap: 6,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface.muted,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  optionIcon: {
    width: 22,
  },
  optionText: {
    flex: 1,
  },
  optionLabel: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  optionDetail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  irrelevantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 10,
    marginTop: 8,
    justifyContent: 'center',
  },
  irrelevantText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  pickerWrap: {
    marginTop: 4,
  },
  pickerLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 10,
  },
  pickerInner: {
    alignItems: 'center',
    minHeight: Platform.OS === 'ios' ? 320 : 60,
  },
  pickerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  pickerCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    alignItems: 'center',
  },
  pickerCancelText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
  },
  pickerConfirm: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
  },
  pickerConfirmText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
});
