import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useBatchCaptureStore } from '@/stores/batchCaptureStore';
import type { DocumentClassification, PhotoProcessingStatus } from '@/stores/batchCaptureStore';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAuth } from '@/hooks/useAuth';
import { processBatchDocuments } from '@/services/batchCapture';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const CLASSIFICATION_LABELS: Record<DocumentClassification, string> = {
  medication_label: 'Medication',
  insurance_card: 'Insurance card',
  lab_result: 'Lab result',
  bill: 'Bill',
  eob: 'EOB',
  discharge_summary: 'Discharge summary',
  prescription: 'Prescription',
  other: 'Document',
};

function statusText(status: PhotoProcessingStatus): string {
  switch (status) {
    case 'pending':
      return 'Waiting…';
    case 'uploading':
      return 'Uploading…';
    case 'extracting':
      return 'Reading document…';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
  }
}

export default function CatchUpProcessingScreen() {
  const router = useRouter();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const { user } = useAuth();
  const photos = useBatchCaptureStore((s) => s.photos);
  const processingResults = useBatchCaptureStore((s) => s.processingResults);
  const updateProcessingResult = useBatchCaptureStore(
    (s) => s.updateProcessingResult,
  );

  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!activeProfileId || !activeProfile || !user) return;
    if (photos.length === 0) {
      router.replace('/(main)/(tabs)');
      return;
    }
    startedRef.current = true;

    (async () => {
      try {
        await processBatchDocuments(
          photos,
          {
            profileId: activeProfileId,
            householdId: activeProfile.household_id,
            userId: user.id,
          },
          (update) => {
            updateProcessingResult(update);
          },
        );
      } catch (e) {
        console.error('[catch-up] batch processing error', e);
      } finally {
        router.replace('/(main)/capture/catch-up-summary');
      }
    })();
  }, [
    activeProfile,
    activeProfileId,
    user,
    photos,
    updateProcessingResult,
    router,
  ]);

  const total = processingResults.length;
  const doneCount = processingResults.filter(
    (r) => r.status === 'completed' || r.status === 'failed',
  ).length;
  const progressPct = total > 0 ? (doneCount / total) * 100 : 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Processing your documents…</Text>
        <Text style={styles.counter}>
          {doneCount} of {total} processed
        </Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {processingResults.map((r) => {
          const photo = photos.find((p) => p.tempId === r.tempId);
          const typeLabel = photo ? CLASSIFICATION_LABELS[photo.type] : 'Document';
          return (
            <View key={r.tempId} style={styles.row}>
              <View style={styles.iconWrap}>
                {r.status === 'pending' || r.status === 'uploading' ? (
                  <ActivityIndicator size="small" color={COLORS.primary.DEFAULT} />
                ) : r.status === 'extracting' ? (
                  <ActivityIndicator size="small" color={COLORS.accent.dark} />
                ) : r.status === 'completed' ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={COLORS.success.DEFAULT}
                  />
                ) : (
                  <Ionicons
                    name="close-circle"
                    size={22}
                    color={COLORS.error.DEFAULT}
                  />
                )}
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{typeLabel}</Text>
                <Text
                  style={[
                    styles.rowStatus,
                    r.status === 'failed' && { color: COLORS.error.DEFAULT },
                    r.status === 'completed' && { color: COLORS.success.DEFAULT },
                  ]}
                >
                  {statusText(r.status)}
                  {r.summary ? ` — ${r.summary}` : ''}
                  {r.error ? ` — ${r.error}` : ''}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  counter: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 6,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.border.light,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary.DEFAULT,
    borderRadius: 3,
  },
  listContent: { paddingHorizontal: 24, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  iconWrap: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowBody: { flex: 1 },
  rowTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  rowStatus: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
});
