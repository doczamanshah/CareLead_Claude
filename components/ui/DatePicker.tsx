import { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

interface DatePickerProps {
  label?: string;
  value: Date | null;
  onChange: (date: Date | null) => void;
  mode?: 'date' | 'time' | 'datetime';
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  error?: string;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateTime(date: Date): string {
  return `${formatDate(date)} at ${formatTime(date)}`;
}

export function DatePicker({
  label,
  value,
  onChange,
  mode = 'date',
  placeholder,
  minimumDate,
  maximumDate,
  error,
}: DatePickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  // For datetime mode on iOS, we show date first, then time
  const [datetimeStep, setDatetimeStep] = useState<'date' | 'time'>('date');

  const displayValue = value
    ? mode === 'date'
      ? formatDate(value)
      : mode === 'time'
        ? formatTime(value)
        : formatDateTime(value)
    : null;

  const defaultPlaceholder =
    mode === 'date'
      ? 'Select a date'
      : mode === 'time'
        ? 'Select a time'
        : 'Select date and time';

  function handlePress() {
    if (mode === 'datetime') {
      setDatetimeStep('date');
    }
    setShowPicker(true);
  }

  function handleChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (event.type === 'dismissed') return;
    }

    if (!selectedDate) return;

    if (mode === 'datetime' && datetimeStep === 'date') {
      // Store the date portion, then show time picker
      onChange(selectedDate);
      if (Platform.OS === 'android') {
        setDatetimeStep('time');
        setShowPicker(true);
      } else {
        setDatetimeStep('time');
      }
      return;
    }

    if (mode === 'datetime' && datetimeStep === 'time') {
      // Merge time into the previously selected date
      if (value) {
        const merged = new Date(value);
        merged.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
        onChange(merged);
      } else {
        onChange(selectedDate);
      }
      if (Platform.OS === 'android') {
        setShowPicker(false);
      }
      setDatetimeStep('date');
      return;
    }

    onChange(selectedDate);
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
  }

  function handleDone() {
    if (mode === 'datetime' && datetimeStep === 'date') {
      // Switch to time step
      setDatetimeStep('time');
      return;
    }
    setShowPicker(false);
    setDatetimeStep('date');
  }

  function handleClear() {
    onChange(null);
    setShowPicker(false);
    setDatetimeStep('date');
  }

  const borderColor = error
    ? COLORS.error.DEFAULT
    : showPicker
      ? COLORS.primary.DEFAULT
      : COLORS.border.DEFAULT;

  const pickerMode: 'date' | 'time' =
    mode === 'datetime' ? datetimeStep : mode === 'time' ? 'time' : 'date';

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TouchableOpacity
        style={[styles.field, { borderColor }]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <Text style={displayValue ? styles.fieldText : styles.placeholderText}>
          {displayValue ?? placeholder ?? defaultPlaceholder}
        </Text>
      </TouchableOpacity>
      {error && <Text style={styles.error}>{error}</Text>}

      {showPicker && Platform.OS === 'ios' && (
        <View style={styles.pickerContainer}>
          {mode === 'datetime' && (
            <Text style={styles.stepLabel}>
              {datetimeStep === 'date' ? 'Select Date' : 'Select Time'}
            </Text>
          )}
          <DateTimePicker
            value={value ?? new Date()}
            mode={pickerMode}
            display="spinner"
            onChange={handleChange}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            style={styles.picker}
          />
          <View style={styles.pickerActions}>
            <TouchableOpacity onPress={handleClear} style={styles.pickerButton}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDone} style={styles.pickerButton}>
              <Text style={styles.doneText}>
                {mode === 'datetime' && datetimeStep === 'date' ? 'Next' : 'Done'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {showPicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={value ?? new Date()}
          mode={pickerMode}
          display="default"
          onChange={handleChange}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 6,
  },
  field: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fieldText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
  },
  placeholderText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.tertiary,
  },
  error: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.error.DEFAULT,
    marginTop: 4,
  },
  pickerContainer: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    marginTop: 8,
    overflow: 'hidden',
  },
  stepLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
    textAlign: 'center',
    paddingTop: 8,
  },
  picker: {
    height: 200,
  },
  pickerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  pickerButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  doneText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
