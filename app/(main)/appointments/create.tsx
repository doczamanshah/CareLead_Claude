import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateAppointment } from '@/hooks/useAppointments';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPE_ICONS,
} from '@/lib/types/appointments';
import type { AppointmentType } from '@/lib/types/appointments';

const TYPES: AppointmentType[] = ['doctor', 'labs', 'imaging', 'procedure', 'therapy', 'other'];

const DATE_OPTIONS = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 Days', days: 3 },
  { label: 'In 1 Week', days: 7 },
  { label: 'In 2 Weeks', days: 14 },
] as const;

const TIME_OPTIONS = [
  { label: '8:00 AM', hour: 8, minute: 0 },
  { label: '9:00 AM', hour: 9, minute: 0 },
  { label: '10:00 AM', hour: 10, minute: 0 },
  { label: '11:00 AM', hour: 11, minute: 0 },
  { label: '1:00 PM', hour: 13, minute: 0 },
  { label: '2:00 PM', hour: 14, minute: 0 },
  { label: '3:00 PM', hour: 15, minute: 0 },
  { label: '4:00 PM', hour: 16, minute: 0 },
] as const;

function buildDateTime(dayOffset: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

export default function CreateAppointmentScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const createAppointment = useCreateAppointment();

  // After successful creation we show a brief "what's next?" screen rather
  // than auto-navigating. The patient chooses whether to prep now or later.
  const [createdAppointment, setCreatedAppointment] = useState<{
    id: string;
    title: string;
    provider_name: string | null;
  } | null>(null);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<AppointmentType>('doctor');
  const [provider, setProvider] = useState('');
  const [facility, setFacility] = useState('');
  const [location, setLocation] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');

  const [dateIdx, setDateIdx] = useState<number | null>(null);
  const [timeIdx, setTimeIdx] = useState<number | null>(null);
  const [pickerDate, setPickerDate] = useState<Date | null>(null);
  const [pickerTime, setPickerTime] = useState<Date | null>(null);

  const [titleError, setTitleError] = useState('');
  const [dateError, setDateError] = useState('');

  const handleSave = () => {
    if (!title.trim()) {
      setTitleError('Title is required');
      return;
    }
    if (!activeProfileId) return;

    let startTime: string | null = null;
    if (pickerDate && pickerTime) {
      const merged = new Date(pickerDate);
      merged.setHours(pickerTime.getHours(), pickerTime.getMinutes(), 0, 0);
      startTime = merged.toISOString();
    } else if (dateIdx !== null && timeIdx !== null) {
      const d = DATE_OPTIONS[dateIdx];
      const t = TIME_OPTIONS[timeIdx];
      startTime = buildDateTime(d.days, t.hour, t.minute);
    } else if (pickerDate && timeIdx !== null) {
      const t = TIME_OPTIONS[timeIdx];
      const merged = new Date(pickerDate);
      merged.setHours(t.hour, t.minute, 0, 0);
      startTime = merged.toISOString();
    } else if (dateIdx !== null && pickerTime) {
      const d = DATE_OPTIONS[dateIdx];
      const base = new Date();
      base.setDate(base.getDate() + d.days);
      base.setHours(pickerTime.getHours(), pickerTime.getMinutes(), 0, 0);
      startTime = base.toISOString();
    }

    if (!startTime) {
      setDateError('Pick a date and time');
      return;
    }

    createAppointment.mutate(
      {
        profile_id: activeProfileId,
        title: title.trim(),
        appointment_type: type,
        provider_name: provider.trim() || undefined,
        facility_name: facility.trim() || undefined,
        location_text: location.trim() || undefined,
        purpose: purpose.trim() || undefined,
        notes: notes.trim() || undefined,
        start_time: startTime,
      },
      {
        onSuccess: (appointment) => {
          setCreatedAppointment({
            id: appointment.id,
            title: appointment.title,
            provider_name: appointment.provider_name,
          });
        },
      },
    );
  };

  if (createdAppointment) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.successContainer}>
          <Text style={styles.successIcon}>{'\u2713'}</Text>
          <Text style={styles.successTitle}>Appointment created!</Text>
          <Text style={styles.successBody}>
            {createdAppointment.title}
            {createdAppointment.provider_name
              ? ` with ${createdAppointment.provider_name}`
              : ''}{' '}
            is on your calendar.
          </Text>
          <Text style={styles.successHint}>
            Would you like to start preparing now? It only takes a minute.
          </Text>

          <View style={styles.successActions}>
            <Button
              title="Prepare for Visit Now"
              onPress={() =>
                router.replace(
                  `/(main)/appointments/${createdAppointment.id}/plan`,
                )
              }
            />
            <View style={{ height: 10 }} />
            <Button
              title="I'll prepare later"
              variant="outline"
              onPress={() => router.replace('/(main)/appointments')}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'\u2039'} Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>New Appointment</Text>
        <View style={styles.navSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Input
          label="Title"
          placeholder="e.g., Cardiology follow-up"
          value={title}
          onChangeText={(text) => {
            setTitle(text);
            if (titleError) setTitleError('');
          }}
          error={titleError}
          autoFocus
        />

        {/* Type */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Type</Text>
          <View style={styles.typeGrid}>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.typeChip, type === t && styles.typeChipActive]}
                onPress={() => setType(t)}
              >
                <Text style={styles.typeIcon}>{APPOINTMENT_TYPE_ICONS[t]}</Text>
                <Text
                  style={[
                    styles.typeChipText,
                    type === t && styles.typeChipTextActive,
                  ]}
                >
                  {APPOINTMENT_TYPE_LABELS[t]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Input
          label="Provider (optional)"
          placeholder="e.g., Dr. Patel"
          value={provider}
          onChangeText={setProvider}
        />

        <Input
          label="Facility (optional)"
          placeholder="e.g., Mercy Clinic"
          value={facility}
          onChangeText={setFacility}
        />

        <Input
          label="Location (optional)"
          placeholder="Address or building"
          value={location}
          onChangeText={setLocation}
        />

        {/* Date */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Date</Text>
          <View style={styles.chipRow}>
            {DATE_OPTIONS.map((opt, idx) => (
              <TouchableOpacity
                key={opt.label}
                style={[styles.chip, dateIdx === idx && styles.chipActive]}
                onPress={() => {
                  setDateIdx(dateIdx === idx ? null : idx);
                  setPickerDate(null);
                  setDateError('');
                }}
              >
                <Text style={[styles.chipText, dateIdx === idx && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <DatePicker
            placeholder="Or pick a custom date"
            value={pickerDate}
            onChange={(date) => {
              setPickerDate(date);
              if (date) setDateIdx(null);
              setDateError('');
            }}
            mode="date"
            minimumDate={new Date()}
          />
        </View>

        {/* Time */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Time</Text>
          <View style={styles.chipRow}>
            {TIME_OPTIONS.map((opt, idx) => (
              <TouchableOpacity
                key={opt.label}
                style={[styles.chip, timeIdx === idx && styles.chipActive]}
                onPress={() => {
                  setTimeIdx(timeIdx === idx ? null : idx);
                  setPickerTime(null);
                  setDateError('');
                }}
              >
                <Text style={[styles.chipText, timeIdx === idx && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <DatePicker
            placeholder="Or pick a custom time"
            value={pickerTime}
            onChange={(time) => {
              setPickerTime(time);
              if (time) setTimeIdx(null);
              setDateError('');
            }}
            mode="time"
          />
          {dateError ? <Text style={styles.errorText}>{dateError}</Text> : null}
        </View>

        <Input
          label="Purpose (optional)"
          placeholder="What is this visit about?"
          value={purpose}
          onChangeText={setPurpose}
          multiline
          numberOfLines={2}
          style={styles.multilineInput}
        />

        <Input
          label="Notes (optional)"
          placeholder="Anything else to remember"
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          style={styles.multilineInput}
        />

        <View style={styles.saveContainer}>
          <Button
            title="Create Appointment"
            onPress={handleSave}
            loading={createAppointment.isPending}
            disabled={!title.trim() || !activeProfileId}
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  flex: { flex: 1 },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: { paddingVertical: 4, paddingRight: 16 },
  backText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  navTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  navSpacer: { width: 60 },
  scrollView: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  fieldGroup: { marginBottom: 20 },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  typeChipActive: {
    backgroundColor: COLORS.primary.DEFAULT + '15',
    borderColor: COLORS.primary.DEFAULT,
  },
  typeIcon: { fontSize: 16, marginRight: 6 },
  typeChipText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  typeChipTextActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  chipActive: {
    backgroundColor: COLORS.primary.DEFAULT + '15',
    borderColor: COLORS.primary.DEFAULT,
  },
  chipText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  chipTextActive: { color: COLORS.primary.DEFAULT },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  errorText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.error.DEFAULT,
    marginTop: 4,
  },
  saveContainer: { marginTop: 16 },
  successContainer: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 80,
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 56,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.bold,
    marginBottom: 16,
  },
  successTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
    textAlign: 'center',
  },
  successBody: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  successHint: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    textAlign: 'center',
    marginBottom: 32,
  },
  successActions: {
    width: '100%',
  },
});
