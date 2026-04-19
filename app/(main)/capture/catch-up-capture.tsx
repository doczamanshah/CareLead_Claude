import { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
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

const KNOWN_TYPES: DocumentClassification[] = [
  'insurance_card',
  'lab_result',
  'medication_label',
  'bill',
  'eob',
  'discharge_summary',
  'prescription',
  'other',
];

function defaultTypeFromCategories(cats: string[]): DocumentClassification {
  if (cats.length === 1) {
    const c = cats[0];
    if (KNOWN_TYPES.includes(c as DocumentClassification)) {
      return c as DocumentClassification;
    }
    return 'other';
  }
  return 'other';
}

function genTempId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function CatchUpCaptureScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const photos = useBatchCaptureStore((s) => s.photos);
  const initialCategories = useBatchCaptureStore((s) => s.initialCategories);
  const addPhoto = useBatchCaptureStore((s) => s.addPhoto);
  const [lastUri, setLastUri] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const defaultType = defaultTypeFromCategories(initialCategories);

  async function handleCapture() {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        imageType: 'jpg',
      });
      if (photo?.uri) {
        addPhoto({ tempId: genTempId(), uri: photo.uri, type: defaultType });
        setLastUri(photo.uri);
      }
    } catch {
      Alert.alert('Error', 'Could not capture photo. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  }

  async function handleFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });
    if (result.canceled || !result.assets?.length) return;

    let addedUri: string | null = null;
    for (const asset of result.assets) {
      const mime = asset.mimeType ?? 'image/jpeg';
      if (mime === 'image/heic' || mime === 'image/heif') {
        Alert.alert(
          'Unsupported Format',
          'HEIC/HEIF images are not supported. Please use JPEG or PNG.',
        );
        continue;
      }
      addPhoto({ tempId: genTempId(), uri: asset.uri, type: defaultType });
      addedUri = asset.uri;
    }
    if (addedUri) setLastUri(addedUri);
  }

  function handleDone() {
    if (photos.length === 0) {
      Alert.alert('No photos yet', 'Take at least one photo, or tap the close button to cancel.');
      return;
    }
    router.replace('/(main)/capture/catch-up-review');
  }

  if (!permission) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionDesc}>
          CareLead needs camera access to photograph your health documents.
        </Text>
        <Button title="Grant Camera Access" onPress={requestPermission} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        <SafeAreaView edges={['top']} style={styles.topBar}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.topButton}
            hitSlop={8}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.countPill}>
            <Ionicons name="images" size={14} color="#fff" />
            <Text style={styles.countText}>
              {photos.length} photo{photos.length === 1 ? '' : 's'} taken
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </SafeAreaView>

        <View style={styles.hintRow}>
          <Text style={styles.hint}>
            Keep snapping — tap Done when finished
          </Text>
        </View>

        <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
          <View style={styles.bottomRow}>
            <TouchableOpacity
              style={styles.bottomSideButton}
              onPress={handleFromLibrary}
              activeOpacity={0.7}
            >
              <View style={styles.sideButtonIcon}>
                <Ionicons name="images-outline" size={22} color="#fff" />
              </View>
              <Text style={styles.bottomSideLabel}>Library</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.captureButton, isCapturing && { opacity: 0.6 }]}
              onPress={handleCapture}
              activeOpacity={0.7}
              disabled={isCapturing}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bottomSideButton}
              onPress={handleDone}
              activeOpacity={0.7}
            >
              {lastUri ? (
                <Image source={{ uri: lastUri }} style={styles.thumbnail} />
              ) : (
                <View style={styles.thumbnailPlaceholder}>
                  <Ionicons name="checkmark" size={22} color="#fff" />
                </View>
              )}
              <Text style={styles.bottomSideLabel}>Done</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  topButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 16,
  },
  countText: {
    color: '#fff',
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  hintRow: {
    position: 'absolute',
    top: 76,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: {
    color: '#fff',
    fontSize: FONT_SIZES.sm,
    opacity: 0.85,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 16,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 24,
  },
  bottomSideButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
  },
  sideButtonIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomSideLabel: {
    color: '#fff',
    fontSize: FONT_SIZES.xs,
    marginTop: 4,
    fontWeight: FONT_WEIGHTS.medium,
  },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  thumbnailPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.success.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
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
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: COLORS.background.DEFAULT,
  },
  permissionTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
  },
  permissionDesc: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
});
