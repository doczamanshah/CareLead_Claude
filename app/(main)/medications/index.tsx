import { useState } from 'react';
import {
  Alert,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { SkipReasonSheet } from '@/components/SkipReasonSheet';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import {
  useMedications,
  useTodaysDoses,
  useRefillStatus,
  useLogAdherence,
} from '@/hooks/useMedications';
import {
  useLogSkipReason,
  useStopMedication,
} from '@/hooks/useMedicationRefillCheck';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { MedicationWithDetails, TodaysDose, RefillInfo, RefillStatus } from '@/lib/types/medications';

const REFILL_STATUS_COLORS: Record<RefillStatus, string> = {
  ok: COLORS.success.DEFAULT,
  due_soon: COLORS.accent.dark,
  overdue: COLORS.error.DEFAULT,
  needs_info: COLORS.text.tertiary,
};

const REFILL_STATUS_LABELS: Record<RefillStatus, string> = {
  ok: 'OK',
  due_soon: 'Due Soon',
  overdue: 'Overdue',
  needs_info: 'Needs Info',
};

export default function MedicationsScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const { data: medications, isLoading } = useMedications(activeProfileId);
  const { data: todaysDoses } = useTodaysDoses(activeProfileId);
  const { data: refills } = useRefillStatus(activeProfileId);
  const logAdherence = useLogAdherence();
  const logSkipReason = useLogSkipReason();
  const stopMedication = useStopMedication();
  const [showInactive, setShowInactive] = useState(false);
  // Skip target survives the skip mutation so the optional reason sheet can
  // appear without blocking the skip action itself.
  const [skipTarget, setSkipTarget] = useState<{
    medicationId: string;
    profileId: string;
    medicationName: string;
  } | null>(null);

  const activeMeds = (medications ?? []).filter((m) => m.status === 'active');
  const inactiveMeds = (medications ?? []).filter((m) => m.status !== 'active');

  const scheduledDoses = (todaysDoses ?? []).filter((d) => !d.medication.prn_flag);
  const prnDoses = (todaysDoses ?? []).filter((d) => d.medication.prn_flag);
  const takenCount = scheduledDoses.filter((d) => d.adherenceToday === 'taken').length;

  const refillAlerts = (refills ?? []).filter((r) => r.status !== 'ok');

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading medications...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Medications</Text>
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/(main)/ask', params: { domain: 'medications' } })}
              style={styles.askButton}
              activeOpacity={0.7}
              accessibilityLabel="Ask CareLead about medications"
            >
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={18}
                color={COLORS.primary.DEFAULT}
              />
              <Text style={styles.askButtonText}>Ask</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Today's Medications */}
        {scheduledDoses.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Today's Medications</Text>
              <Text style={styles.progressText}>
                {takenCount} of {scheduledDoses.length} taken
              </Text>
            </View>
            {scheduledDoses.map((dose) => (
              <DoseCard
                key={`${dose.medication.id}-${dose.scheduledTime ?? 'any'}`}
                dose={dose}
                onTaken={() => {
                  logAdherence.mutate({
                    medicationId: dose.medication.id,
                    eventType: 'taken',
                    profileId: dose.medication.profile_id,
                    scheduledTime: dose.scheduledTime ?? undefined,
                  });
                }}
                onSkipped={() => {
                  logAdherence.mutate({
                    medicationId: dose.medication.id,
                    eventType: 'skipped',
                    profileId: dose.medication.profile_id,
                    scheduledTime: dose.scheduledTime ?? undefined,
                  });
                  setSkipTarget({
                    medicationId: dose.medication.id,
                    profileId: dose.medication.profile_id,
                    medicationName: dose.medication.drug_name,
                  });
                }}
                onPress={() => router.push(`/(main)/medications/${dose.medication.id}`)}
              />
            ))}

            {prnDoses.length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>As Needed</Text>
                {prnDoses.map((dose) => (
                  <DoseCard
                    key={dose.medication.id}
                    dose={dose}
                    onTaken={() => {
                      logAdherence.mutate({
                        medicationId: dose.medication.id,
                        eventType: 'taken',
                        profileId: dose.medication.profile_id,
                      });
                    }}
                    onPress={() => router.push(`/(main)/medications/${dose.medication.id}`)}
                  />
                ))}
              </>
            )}
          </View>
        )}

        {/* Active Medications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Medications</Text>
          {activeMeds.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>No medications added yet</Text>
              <Text style={styles.emptySubtext}>
                Add your first medication to start tracking
              </Text>
            </Card>
          ) : (
            activeMeds.map((med) => (
              <MedCard
                key={med.id}
                medication={med}
                onPress={() => router.push(`/(main)/medications/${med.id}`)}
              />
            ))
          )}

          {inactiveMeds.length > 0 && (
            <>
              <TouchableOpacity
                onPress={() => setShowInactive(!showInactive)}
                style={styles.toggleRow}
              >
                <Text style={styles.toggleText}>
                  {showInactive ? 'Hide' : 'Show'} paused/stopped ({inactiveMeds.length})
                </Text>
              </TouchableOpacity>
              {showInactive &&
                inactiveMeds.map((med) => (
                  <MedCard
                    key={med.id}
                    medication={med}
                    onPress={() => router.push(`/(main)/medications/${med.id}`)}
                  />
                ))}
            </>
          )}
        </View>

        {/* Refills */}
        {(refills ?? []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Refills</Text>
            {(refills ?? []).map((refill) => (
              <RefillCard
                key={refill.medicationId}
                refill={refill}
                onPress={() => router.push(`/(main)/medications/refill/${refill.medicationId}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(main)/medications/create')}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <SkipReasonSheet
        visible={!!skipTarget}
        medicationName={skipTarget?.medicationName ?? ''}
        busy={logSkipReason.isPending || stopMedication.isPending}
        onSubmit={(reason, freeformNote) => {
          if (!skipTarget) return;
          logSkipReason.mutate({
            medicationId: skipTarget.medicationId,
            reason,
            freeformNote,
          });
          setSkipTarget(null);
        }}
        onDismiss={() => setSkipTarget(null)}
        onSuggestRefill={() => {
          if (!skipTarget) return;
          router.push(`/(main)/medications/refill/${skipTarget.medicationId}`);
        }}
        onSuggestStop={() => {
          if (!skipTarget) return;
          const target = skipTarget;
          Alert.alert(
            `Stop ${target.medicationName}?`,
            'Mark this medication as stopped per your doctor.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Stop medication',
                style: 'destructive',
                onPress: () => {
                  stopMedication.mutate({
                    medicationId: target.medicationId,
                    profileId: target.profileId,
                    reason: 'Doctor told me to stop',
                  });
                },
              },
            ],
          );
        }}
      />
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function DoseCard({
  dose,
  onTaken,
  onSkipped,
  onPress,
}: {
  dose: TodaysDose;
  onTaken: () => void;
  onSkipped?: () => void;
  onPress: () => void;
}) {
  const taken = dose.adherenceToday === 'taken';
  const skipped = dose.adherenceToday === 'skipped';
  const logged = taken || skipped;

  return (
    <Card style={logged ? { ...styles.doseCard, ...styles.doseCardDone } : styles.doseCard} onPress={onPress}>
      <View style={styles.doseRow}>
        <View style={styles.doseInfo}>
          <Text style={[styles.doseName, logged && styles.doseNameDone]}>
            {dose.medication.drug_name}
            {dose.medication.strength ? ` ${dose.medication.strength}` : ''}
          </Text>
          <Text style={styles.doseDetail}>
            {dose.medication.sig?.dose_text ?? ''}
            {dose.scheduledTime ? ` at ${dose.scheduledTime}` : ''}
          </Text>
        </View>
        <View style={styles.doseActions}>
          {logged ? (
            <View style={[styles.statusBadge, taken ? styles.takenBadge : styles.skippedBadge]}>
              <Text style={styles.statusBadgeText}>{taken ? 'Taken' : 'Skipped'}</Text>
            </View>
          ) : (
            <>
              <TouchableOpacity style={styles.takenButton} onPress={onTaken}>
                <Text style={styles.takenButtonText}>Taken</Text>
              </TouchableOpacity>
              {onSkipped && (
                <TouchableOpacity style={styles.skipButton} onPress={onSkipped}>
                  <Text style={styles.skipButtonText}>Skip</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>
    </Card>
  );
}

function MedCard({
  medication,
  onPress,
}: {
  medication: MedicationWithDetails;
  onPress: () => void;
}) {
  const statusColors: Record<string, string> = {
    active: COLORS.success.DEFAULT,
    paused: COLORS.accent.dark,
    stopped: COLORS.text.tertiary,
  };

  return (
    <Card style={styles.medCard} onPress={onPress}>
      <View style={styles.medCardRow}>
        <View style={styles.medCardInfo}>
          <Text style={styles.medCardName}>
            {medication.drug_name}
            {medication.strength ? ` ${medication.strength}` : ''}
          </Text>
          <Text style={styles.medCardDetail}>
            {[
              medication.sig?.dose_text,
              medication.sig?.frequency_text,
              medication.prn_flag ? 'as needed' : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'No directions set'}
          </Text>
        </View>
        {medication.status !== 'active' && (
          <View style={[styles.statusPill, { backgroundColor: statusColors[medication.status] + '20' }]}>
            <Text style={[styles.statusPillText, { color: statusColors[medication.status] }]}>
              {medication.status}
            </Text>
          </View>
        )}
      </View>
    </Card>
  );
}

function RefillCard({
  refill,
  onPress,
}: {
  refill: RefillInfo;
  onPress: () => void;
}) {
  const color = REFILL_STATUS_COLORS[refill.status];

  return (
    <Card style={styles.refillCard} onPress={onPress}>
      <View style={styles.refillRow}>
        <View style={styles.refillInfo}>
          <Text style={styles.refillName}>
            {refill.drugName}
            {refill.strength ? ` ${refill.strength}` : ''}
          </Text>
          <Text style={styles.refillDetail}>
            {refill.daysRemaining != null
              ? refill.daysRemaining < 0
                ? `${Math.abs(refill.daysRemaining)} days overdue`
                : `${refill.daysRemaining} days remaining`
              : 'No refill info'}
            {refill.refillsRemaining != null ? ` · ${refill.refillsRemaining} refills left` : ''}
          </Text>
        </View>
        <View style={[styles.refillBadge, { backgroundColor: color + '20' }]}>
          <Text style={[styles.refillBadgeText, { color }]}>
            {REFILL_STATUS_LABELS[refill.status]}
          </Text>
        </View>
      </View>
    </Card>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backButton: {
    marginBottom: 8,
  },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  askButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  askButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  section: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
  },
  subsectionTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    marginTop: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginTop: 4,
  },
  toggleRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // Dose card
  doseCard: { marginBottom: 8 },
  doseCardDone: { opacity: 0.6 },
  doseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  doseInfo: { flex: 1, marginRight: 12 },
  doseName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  doseNameDone: { textDecorationLine: 'line-through' },
  doseDetail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  doseActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  takenButton: {
    backgroundColor: COLORS.success.DEFAULT,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  takenButtonText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  skipButton: {
    backgroundColor: COLORS.surface.muted,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  skipButtonText: {
    color: COLORS.text.secondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  takenBadge: { backgroundColor: COLORS.success.DEFAULT + '20' },
  skippedBadge: { backgroundColor: COLORS.text.tertiary + '20' },
  statusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Med card
  medCard: { marginBottom: 8 },
  medCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  medCardInfo: { flex: 1, marginRight: 12 },
  medCardName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  medCardDetail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusPillText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'capitalize',
  },

  // Refill card
  refillCard: { marginBottom: 8 },
  refillRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refillInfo: { flex: 1, marginRight: 12 },
  refillName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  refillDetail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  refillBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  refillBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 32,
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
  fabText: {
    fontSize: FONT_SIZES['2xl'],
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.bold,
    marginTop: -2,
  },
});
