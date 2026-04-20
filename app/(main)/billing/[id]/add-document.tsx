import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useUploadBillingDocument, useTriggerDocumentExtraction } from '@/hooks/useBilling';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { sanitizeErrorMessage } from '@/lib/utils/sanitizeError';
import type { BillingDocType } from '@/lib/types/billing';
import { BILLING_DOC_TYPE_LABELS } from '@/lib/types/billing';

const DOC_TYPES: BillingDocType[] = ['bill', 'eob', 'itemized_bill', 'denial', 'other'];

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
}

type CaptureMode = 'camera' | null;

export default function AddBillingDocumentScreen() {
  const router = useRouter();
  const { id: caseId } = useLocalSearchParams<{ id: string }>();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const uploadMutation = useUploadBillingDocument();
  const triggerExtraction = useTriggerDocumentExtraction();

  const [docType, setDocType] = useState<BillingDocType>('bill');
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useState<CameraView | null>(null);

  async function handleTakePhoto() {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera Access Required', 'Please grant camera access to take photos.');
        return;
      }
    }
    setCaptureMode('camera');
  }

  async function handleCapture(ref: CameraView | null) {
    if (!ref) return;
    const photo = await ref.takePictureAsync({
      quality: 0.8,
      imageType: 'jpg',
    });
    if (photo?.uri) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      setPickedFile({
        uri: photo.uri,
        name: `billing-photo-${timestamp}.jpg`,
        mimeType: 'image/jpeg',
      });
      setCaptureMode(null);
    }
  }

  async function handleChooseFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    const mime = asset.mimeType ?? 'image/jpeg';

    if (mime === 'image/heic' || mime === 'image/heif') {
      Alert.alert('Unsupported Format', 'HEIC/HEIF images are not supported. Please use JPEG or PNG.');
      return;
    }

    const fileName = asset.fileName ?? `billing-image-${Date.now()}.jpg`;

    setPickedFile({
      uri: asset.uri,
      name: fileName,
      mimeType: mime,
    });
  }

  async function handleUploadPdf() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ALLOWED_MIME_TYPES,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const mime = asset.mimeType ?? 'application/octet-stream';

      if (mime === 'image/heic' || mime === 'image/heif') {
        Alert.alert('Unsupported Format', 'HEIC/HEIF images are not supported. Please convert to JPEG or PNG.');
        return;
      }

      setPickedFile({
        uri: asset.uri,
        name: asset.name,
        mimeType: mime,
      });
    } catch {
      Alert.alert('Error', 'Could not open the document picker.');
    }
  }

  async function handleUpload() {
    if (!pickedFile || !caseId || !activeProfileId || !activeProfile) return;

    uploadMutation.mutate(
      {
        caseId,
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
        docType,
        fileUri: pickedFile.uri,
        fileName: pickedFile.name,
        mimeType: pickedFile.mimeType,
      },
      {
        onSuccess: (doc) => {
          // Auto-trigger extraction after successful upload
          triggerExtraction.mutate({
            documentId: doc.id,
            caseId: caseId!,
            profileId: activeProfileId!,
            householdId: activeProfile!.household_id,
          });
          router.back();
        },
        onError: (err) => {
          Alert.alert('Upload Error', sanitizeErrorMessage(err, { fallback: 'Failed to upload document.' }));
        },
      },
    );
  }

  // Camera capture mode
  if (captureMode === 'camera') {
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          ref={(ref) => { cameraRef[1](ref); }}
          style={styles.camera}
          facing="back"
        >
          <SafeAreaView edges={['top']} style={styles.cameraTopBar}>
            <TouchableOpacity
              onPress={() => setCaptureMode(null)}
              style={styles.cameraCancel}
            >
              <Text style={styles.cameraCancelText}>Cancel</Text>
            </TouchableOpacity>
          </SafeAreaView>
          <SafeAreaView edges={['bottom']} style={styles.captureBar}>
            <TouchableOpacity
              style={styles.captureButton}
              onPress={() => handleCapture(cameraRef[0])}
              activeOpacity={0.7}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
          </SafeAreaView>
        </CameraView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={18} color={COLORS.primary.DEFAULT} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Add Document</Text>
      </View>

      <View style={styles.content}>
        {/* Doc Type Picker */}
        <Text style={styles.fieldLabel}>Document Type</Text>
        <View style={styles.chipRow}>
          {DOC_TYPES.map((dt) => (
            <TouchableOpacity
              key={dt}
              style={[styles.chip, docType === dt && styles.chipSelected]}
              onPress={() => setDocType(dt)}
            >
              <Text style={[styles.chipText, docType === dt && styles.chipTextSelected]}>
                {BILLING_DOC_TYPE_LABELS[dt]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* File Selection */}
        {!pickedFile ? (
          <>
            <Text style={[styles.fieldLabel, { marginTop: 24 }]}>Upload From</Text>
            <View style={styles.sourceGrid}>
              <SourceCard
                icon="camera-outline"
                label="Take Photo"
                onPress={handleTakePhoto}
              />
              <SourceCard
                icon="images-outline"
                label="Photo Library"
                onPress={handleChooseFromLibrary}
              />
              <SourceCard
                icon="document-outline"
                label="Upload PDF"
                onPress={handleUploadPdf}
              />
            </View>
          </>
        ) : (
          <>
            {/* File Preview */}
            <View style={styles.previewSection}>
              <Text style={[styles.fieldLabel, { marginTop: 24 }]}>Selected File</Text>
              <Card>
                <View style={styles.previewRow}>
                  {pickedFile.mimeType.startsWith('image/') ? (
                    <Image
                      source={{ uri: pickedFile.uri }}
                      style={styles.previewImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.pdfIcon}>
                      <Ionicons name="document" size={32} color={COLORS.error.DEFAULT} />
                    </View>
                  )}
                  <View style={styles.previewInfo}>
                    <Text style={styles.previewName} numberOfLines={2}>
                      {pickedFile.name}
                    </Text>
                    <Text style={styles.previewMime}>
                      {pickedFile.mimeType === 'application/pdf' ? 'PDF' : 'Image'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setPickedFile(null)}
                    style={styles.previewRemove}
                  >
                    <Ionicons name="close-circle" size={22} color={COLORS.text.tertiary} />
                  </TouchableOpacity>
                </View>
              </Card>
            </View>

            {/* Upload Button */}
            <View style={styles.uploadButtonContainer}>
              <Button
                title="Upload Document"
                onPress={handleUpload}
                loading={uploadMutation.isPending}
                size="lg"
              />
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function SourceCard({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.sourceCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.sourceIconContainer}>
        <Ionicons name={icon} size={28} color={COLORS.primary.DEFAULT} />
      </View>
      <Text style={styles.sourceLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backButton: {
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
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  chipSelected: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
  },
  chipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  chipTextSelected: {
    color: COLORS.text.inverse,
  },

  // Source cards
  sourceGrid: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  sourceCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 20,
    borderRadius: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sourceIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  sourceLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },

  // Preview
  previewSection: {},
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
    marginRight: 12,
  },
  pdfIcon: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: COLORS.error.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  previewInfo: {
    flex: 1,
  },
  previewName: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  previewMime: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  previewRemove: {
    padding: 4,
  },
  uploadButtonContainer: {
    marginTop: 24,
  },

  // Camera
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  cameraTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  cameraCancel: {
    paddingVertical: 8,
  },
  cameraCancelText: {
    fontSize: FONT_SIZES.base,
    color: '#fff',
    fontWeight: FONT_WEIGHTS.medium,
  },
  captureBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 24,
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
  },
});
