import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateAppointment } from '@/hooks/useAppointments';
import { useDispatchLifeEventTriggers } from '@/hooks/useLifeEventTriggers';
import { useProfileDetail } from '@/hooks/useProfileDetail';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPE_ICONS,
} from '@/lib/types/appointments';
import type {
  AppointmentContext,
  AppointmentType,
  ExtractedAppointment,
} from '@/lib/types/appointments';

const TYPES: AppointmentType[] = [
  'doctor',
  'labs',
  'imaging',
  'procedure',
  'therapy',
  'other',
];

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

const TRANSPORT_OPTIONS = [
  'Driving myself',
  'Someone driving me',
  'Rideshare',
  'Public transit',
  'Other',
] as const;

function mapExtractedType(
  t: ExtractedAppointment['appointment_type'],
): AppointmentType {
  if (t === 'doctor_visit') return 'doctor';
  if (t === 'labs') return 'labs';
  if (t === 'imaging') return 'imaging';
  if (t === 'procedure') return 'procedure';
  if (t === 'therapy') return 'therapy';
  return 'doctor';
}

function parseDateAndTime(
  dateStr: string | null,
  timeStr: string | null,
): { date: Date | null; time: Date | null } {
  let date: Date | null = null;
  let time: Date | null = null;

  if (dateStr) {
    const parsed = new Date(`${dateStr}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  if (timeStr) {
    const [hh, mm] = timeStr.split(':').map((n) => parseInt(n, 10));
    if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
      const t = new Date();
      t.setHours(hh, mm, 0, 0);
      time = t;
    }
  }

  return { date, time };
}

export default function ReviewAppointmentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    extracted?: string;
    freeform?: string;
  }>();
  const { activeProfileId, activeProfile } = useActiveProfile();
  const { data: profileDetail } = useProfileDetail(activeProfileId);
  const dispatchLifeEvent = useDispatchLifeEventTriggers();
  const createAppointment = useCreateAppointment();

  const extracted: ExtractedAppointment | null = useMemo(() => {
    if (!params.extracted) return null;
    try {
      return JSON.parse(params.extracted) as ExtractedAppointment;
    } catch {
      return null;
    }
  }, [params.extracted]);

  const freeform = typeof params.freeform === 'string' ? params.freeform : '';

  const [title, setTitle] = useState(extracted?.title ?? '');
  const [type, setType] = useState<AppointmentType>(
    extracted?.appointment_type
      ? mapExtractedType(extracted.appointment_type)
      : 'doctor',
  );
  const [provider, setProvider] = useState(extracted?.provider_name ?? '');
  const [facility, setFacility] = useState(extracted?.facility_name ?? '');
  const [location, setLocation] = useState(extracted?.location_address ?? '');

  const initialDT = parseDateAndTime(
    extracted?.date ?? null,
    extracted?.time ?? null,
  );
  const [pickerDate, setPickerDate] = useState<Date | null>(initialDT.date);
  const [pickerTime, setPickerTime] = useState<Date | null>(initialDT.time);
  const [timeIdx, setTimeIdx] = useState<number | null>(null);

  const [reason, setReason] = useState(extracted?.reason_for_visit ?? '');
  const [concerns, setConcerns] = useState<string>(
    (extracted?.concerns_to_discuss ?? []).join('\n'),
  );
  const [companion, setCompanion] = useState(extracted?.companion ?? '');
  const [transportation, setTransportation] = useState(
    extracted?.transportation ?? '',
  );
  const [specialNeeds, setSpecialNeeds] = useState<string>(() => {
    const items = [
      ...(extracted?.special_needs ?? []),
      extracted?.prep_notes ?? '',
    ].filter((v) => v.trim().length > 0);
    return items.join('\n');
  });
  const [showOriginal, setShowOriginal] = useState(false);

  const [titleError, setTitleError] = useState('');
  const [dateError, setDateError] = useState('');

  useEffect(() => {
    if (!extracted) return;
    if (extracted.title && !title) setTitle(extracted.title);
  }, [extracted, title]);

  const careTeamMatch = useMemo(() => {
    if (!provider.trim() || !profileDetail?.facts) return null;
    const q = provider.trim().toLowerCase();
    for (const f of profileDetail.facts) {
      if (f.category !== 'care_team') continue;
      const v = (f.value_json ?? {}) as Record<string, unknown>;
      const name =
        typeof v.name === 'string'
          ? v.name
          : typeof v.provider === 'string'
            ? v.provider
            : null;
      if (name && name.toLowerCase().includes(q)) {
        return {
          name,
          specialty: typeof v.specialty === 'string' ? v.specialty : null,
          address: typeof v.address === 'string' ? v.address : null,
        };
      }
      if (name && q.includes(name.toLowerCase()) && name.length > 3) {
        return {
          name,
          specialty: typeof v.specialty === 'string' ? v.specialty : null,
          address: typeof v.address === 'string' ? v.address : null,
        };
      }
    }
    return null;
  }, [provider, profileDetail?.facts]);

  const fastingHint =
    type === 'labs' &&
    !specialNeeds.toLowerCase().includes('fast')
      ? 'Fasting may be required — check with your provider.'
      : null;

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
    } else if (pickerDate && timeIdx !== null) {
      const t = TIME_OPTIONS[timeIdx];
      const merged = new Date(pickerDate);
      merged.setHours(t.hour, t.minute, 0, 0);
      startTime = merged.toISOString();
    }

    if (!startTime) {
      setDateError('Pick a date and time');
      return;
    }

    const concernsList = concerns
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const specialList = specialNeeds
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const context: AppointmentContext | undefined = (() => {
      const ctx: AppointmentContext = {};
      if (reason.trim()) ctx.reason_for_visit = reason.trim();
      if (concernsList.length > 0) ctx.concerns_to_discuss = concernsList;
      if (companion.trim()) ctx.companion = companion.trim();
      if (transportation.trim()) ctx.transportation = transportation.trim();
      if (specialList.length > 0) ctx.special_needs = specialList;
      if (freeform.trim()) ctx.freeform_input = freeform.trim();
      return Object.keys(ctx).length > 0 ? ctx : undefined;
    })();

    createAppointment.mutate(
      {
        profile_id: activeProfileId,
        title: title.trim(),
        appointment_type: type,
        provider_name: provider.trim() || undefined,
        facility_name: facility.trim() || undefined,
        location_text: location.trim() || undefined,
        purpose: reason.trim() || undefined,
        notes: undefined,
        start_time: startTime,
        context_json: context,
      },
      {
        onSuccess: (appointment) => {
          if (activeProfile?.household_id) {
            void dispatchLifeEvent(
              'appointment_created',
              {
                appointmentId: appointment.id,
                providerName: appointment.provider_name,
                facilityName: appointment.facility_name,
              },
              activeProfileId,
              activeProfile.household_id,
            );
          }
          router.replace(`/(main)/appointments/${appointment.id}`);
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.navBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons
            name="chevron-back"
            size={18}
            color={COLORS.primary.DEFAULT}
          />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Review</Text>
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
          <Text style={styles.heading}>Review your appointment</Text>
          <Text style={styles.sub}>
            We pulled these details from what you said. Edit anything that's
            not right.
          </Text>

          <Input
            label="Title"
            placeholder="e.g., Cardiology follow-up"
            value={title}
            onChangeText={(t) => {
              setTitle(t);
              if (titleError) setTitleError('');
            }}
            error={titleError}
          />

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.typeGrid}>
              {TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, type === t && styles.typeChipActive]}
                  onPress={() => setType(t)}
                >
                  <Text style={styles.typeIcon}>
                    {APPOINTMENT_TYPE_ICONS[t]}
                  </Text>
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
          {careTeamMatch ? (
            <TouchableOpacity
              style={styles.matchChip}
              activeOpacity={0.7}
              onPress={() => {
                if (careTeamMatch.address && !facility.trim()) {
                  setFacility(careTeamMatch.address.split(',')[0].trim());
                }
                if (careTeamMatch.address && !location.trim()) {
                  setLocation(careTeamMatch.address);
                }
              }}
            >
              <Ionicons
                name="checkmark-circle"
                size={14}
                color={COLORS.success.DEFAULT}
              />
              <Text style={styles.matchChipText}>
                In your care team{careTeamMatch.specialty ? ` · ${careTeamMatch.specialty}` : ''}
                {careTeamMatch.address ? ' — tap to auto-fill location' : ''}
              </Text>
            </TouchableOpacity>
          ) : null}

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

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Date</Text>
            {extracted?.date_description && !extracted.date ? (
              <Text style={styles.hintText}>
                You said "{extracted.date_description}" — please pick the exact
                date.
              </Text>
            ) : null}
            <DatePicker
              placeholder="Pick a date"
              value={pickerDate}
              onChange={(date) => {
                setPickerDate(date);
                setDateError('');
              }}
              mode="date"
              minimumDate={new Date(new Date().setHours(0, 0, 0, 0))}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Time</Text>
            <View style={styles.chipRow}>
              {TIME_OPTIONS.map((opt, idx) => (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.chip, timeIdx === idx && styles.chipActive]}
                  onPress={() => {
                    setTimeIdx(timeIdx === idx ? null : idx);
                    if (timeIdx !== idx) {
                      const d = new Date();
                      d.setHours(opt.hour, opt.minute, 0, 0);
                      setPickerTime(d);
                    }
                    setDateError('');
                  }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      timeIdx === idx && styles.chipTextActive,
                    ]}
                  >
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
            label="What is this visit for?"
            placeholder="Blood pressure check, follow-up on surgery, annual physical..."
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={2}
            style={styles.multilineInput}
          />

          <Input
            label="What do you want to discuss?"
            placeholder="Any questions or topics you want to bring up (one per line)..."
            value={concerns}
            onChangeText={setConcerns}
            multiline
            numberOfLines={3}
            style={styles.multilineInput}
          />

          <Input
            label="Companion (optional)"
            placeholder="e.g., My daughter Sarah"
            value={companion}
            onChangeText={setCompanion}
          />

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Transportation (optional)</Text>
            <View style={styles.chipRow}>
              {TRANSPORT_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[
                    styles.chip,
                    transportation === opt && styles.chipActive,
                  ]}
                  onPress={() =>
                    setTransportation(transportation === opt ? '' : opt)
                  }
                >
                  <Text
                    style={[
                      styles.chipText,
                      transportation === opt && styles.chipTextActive,
                    ]}
                  >
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {!TRANSPORT_OPTIONS.includes(
              transportation as (typeof TRANSPORT_OPTIONS)[number],
            ) && transportation.trim() ? (
              <Input
                placeholder="Describe how you're getting there"
                value={transportation}
                onChangeText={setTransportation}
              />
            ) : null}
          </View>

          <Input
            label="Anything to prepare? (optional)"
            placeholder="Fasting, interpreter, wheelchair, documents to bring... (one per line)"
            value={specialNeeds}
            onChangeText={setSpecialNeeds}
            multiline
            numberOfLines={3}
            style={styles.multilineInput}
          />
          {fastingHint ? (
            <Text style={styles.hintText}>{fastingHint}</Text>
          ) : null}

          {freeform ? (
            <View style={styles.originalBlock}>
              <TouchableOpacity
                onPress={() => setShowOriginal(!showOriginal)}
                style={styles.originalToggle}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={showOriginal ? 'chevron-down' : 'chevron-forward'}
                  size={14}
                  color={COLORS.text.tertiary}
                />
                <Text style={styles.originalToggleText}>
                  Your original description
                </Text>
              </TouchableOpacity>
              {showOriginal ? (
                <Text style={styles.originalText}>{freeform}</Text>
              ) : null}
            </View>
          ) : null}

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
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 16,
  },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    marginLeft: 2,
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
    paddingTop: 8,
    paddingBottom: 40,
  },
  heading: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  sub: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 20,
    lineHeight: 20,
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
  matchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.success.light,
    alignSelf: 'flex-start',
    marginTop: -8,
    marginBottom: 16,
  },
  matchChipText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  hintText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 4,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  errorText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.error.DEFAULT,
    marginTop: 4,
  },
  originalBlock: {
    marginTop: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surface.muted,
  },
  originalToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  originalToggleText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  originalText: {
    marginTop: 10,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  saveContainer: { marginTop: 16 },
});
