import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import {
  useBatchCaptureStore,
  type DocumentClassification,
} from '@/stores/batchCaptureStore';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const TYPE_OPTIONS: { key: DocumentClassification; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'medication_label', label: 'Medication', icon: 'medical-outline' },
  { key: 'insurance_card', label: 'Insurance Card', icon: 'card-outline' },
  { key: 'lab_result', label: 'Lab Result', icon: 'flask-outline' },
  { key: 'bill', label: 'Bill', icon: 'wallet-outline' },
  { key: 'eob', label: 'EOB', icon: 'receipt-outline' },
  { key: 'discharge_summary', label: 'Discharge Summary', icon: 'document-text-outline' },
  { key: 'prescription', label: 'Prescription', icon: 'receipt-outline' },
  { key: 'other', label: 'Other', icon: 'documents-outline' },
];

function typeLabel(t: DocumentClassification): string {
  return TYPE_OPTIONS.find((o) => o.key === t)?.label ?? 'Other';
}

export default function CatchUpReviewScreen() {
  const router = useRouter();
  const photos = useBatchCaptureStore((s) => s.photos);
  const updatePhotoType = useBatchCaptureStore((s) => s.updatePhotoType);
  const removePhoto = useBatchCaptureStore((s) => s.removePhoto);
  const setProcessingResults = useBatchCaptureStore((s) => s.setProcessingResults);
  const [expandedUri, setExpandedUri] = useState<string | null>(null);
  const [typePickerFor, setTypePickerFor] = useState<string | null>(null);

  function handleProcess() {
    if (photos.length === 0) return;
    setProcessingResults(
      photos.map((p) => ({ tempId: p.tempId, status: 'pending' })),
    );
    router.replace('/(main)/capture/catch-up-processing');
  }

  function confirmRemove(tempId: string) {
    Alert.alert('Remove photo?', 'This photo will not be processed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removePhoto(tempId) },
    ]);
  }

  if (photos.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.empty}>
          <Ionicons name="camera-outline" size={56} color={COLORS.text.tertiary} />
          <Text style={styles.emptyTitle}>No photos yet</Text>
          <Text style={styles.emptySubtitle}>
            Go back and take some photos to review.
          </Text>
          <View style={{ height: 16 }} />
          <Button
            title="Capture Photos"
            onPress={() => router.replace('/(main)/capture/catch-up-capture')}
          />
        </View>
      </SafeAreaView>
    );
  }

  const picker = typePickerFor
    ? photos.find((p) => p.tempId === typePickerFor)
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backRow}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={18} color={COLORS.primary.DEFAULT} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Review your documents</Text>
        <Text style={styles.subtitle}>
          {photos.length} document{photos.length === 1 ? '' : 's'} captured
        </Text>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {photos.map((p) => (
          <View key={p.tempId} style={styles.row}>
            <TouchableOpacity
              onPress={() => setExpandedUri(p.uri)}
              activeOpacity={0.8}
            >
              <Image source={{ uri: p.uri }} style={styles.thumb} />
            </TouchableOpacity>
            <View style={styles.rowBody}>
              <TouchableOpacity
                style={styles.typeChip}
                onPress={() => setTypePickerFor(p.tempId)}
                activeOpacity={0.7}
              >
                <Text style={styles.typeChipText} numberOfLines={1}>
                  {typeLabel(p.type)}
                </Text>
                <Ionicons name="chevron-down" size={14} color={COLORS.primary.DEFAULT} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => confirmRemove(p.tempId)}
              style={styles.removeButton}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={22} color={COLORS.text.tertiary} />
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity
          style={styles.addMoreButton}
          onPress={() => router.replace('/(main)/capture/catch-up-capture')}
          activeOpacity={0.7}
        >
          <Ionicons name="add-circle-outline" size={20} color={COLORS.primary.DEFAULT} />
          <Text style={styles.addMoreText}>Add more</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={`Process All (${photos.length})`}
          onPress={handleProcess}
          size="lg"
        />
      </View>

      {/* Photo preview modal */}
      <Modal
        visible={!!expandedUri}
        transparent
        animationType="fade"
        onRequestClose={() => setExpandedUri(null)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            onPress={() => setExpandedUri(null)}
            activeOpacity={1}
          />
          {expandedUri && (
            <>
              <Image
                source={{ uri: expandedUri }}
                style={styles.modalImage}
                resizeMode="contain"
              />
              <TouchableOpacity
                style={styles.modalClose}
                onPress={() => setExpandedUri(null)}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={36} color="#fff" />
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>

      {/* Type picker sheet */}
      <Modal
        visible={!!picker}
        transparent
        animationType="slide"
        onRequestClose={() => setTypePickerFor(null)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          onPress={() => setTypePickerFor(null)}
          activeOpacity={1}
        />
        {picker && (
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Document type</Text>
            {TYPE_OPTIONS.map((opt) => {
              const isSelected = picker.type === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.sheetOption,
                    isSelected && styles.sheetOptionSelected,
                  ]}
                  onPress={() => {
                    updatePhotoType(picker.tempId, opt.key);
                    setTypePickerFor(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={opt.icon}
                    size={20}
                    color={isSelected ? COLORS.primary.DEFAULT : COLORS.text.secondary}
                  />
                  <Text
                    style={[
                      styles.sheetOptionText,
                      isSelected && styles.sheetOptionTextSelected,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {isSelected && (
                    <Ionicons
                      name="checkmark"
                      size={20}
                      color={COLORS.primary.DEFAULT}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  flex: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    alignSelf: 'flex-start',
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
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
  },
  listContent: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: COLORS.surface.muted,
    marginRight: 12,
  },
  rowBody: { flex: 1 },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '33',
  },
  typeChipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  removeButton: { padding: 8 },
  addMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '08',
  },
  addMoreText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginTop: 8,
  },

  // Preview modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalImage: { width: '100%', height: '80%' },
  modalClose: { position: 'absolute', top: 60, right: 24 },

  // Type-picker sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.surface.DEFAULT,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border.dark,
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
    marginBottom: 12,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 10,
  },
  sheetOptionSelected: { backgroundColor: COLORS.primary.DEFAULT + '0D' },
  sheetOptionText: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  sheetOptionTextSelected: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
