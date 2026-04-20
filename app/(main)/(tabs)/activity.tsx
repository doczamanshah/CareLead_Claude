import { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TabHeader } from '@/components/ui/TabHeader';
import { TasksContent } from '@/components/modules/TasksContent';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAppointments } from '@/hooks/useAppointments';
import { COLORS } from '@/lib/constants/colors';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/lib/constants/design';
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

type Segment = 'tasks' | 'appointments';

const PREP_STATUS_LABELS: Record<VisitPrepStatus, string> = {
  not_started: 'Prep: Not started',
  draft: 'Prep: Draft',
  ready: 'Prep: Ready ✓',
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
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

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

function AppointmentCard({
  appointment,
  onPress,
}: {
  appointment: Appointment;
  onPress: () => void;
}) {
  const prepStatus = getPrepStatus(appointment.prep_json);
  const prepColor = PREP_STATUS_COLORS[prepStatus];
  return (
    <Card onPress={onPress} style={styles.appointmentCard}>
      <View style={styles.cardHeader}>
        <Text style={styles.icon}>
          {APPOINTMENT_TYPE_ICONS[appointment.appointment_type]}
        </Text>
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
            .join(' • ')}
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
          <Text
            style={[
              styles.statusBadgeText,
              { color: STATUS_COLORS[appointment.status] },
            ]}
          >
            {APPOINTMENT_STATUS_LABELS[appointment.status]}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function AppointmentsSegment() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const { data: appointments, isLoading, error } =
    useAppointments(activeProfileId);
  const [pastExpanded, setPastExpanded] = useState(false);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const all = appointments ?? [];
    const upcomingList: Appointment[] = [];
    const pastList: Appointment[] = [];

    for (const a of all) {
      if (
        a.status === 'cancelled' ||
        a.status === 'rescheduled' ||
        a.status === 'completed'
      ) {
        pastList.push(a);
      } else if (new Date(a.start_time).getTime() >= now) {
        upcomingList.push(a);
      } else {
        pastList.push(a);
      }
    }

    upcomingList.sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
    pastList.sort(
      (a, b) =>
        new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
    );

    return { upcoming: upcomingList, past: pastList };
  }, [appointments]);

  const recentPast = past.slice(0, 5);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.appointmentsContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.newApptRow}>
        <Button
          title="New Appointment"
          onPress={() => router.push('/(main)/appointments/create')}
        />
      </View>

      {isLoading && (
        <Text style={styles.loadingText}>Loading appointments...</Text>
      )}

      {error && (
        <Text style={styles.errorText}>
          Couldn't load appointments. Please try again.
        </Text>
      )}

      {!isLoading && !error && upcoming.length === 0 && past.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons
            name="calendar-outline"
            size={48}
            color={COLORS.text.tertiary}
          />
          <Text style={styles.emptyTitle}>No appointments yet</Text>
          <Text style={styles.emptyBody}>
            Add your first appointment to start preparing for visits with
            confidence.
          </Text>
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

      {recentPast.length > 0 && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.collapseHeader}
            activeOpacity={0.7}
            onPress={() => setPastExpanded((v) => !v)}
          >
            <Text style={styles.sectionLabel}>Recent visits</Text>
            <Ionicons
              name={pastExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={COLORS.text.tertiary}
            />
          </TouchableOpacity>
          {pastExpanded &&
            recentPast.map((a) => (
              <AppointmentCard
                key={a.id}
                appointment={a}
                onPress={() => router.push(`/(main)/appointments/${a.id}`)}
              />
            ))}
        </View>
      )}
    </ScrollView>
  );
}

export default function ActivityScreen() {
  const [segment, setSegment] = useState<Segment>('tasks');

  const todayLabel = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TabHeader title="Activity" />

      <View style={styles.dateRow}>
        <Text style={styles.dateText}>{todayLabel}</Text>
      </View>

      <View style={styles.segmentRow}>
        {(['tasks', 'appointments'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            style={[
              styles.segmentButton,
              segment === s && styles.segmentButtonActive,
            ]}
            onPress={() => setSegment(s)}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.segmentText,
                segment === s && styles.segmentTextActive,
              ]}
            >
              {s === 'tasks' ? 'Tasks' : 'Appointments'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.body}>
        {segment === 'tasks' ? <TasksContent /> : <AppointmentsSegment />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  dateRow: {
    paddingHorizontal: SPACING.xxl,
    paddingTop: SPACING.md,
  },
  dateText: {
    ...TYPOGRAPHY.h3,
    color: COLORS.text.DEFAULT,
  },
  segmentRow: {
    flexDirection: 'row',
    marginHorizontal: SPACING.xxl,
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
    padding: SPACING.xs,
    backgroundColor: COLORS.background.subtle,
    borderRadius: RADIUS.full,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  segmentText: {
    ...TYPOGRAPHY.buttonSmall,
    color: COLORS.text.secondary,
  },
  segmentTextActive: {
    color: COLORS.text.inverse,
  },
  body: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  appointmentsContent: {
    paddingHorizontal: SPACING.xxl,
    paddingTop: SPACING.lg,
    paddingBottom: 100,
  },
  newApptRow: {
    marginBottom: SPACING.xl,
  },
  loadingText: {
    ...TYPOGRAPHY.body,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginTop: SPACING.xxl,
  },
  errorText: {
    ...TYPOGRAPHY.body,
    color: COLORS.status.error,
    textAlign: 'center',
    marginTop: SPACING.xxl,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: SPACING.xxl,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.text.DEFAULT,
    marginTop: SPACING.md,
    marginBottom: SPACING.xs + 2,
  },
  emptyBody: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },
  section: {
    marginBottom: SPACING.xxl,
  },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    color: COLORS.text.secondary,
    marginBottom: SPACING.md,
  },
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  appointmentCard: {
    marginBottom: SPACING.sm + 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  icon: {
    fontSize: 28,
    marginRight: SPACING.md,
  },
  cardHeaderText: {
    flex: 1,
  },
  appointmentTitle: {
    ...TYPOGRAPHY.h4,
    color: COLORS.text.DEFAULT,
  },
  appointmentDate: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  prepStatusText: {
    ...TYPOGRAPHY.label,
    fontSize: 10,
    marginTop: SPACING.xs,
    letterSpacing: 0.4,
  },
  providerText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.text.secondary,
    marginBottom: SPACING.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  typeBadge: {
    backgroundColor: COLORS.background.subtle,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm - 2,
  },
  typeBadgeText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '500',
    color: COLORS.text.secondary,
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm - 2,
  },
  statusBadgeText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
});
