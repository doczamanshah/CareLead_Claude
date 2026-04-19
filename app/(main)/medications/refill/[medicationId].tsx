import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Share,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RefillChangeSheet } from '@/components/RefillChangeSheet';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useMedicationDetail } from '@/hooks/useMedications';
import { useCreateTask } from '@/hooks/useTasks';
import {
  useMarkRefilled,
  useRecordRefillChangeCheck,
  shouldPromptChangeCheck,
} from '@/hooks/useMedicationRefillCheck';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function RefillScreen() {
  const { medicationId } = useLocalSearchParams<{ medicationId: string }>();
  const router = useRouter();
  const { activeProfile } = useActiveProfile();
  const { data: med, isLoading } = useMedicationDetail(medicationId ?? null);
  const createTask = useCreateTask();
  const markRefilled = useMarkRefilled();
  const recordChangeCheck = useRecordRefillChangeCheck();

  // Sheet visibility — opened after the user marks a refill picked up,
  // gated by the 30-day cooldown so weekly-refill meds aren't re-prompted.
  const [changeSheetVisible, setChangeSheetVisible] = useState(false);
  const [showRefillSavedToast, setShowRefillSavedToast] = useState(false);

  if (isLoading || !med) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const supply = med.supply;
  const patientName = activeProfile?.display_name ?? 'the patient';
  const dob = activeProfile?.date_of_birth
    ? new Date(activeProfile.date_of_birth).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : '[date of birth]';

  const pharmacyScript = buildPharmacyScript(med.drug_name, med.strength, patientName, dob, supply);
  const prescriberScript = buildPrescriberScript(
    med.drug_name,
    med.strength,
    med.sig?.dose_text ?? null,
    med.sig?.frequency_text ?? null,
    patientName,
    dob,
    supply,
  );

  // Refill status summary
  let statusLine = 'No refill info available';
  if (supply?.last_fill_date && supply?.days_supply) {
    const fillDate = new Date(supply.last_fill_date);
    const runOut = new Date(fillDate);
    runOut.setDate(runOut.getDate() + supply.days_supply);
    const daysLeft = Math.ceil((runOut.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) {
      statusLine = `Ran out ${Math.abs(daysLeft)} days ago`;
    } else {
      statusLine = `${daysLeft} days of supply remaining`;
    }
  }

  const handleCreateTasks = () => {
    if (!med.profile_id) return;

    const tasks: Promise<unknown>[] = [];

    // Pharmacy call task
    if (supply?.pharmacy_name || supply?.pharmacy_phone) {
      tasks.push(
        createTask.mutateAsync({
          profile_id: med.profile_id,
          title: `Call pharmacy for ${med.drug_name} refill`,
          description: `Call to refill ${med.drug_name}${med.strength ? ` ${med.strength}` : ''}.`,
          priority: 'high',
          due_date: addDays(1),
          source_type: 'medication',
          source_ref: med.id,
          trigger_type: 'manual',
          trigger_source: `Refill: ${med.drug_name}`,
          context_json: {
            call_script: pharmacyScript,
            contact_info: supply?.pharmacy_phone
              ? {
                  name: supply.pharmacy_name ?? 'Pharmacy',
                  phone: supply.pharmacy_phone,
                  role: 'Pharmacy',
                }
              : undefined,
          },
        }),
      );
    }

    // Prescriber call task (if no refills remaining or unknown)
    if (supply?.refills_remaining === 0 || !supply?.refills_remaining) {
      if (supply?.prescriber_name || supply?.prescriber_phone) {
        tasks.push(
          createTask.mutateAsync({
            profile_id: med.profile_id,
            title: `Call prescriber for ${med.drug_name} renewal`,
            description: `Request prescription renewal for ${med.drug_name} from ${supply?.prescriber_name ?? 'prescriber'}.`,
            priority: 'high',
            due_date: addDays(1),
            source_type: 'medication',
            source_ref: med.id,
            trigger_type: 'manual',
            trigger_source: `Renewal: ${med.drug_name}`,
            context_json: {
              call_script: prescriberScript,
              contact_info: supply?.prescriber_phone
                ? {
                    name: supply.prescriber_name ?? 'Prescriber',
                    phone: supply.prescriber_phone,
                    role: 'Prescriber',
                  }
                : undefined,
            },
          }),
        );
      }
    }

    Promise.all(tasks).then(() => {
      router.back();
    });
  };

  const handleMarkRefilled = async () => {
    if (!med) return;
    try {
      await markRefilled.mutateAsync({
        medicationId: med.id,
        profileId: med.profile_id,
      });
      // Brief visual ack, then open the change-detection sheet (or skip if
      // we're inside the cooldown window).
      setShowRefillSavedToast(true);
      setTimeout(() => setShowRefillSavedToast(false), 2000);
      if (shouldPromptChangeCheck(med.id)) {
        setChangeSheetVisible(true);
      }
    } catch {
      // Mutation surfaces its own error state via isError; nothing to do here.
    }
  };

  const handleShare = async () => {
    const shareText = [
      `Refill Request: ${med.drug_name}${med.strength ? ` ${med.strength}` : ''}`,
      '',
      `Patient: ${patientName}`,
      `DOB: ${dob}`,
      '',
      supply?.pharmacy_name ? `Pharmacy: ${supply.pharmacy_name}` : null,
      supply?.pharmacy_phone ? `Phone: ${supply.pharmacy_phone}` : null,
      supply?.refills_remaining != null ? `Refills remaining: ${supply.refills_remaining}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    await Share.share({ message: shareText });
  };

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
          <Text style={styles.title}>Refill</Text>
          <Text style={styles.subtitle}>
            {med.drug_name}{med.strength ? ` ${med.strength}` : ''}
          </Text>
        </View>

        {/* Status */}
        <View style={styles.section}>
          <Card>
            <Text style={styles.statusLine}>{statusLine}</Text>
            {supply?.refills_remaining != null && (
              <Text style={styles.refillsLine}>
                {supply.refills_remaining} refill{supply.refills_remaining !== 1 ? 's' : ''} remaining
              </Text>
            )}
          </Card>
        </View>

        {/* Pharmacy */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pharmacy</Text>
          <Card>
            {supply?.pharmacy_name ? (
              <>
                <Text style={styles.contactName}>{supply.pharmacy_name}</Text>
                {supply.pharmacy_phone && (
                  <Text style={styles.contactPhone}>{supply.pharmacy_phone}</Text>
                )}
              </>
            ) : (
              <Text style={styles.noDataText}>No pharmacy on file</Text>
            )}
          </Card>
        </View>

        {/* Pharmacy Call Script */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pharmacy Call Script</Text>
          <Card style={styles.scriptCard}>
            <Text style={styles.scriptText}>{pharmacyScript}</Text>
          </Card>
        </View>

        {/* Prescriber */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prescriber</Text>
          <Card>
            {supply?.prescriber_name ? (
              <>
                <Text style={styles.contactName}>{supply.prescriber_name}</Text>
                {supply.prescriber_phone && (
                  <Text style={styles.contactPhone}>{supply.prescriber_phone}</Text>
                )}
              </>
            ) : (
              <Text style={styles.noDataText}>No prescriber on file</Text>
            )}
          </Card>
        </View>

        {/* Prescriber Call Script */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prescriber Call Script</Text>
          <Card style={styles.scriptCard}>
            <Text style={styles.scriptText}>{prescriberScript}</Text>
          </Card>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            title="I picked up the refill"
            onPress={handleMarkRefilled}
            loading={markRefilled.isPending}
            size="lg"
          />
          {showRefillSavedToast && (
            <View style={styles.savedToast}>
              <Text style={styles.savedToastText}>Refill recorded ✓</Text>
            </View>
          )}
          <View style={styles.actionSpacer} />
          <Button
            title="Create Refill Tasks"
            variant="outline"
            onPress={handleCreateTasks}
            loading={createTask.isPending}
            size="lg"
          />
          <View style={styles.actionSpacer} />
          <Button
            title="Share Refill Info"
            variant="outline"
            onPress={handleShare}
            size="lg"
          />
        </View>
      </ScrollView>

      {med && (
        <RefillChangeSheet
          visible={changeSheetVisible}
          medicationName={med.drug_name}
          currentDoseText={med.sig?.dose_text ?? null}
          currentFrequencyText={med.sig?.frequency_text ?? null}
          currentPharmacyName={med.supply?.pharmacy_name ?? null}
          busy={recordChangeCheck.isPending}
          onSubmit={async (changeType, details) => {
            try {
              await recordChangeCheck.mutateAsync({
                medicationId: med.id,
                profileId: med.profile_id,
                changeType,
                details,
              });
              setChangeSheetVisible(false);
            } catch {
              // Mutation surfaces error; keep sheet open for user to retry.
            }
          }}
          onDismiss={() => setChangeSheetVisible(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ── Script Builders ─────────────────────────────────────────────────────────

function buildPharmacyScript(
  drugName: string,
  strength: string | null,
  patientName: string,
  dob: string,
  supply: { pharmacy_name?: string | null; refills_remaining?: number | null } | null,
): string {
  const lines = [
    `Hi, I'd like to refill ${drugName}${strength ? ` ${strength}` : ''}.`,
    `My name is ${patientName}, date of birth ${dob}.`,
  ];

  if (supply?.refills_remaining != null) {
    lines.push(`I have ${supply.refills_remaining} refill${supply.refills_remaining !== 1 ? 's' : ''} remaining.`);
  }

  return lines.join(' ');
}

function buildPrescriberScript(
  drugName: string,
  strength: string | null,
  dose: string | null,
  frequency: string | null,
  patientName: string,
  dob: string,
  supply: { pharmacy_name?: string | null; pharmacy_phone?: string | null } | null,
): string {
  const medDesc = [drugName, strength, dose, frequency].filter(Boolean).join(' ');
  const lines = [
    `Hi, I'm calling for ${patientName}, DOB ${dob}, to request a prescription renewal for ${medDesc}.`,
  ];

  if (supply?.pharmacy_name) {
    lines.push(
      `The pharmacy is ${supply.pharmacy_name}${supply.pharmacy_phone ? ` at ${supply.pharmacy_phone}` : ''}.`,
    );
  }

  return lines.join(' ');
}

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(17, 0, 0, 0);
  return date.toISOString();
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
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
  backButton: { marginBottom: 8 },
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
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    marginTop: 4,
  },
  section: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  statusLine: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  refillsLine: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
  },
  contactName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  contactPhone: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    marginTop: 4,
  },
  noDataText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
  },
  scriptCard: {
    backgroundColor: COLORS.surface.muted,
  },
  scriptText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
    fontStyle: 'italic',
  },
  actions: {
    paddingHorizontal: 24,
    marginTop: 32,
  },
  actionSpacer: { height: 12 },
  savedToast: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  savedToastText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
