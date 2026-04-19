import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import {
  useUploadHealthSummary,
  useDetectImportDuplicates,
} from '@/hooks/useHealthSummaryImport';
import { useHealthSummaryImportStore } from '@/stores/healthSummaryImportStore';
import { defaultSelection } from '@/services/healthSummaryImport';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const STAGES = [
  { key: 'uploading', label: 'Uploading your health summary...' },
  { key: 'reading', label: 'Reading every section of the document...' },
  { key: 'matching', label: 'Checking against your existing profile...' },
] as const;

type Stage = (typeof STAGES)[number]['key'] | 'done' | 'error';

export default function ImportProcessingScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const store = useHealthSummaryImportStore();
  const uploadMutation = useUploadHealthSummary();
  const detectMutation = useDetectImportDuplicates();

  const params = useLocalSearchParams<{
    fileUri: string;
    fileName: string;
    mimeType: string;
    fileSize: string;
    sourceChannel: 'upload' | 'camera';
  }>();

  const [stage, setStage] = useState<Stage>('uploading');
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    if (!activeProfileId || !params.fileUri) return;
    ranRef.current = true;
    store.clear();

    (async () => {
      try {
        setStage('uploading');
        const uploadRes = await uploadMutation.mutateAsync({
          profileId: activeProfileId,
          fileName: params.fileName ?? 'health-summary',
          fileUri: params.fileUri,
          mimeType: params.mimeType ?? 'application/octet-stream',
          fileSize: Number(params.fileSize ?? '0') || 0,
          sourceChannel: params.sourceChannel ?? 'upload',
        });

        setStage('reading');
        store.setArtifact(uploadRes.artifactId, params.fileName ?? 'health-summary');
        store.setExtraction(uploadRes.extraction);

        setStage('matching');
        const duplicates = await detectMutation.mutateAsync({
          profileId: activeProfileId,
          extraction: uploadRes.extraction,
        });
        store.setDuplicates(duplicates);
        store.setSelection(defaultSelection(uploadRes.extraction, duplicates));

        setStage('done');
        router.replace('/(main)/capture/import-review' as never);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Extraction failed';
        setStage('error');
        setError(msg);
      }
    })();
  }, [activeProfileId, params.fileUri]);

  if (stage === 'error') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.error.DEFAULT} />
          <Text style={styles.errorTitle}>Couldn't read the health summary</Text>
          <Text style={styles.errorDesc}>{error}</Text>
          <Button title="Try again" onPress={() => router.back()} />
          <View style={{ height: 12 }} />
          <Button title="Back to Home" variant="outline" onPress={() => router.replace('/(main)/(tabs)')} />
        </View>
      </SafeAreaView>
    );
  }

  const currentStageIdx = Math.max(
    0,
    STAGES.findIndex((s) => s.key === stage),
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        <Text style={styles.title}>Building your profile...</Text>
        <Text style={styles.subtitle}>
          This can take a moment for large documents. Don't close the app.
        </Text>

        <View style={styles.stages}>
          {STAGES.map((s, idx) => {
            const done = idx < currentStageIdx;
            const active = idx === currentStageIdx;
            return (
              <View key={s.key} style={styles.stageRow}>
                <Ionicons
                  name={done ? 'checkmark-circle' : active ? 'ellipse' : 'ellipse-outline'}
                  size={18}
                  color={
                    done
                      ? COLORS.success.DEFAULT
                      : active
                      ? COLORS.primary.DEFAULT
                      : COLORS.border.dark
                  }
                />
                <Text
                  style={[
                    styles.stageText,
                    active && styles.stageTextActive,
                    done && styles.stageTextDone,
                  ]}
                >
                  {s.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  stages: {
    alignSelf: 'stretch',
    marginTop: 16,
    gap: 10,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stageText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
  },
  stageTextActive: {
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  stageTextDone: {
    color: COLORS.text.secondary,
  },
  errorTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },
  errorDesc: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
});
