import { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAppointments } from '@/hooks/useAppointments';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPE_ICONS,
  APPOINTMENT_STATUS_LABELS,
  getPrepStatus,
} from '@/lib/types/appointments';
import type {
  Appointment,
  AppointmentStatus,
  VisitPrepStatus,
} from '@/lib/types/appointments';

const PREP_STATUS_LABELS: Record<VisitPrepStatus, string> = {
  not_started: 'Prep: Not started',
  draft: 'Prep: Draft',
  ready: 'Prep: Ready \u2713',
};

const PREP_STATUS_COLORS: Record<VisitPrepStatus, string> = {
  not_started: COLORS.text.tertiary,
  draft: COLORS.accent.dark,
  ready: COLORS.success.DEFAULT,
};

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  draft: COLORS.text.tertiary,
  scheduled: COLORS.primary.DEFAULT,
  preparing: COLORS.accent.dark,
  ready: COLORS.success.DEFAULT,
  completed: COLORS.text.tertiary,
  cancelled: COLORS.error.DEFAULT,
  rescheduled: COLORS.text.tertiary,
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Tomorrow, ${time}`;
  if (diffDays === -1) return `Yesterday, ${time}`;
  if (diffDays > 0 && diffDays <= 7) {
    return `${date.toLocaleDateString('en-US', { weekday: 'long' })}, ${time}`;
  }
  return `${date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })}, ${time}`;
}

interface AppointmentCardProps {
  appointment: Appointment;
  onPress: () => void;
}

function AppointmentCard({ appointment, onPress }: AppointmentCardProps) {
  const prepStatus = getPrepStatus(appointment.prep_json);
  const prepColor = PREP_STATUS_COLORS[prepStatus];
  return (
    <Card onPress={onPress} style={styles.appointmentCard}>
      <View style={styles.cardHeader}>
        <Text style={styles.icon}>{APPOINTMENT_TYPE_ICONS[appointment.appointment_type]}</Text>
        <View style={styles.cardHeaderText}>
          <Text style={styles.appointmentTitle} numberOfLines={1}>
            {appointment.title}
          </Text>
          <Text style={styles.appointmentDate}>
            {formatDateTime(appointment.start_time)}
          </Text>
          <Text style={[styles.prepStatusText, { color: prepColor }]}>
            {PREP_STATUS_LABELS[prepStatus]}
          </Text>
        </View>
      </View>

      {(appointment.provider_name || appointment.facility_name) && (
        <Text style={styles.providerText} numberOfLines={1}>
          {[appointment.provider_name, appointment.facility_name]
            .filter(Boolean)
            .join(' \u2022 ')}
        </Text>
      )}

      {appointment.purpose && (
        <Text style={styles.purposeText} numberOfLines={2}>
          {appointment.purpose}
        </Text>
      )}

      <View style={styles.badgeRow}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>
            {APPOINTMENT_TYPE_LABELS[appointment.appointment_type]}
          </Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: STATUS_COLORS[appointment.status] + '1A' },
          ]}
        >
          <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[appointment.status] }]}>
            {APPOINTMENT_STATUS_LABELS[appointment.status]}
          </Text>
        </View>
      </View>
    </Card>
  );
}

export default function AppointmentsListScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const { data: appointments, isLoading, error } = useAppointments(activeProfileId);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const all = appointments ?? [];
    const upcoming: Appointment[] = [];
    const past: Appointment[] = [];

    for (const a of all) {
      if (
        a.status === 'cancelled' ||
        a.status === 'rescheduled' ||
        a.status === 'completed'
      ) {
        past.push(a);
      } else if (new Date(a.start_time).getTime() >= now) {
        upcoming.push(a);
      } else {
        past.push(a);
      }
    }

    upcoming.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    past.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

    return { upcoming, past };
  }, [appointments]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'\u2039'} Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Appointments</Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {isLoading && (
          <Text style={styles.loadingText}>Loading appointments...</Text>
        )}

        {error && (
          <Text style={styles.errorText}>Couldn’t load appointments. Please try again.</Text>
        )}

        {!isLoading && !error && upcoming.length === 0 && past.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>{'\uD83D\uDCC5'}</Text>
            <Text style={styles.emptyTitle}>No appointments yet</Text>
            <Text style={styles.emptyBody}>
              Add your first appointment to start preparing for visits with confidence.
            </Text>
            <View style={styles.emptyButton}>
              <Button
                title="Add an Appointment"
                onPress={() => router.push('/(main)/appointments/create')}
              />
            </View>
          </View>
        )}

        {upcoming.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Upcoming</Text>
            {upcoming.map((a) => (
              <AppointmentCard
                key={a.id}
                appointment={a}
                onPress={() => router.push(`/(main)/appointments/${a.id}`)}
              />
            ))}
          </View>
        )}

        {past.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Past</Text>
            {past.map((a) => (
              <AppointmentCard
                key={a.id}
                appointment={a}
                onPress={() => router.push(`/(main)/appointments/${a.id}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {(upcoming.length > 0 || past.length > 0) && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/(main)/appointments/create')}
          activeOpacity={0.8}
        >
          <Text style={styles.fabPlus}>+</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 16,
  },
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
  navSpacer: {
    width: 60,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 100,
  },
  loadingText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginTop: 24,
  },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.error.DEFAULT,
    textAlign: 'center',
    marginTop: 24,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  emptyButton: {
    width: '100%',
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  appointmentCard: {
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  icon: {
    fontSize: 28,
    marginRight: 12,
  },
  cardHeaderText: {
    flex: 1,
  },
  appointmentTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  appointmentDate: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  prepStatusText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  providerText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 4,
  },
  purposeText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    marginBottom: 8,
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  typeBadge: {
    backgroundColor: COLORS.surface.muted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabPlus: {
    fontSize: 32,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.bold,
    lineHeight: 36,
  },
});
