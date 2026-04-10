import {
  ActivityIndicator,
  Alert,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  useAppointmentDetail,
  useGenerateVisitPacket,
} from '@/hooks/useAppointments';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_ICONS,
  APPOINTMENT_TYPE_LABELS,
  getPrepStatus,
} from '@/lib/types/appointments';
import type {
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

function formatFullDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AppointmentDetailScreen() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const { data: appointment, isLoading, error } = useAppointmentDetail(
    appointmentId ?? null,
  );
  const generatePacket = useGenerateVisitPacket();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !appointment) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Couldn’t load this appointment.</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={styles.backText}>{'\u2039'} Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const prep = appointment.prep_json;
  const hasPrep = !!prep;

  const handlePrepare = () => {
    router.push(`/(main)/appointments/${appointmentId}/plan`);
  };

  const handleShare = async () => {
    if (!prep) return;
    let content = prep.packet_content;
    if (!content) {
      const result = await new Promise<string | null>((resolve) => {
        generatePacket.mutate(
          { appointmentId: appointment.id, profileId: appointment.profile_id },
          {
            onSuccess: (data) => resolve(data.packet),
            onError: () => resolve(null),
          },
        );
      });
      if (!result) {
        Alert.alert('Couldn’t prepare the packet', 'Please try again.');
        return;
      }
      content = result;
    }
    try {
      await Share.share({
        message: content,
        title: `Visit Prep — ${appointment.title}`,
      });
    } catch {
      // user cancelled
    }
  };

  const visibleQuestions = prep
    ? prep.questions.filter((q) => !q.dismissed)
    : [];
  const questionCount = visibleQuestions.length;
  const prepStatus = getPrepStatus(prep);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'\u2039'} Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>
          Appointment
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.headerIcon}>
              {APPOINTMENT_TYPE_ICONS[appointment.appointment_type]}
            </Text>
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
          <Text style={styles.title}>{appointment.title}</Text>
          <Text style={styles.dateTime}>
            {formatFullDateTime(appointment.start_time)}
          </Text>
          <Text style={styles.typeLabel}>
            {APPOINTMENT_TYPE_LABELS[appointment.appointment_type]}
          </Text>
          <View
            style={[
              styles.prepStatusBadge,
              { backgroundColor: PREP_STATUS_COLORS[prepStatus] + '1A' },
            ]}
          >
            <Text
              style={[
                styles.prepStatusBadgeText,
                { color: PREP_STATUS_COLORS[prepStatus] },
              ]}
            >
              {PREP_STATUS_LABELS[prepStatus]}
            </Text>
          </View>
        </View>

        {(appointment.provider_name ||
          appointment.facility_name ||
          appointment.location_text ||
          appointment.purpose ||
          appointment.notes) && (
          <Card style={styles.detailsCard}>
            {appointment.provider_name && (
              <DetailRow label="Provider" value={appointment.provider_name} />
            )}
            {appointment.facility_name && (
              <DetailRow label="Facility" value={appointment.facility_name} />
            )}
            {appointment.location_text && (
              <DetailRow label="Location" value={appointment.location_text} />
            )}
            {appointment.purpose && (
              <DetailRow label="Purpose" value={appointment.purpose} />
            )}
            {appointment.notes && <DetailRow label="Notes" value={appointment.notes} />}
          </Card>
        )}

        {/* Visit Prep card */}
        <Text style={styles.sectionLabel}>Visit Prep</Text>
        {hasPrep && prep ? (
          <Card style={styles.prepCard}>
            <TouchableOpacity onPress={handlePrepare} activeOpacity={0.7}>
              <Text style={styles.prepCardTitle}>
                {prepStatus === 'ready' ? 'Visit Prep ready' : 'Visit Prep — draft'}
              </Text>
              <View style={styles.prepStatRow}>
                <PrepStat
                  label="Questions"
                  value={`${questionCount}`}
                  ready={questionCount > 0}
                />
                <PrepStat
                  label="Logistics"
                  value={prep.logistics.driver ? 'Set' : 'Open'}
                  ready={!!prep.logistics.driver}
                />
                <PrepStat
                  label="Packet"
                  value={prep.packet_generated ? 'Ready' : 'Pending'}
                  ready={prep.packet_generated}
                />
              </View>
              <Text style={styles.prepCardLink}>Open prep {'\u203A'}</Text>
            </TouchableOpacity>
            <View style={styles.prepActionsRow}>
              <Button
                title="Share Visit Prep"
                variant="outline"
                onPress={handleShare}
                loading={generatePacket.isPending}
              />
            </View>
          </Card>
        ) : (
          <Card style={styles.prepCard}>
            <Text style={styles.prepCardTitle}>Prepare for Visit</Text>
            <Text style={styles.prepCardBody}>
              Tell CareLead what matters to you — your questions, concerns, and
              logistics. We&rsquo;ll structure it into a shareable visit packet.
            </Text>
            <View style={{ marginTop: 12 }}>
              <Button title="Prepare for Visit" onPress={handlePrepare} />
            </View>
          </Card>
        )}

        {appointment.status !== 'cancelled' && (
          <View style={styles.actionSection}>
            <Button
              title="Start Closeout"
              variant="outline"
              onPress={() => {
                // Closeout flow lands in Part B
              }}
              disabled
            />
            <Text style={styles.comingSoonText}>Available after the visit</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function PrepStat({
  label,
  value,
  ready,
}: {
  label: string;
  value: string;
  ready: boolean;
}) {
  return (
    <View style={styles.prepStat}>
      <Text
        style={[
          styles.prepStatValue,
          { color: ready ? COLORS.success.DEFAULT : COLORS.text.DEFAULT },
        ]}
      >
        {value}
      </Text>
      <Text style={styles.prepStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: FONT_SIZES.base, color: COLORS.error.DEFAULT },
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
    flex: 1,
    textAlign: 'center',
  },
  navSpacer: { width: 60 },
  scrollView: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  header: { marginBottom: 20 },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerIcon: { fontSize: 40 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 6,
  },
  dateTime: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    marginBottom: 4,
  },
  typeLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
  },
  prepStatusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 10,
  },
  prepStatusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailsCard: { marginBottom: 20 },
  detailRow: { marginBottom: 10 },
  detailLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  prepCard: { marginBottom: 20 },
  prepCardTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  prepCardBody: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 6,
    lineHeight: 20,
  },
  prepCardLink: {
    marginTop: 10,
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  prepStatRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 16,
  },
  prepStat: { alignItems: 'flex-start' },
  prepStatValue: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
  },
  prepStatLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  prepActionsRow: {
    marginTop: 14,
  },
  actionSection: { marginBottom: 24 },
  comingSoonText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textAlign: 'center',
    marginTop: 8,
  },
});
