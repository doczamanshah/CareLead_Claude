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
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useBatchCaptureStore } from '@/stores/batchCaptureStore';
import type {
  DocumentClassification,
  PhotoProcessingResult,
} from '@/stores/batchCaptureStore';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

interface GroupItem {
  tempId: string;
  summary: string;
  targetRoute?: string;
}

function groupFor(type: DocumentClassification): string {
  switch (type) {
    case 'medication_label':
      return 'Medications';
    case 'insurance_card':
      return 'Insurance';
    case 'lab_result':
      return 'Lab Results';
    case 'bill':
    case 'eob':
      return 'Bills';
    case 'discharge_summary':
    case 'prescription':
    case 'other':
    default:
      return 'Other Documents';
  }
}

function routeFor(r: PhotoProcessingResult): string | undefined {
  if (r.intentSheetId) return `/(main)/intent-sheet/${r.intentSheetId}`;
  if (r.resultId) return `/(main)/results/${r.resultId}`;
  if (r.medicationId) return `/(main)/medications/${r.medicationId}`;
  if (r.billingCaseId) return `/(main)/billing/${r.billingCaseId}`;
  return undefined;
}

export default function CatchUpSummaryScreen() {
  const router = useRouter();
  const photos = useBatchCaptureStore((s) => s.photos);
  const processingResults = useBatchCaptureStore((s) => s.processingResults);
  const clear = useBatchCaptureStore((s) => s.clear);

  const { groups, totalUpdates } = useMemo(() => {
    const out: Record<string, GroupItem[]> = {};
    let updates = 0;
    for (const r of processingResults) {
      if (r.status !== 'completed') continue;
      const photo = photos.find((p) => p.tempId === r.tempId);
      if (!photo) continue;
      const group = groupFor(photo.type);
      if (!out[group]) out[group] = [];
      out[group].push({
        tempId: r.tempId,
        summary: r.summary ?? 'Processed',
        targetRoute: routeFor(r),
      });
      updates++;
    }
    return { groups: out, totalUpdates: updates };
  }, [processingResults, photos]);

  const failed = processingResults.filter((r) => r.status === 'failed');
  const completed = processingResults.filter((r) => r.status === 'completed');
  const needsReview = processingResults.filter(
    (r) => r.status === 'completed' && !!r.intentSheetId,
  );

  function handleHome() {
    clear();
    router.replace('/(main)/(tabs)');
  }

  function handleCaptureMore() {
    clear();
    router.replace('/(main)/capture/catch-up');
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroIconWrap}>
          <Ionicons
            name="checkmark-circle"
            size={56}
            color={COLORS.success.DEFAULT}
          />
        </View>
        <Text style={styles.title}>All done!</Text>
        <Text style={styles.subtitle}>
          {completed.length} document{completed.length === 1 ? '' : 's'} processed,{' '}
          {totalUpdates} profile update{totalUpdates === 1 ? '' : 's'} found
          {failed.length > 0 ? ` — ${failed.length} failed` : ''}
        </Text>

        {Object.entries(groups).map(([label, items]) => (
          <Card key={label} style={styles.groupCard}>
            <Text style={styles.groupTitle}>{label}</Text>
            {items.map((item, idx) => (
              <TouchableOpacity
                key={item.tempId}
                style={[
                  styles.groupItem,
                  idx < items.length - 1 && styles.groupItemBorder,
                ]}
                onPress={() =>
                  item.targetRoute &&
                  router.push(item.targetRoute as never)
                }
                activeOpacity={item.targetRoute ? 0.7 : 1}
                disabled={!item.targetRoute}
              >
                <Text style={styles.groupItemText} numberOfLines={2}>
                  {item.summary}
                </Text>
                {item.targetRoute && (
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={COLORS.text.tertiary}
                  />
                )}
              </TouchableOpacity>
            ))}
          </Card>
        ))}

        {failed.length > 0 && (
          <Card style={{ ...styles.groupCard, ...styles.failureCard }}>
            <View style={styles.failureHeaderRow}>
              <Ionicons
                name="alert-circle"
                size={18}
                color={COLORS.error.DEFAULT}
              />
              <Text style={styles.failureTitle}>
                {failed.length} item{failed.length === 1 ? '' : 's'} failed
              </Text>
            </View>
            {failed.map((f) => (
              <Text key={f.tempId} style={styles.failureDetail}>
                • {f.error ?? 'Unknown error'}
              </Text>
            ))}
          </Card>
        )}

        {needsReview.length > 0 && (
          <View style={styles.reviewBanner}>
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={COLORS.accent.dark}
            />
            <Text style={styles.reviewText}>
              {needsReview.length} item{needsReview.length === 1 ? '' : 's'} need your review — tap the cards above to confirm the extracted data.
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <Button title="Go to Home" onPress={handleHome} size="lg" />
          <View style={{ height: 10 }} />
          <Button
            title="Capture More"
            variant="outline"
            onPress={handleCaptureMore}
            size="lg"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  content: { padding: 24, paddingBottom: 32, alignItems: 'stretch' },
  heroIconWrap: {
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 22,
  },
  groupCard: {
    marginBottom: 12,
    padding: 0,
  },
  groupTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  groupItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  groupItemText: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  failureCard: {
    borderWidth: 1,
    borderColor: COLORS.error.light,
    backgroundColor: COLORS.error.light,
    padding: 16,
  },
  failureHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  failureTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.error.DEFAULT,
  },
  failureDetail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error.DEFAULT,
    marginTop: 4,
    lineHeight: 20,
  },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.accent.DEFAULT + '22',
    marginBottom: 16,
  },
  reviewText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  actions: { marginTop: 16 },
});
