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
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useUploadArtifact } from '@/hooks/useArtifacts';
import { useTriggerExtraction } from '@/hooks/useIntentSheet';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function CameraScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const uploadMutation = useUploadArtifact();
  const extractionMutation = useTriggerExtraction();

  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  async function handleCapture() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({
      quality: 0.8,
      // Force JPEG output — Claude API does not support HEIC (iPhone default)
      imageType: 'jpg',
    });
    if (photo?.uri) {
      setPhotoUri(photo.uri);
    }
  }

  async function handleUsePhoto() {
    if (!photoUri || !activeProfileId) return;

    try {
      const fileInfo = await FileSystem.getInfoAsync(photoUri);
      const fileSize = fileInfo.exists ? (fileInfo.size ?? 0) : 0;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `photo-${timestamp}.jpg`;

      const artifact = await uploadMutation.mutateAsync({
        profileId: activeProfileId,
        fileName,
        fileUri: photoUri,
        mimeType: 'image/jpeg',
        artifactType: 'document',
        sourceChannel: 'camera',
        fileSizeBytes: fileSize,
      });

      // Trigger AI extraction — await to ensure the request fires before navigating
      try {
        await extractionMutation.mutateAsync({
          artifactId: artifact.id,
          profileId: activeProfileId,
        });
        console.log('[camera] Extraction triggered successfully for artifact', artifact.id);
      } catch (extractionErr) {
        // Log but don't block navigation — extraction can be retried
        console.error('[camera] Extraction trigger failed:', extractionErr);
      }

      router.replace('/(main)/(tabs)/documents');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      Alert.alert('Upload Error', message);
    }
  }

  // Permission not yet determined
  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
      </SafeAreaView>
    );
  }

  // Permission denied
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionDesc}>
            CareLead needs camera access to photograph documents like insurance
            cards, medication bottles, and lab results.
          </Text>
          <Button title="Grant Camera Access" onPress={requestPermission} />
        </View>
      </SafeAreaView>
    );
  }

  // Photo preview mode
  if (photoUri) {
    return (
      <SafeAreaView style={styles.container}>
        <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="contain" />
        <View style={styles.previewActions}>
          <Button
            title="Retake"
            variant="outline"
            onPress={() => setPhotoUri(null)}
          />
          <View style={styles.spacer} />
          <Button
            title="Use Photo"
            onPress={handleUsePhoto}
            loading={uploadMutation.isPending}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Camera view
  return (
    <View style={styles.cameraContainer}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        {/* Document framing guide */}
        <View style={styles.overlay}>
          <View style={styles.frameGuide}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
          <Text style={styles.hint}>
            Position the document within the frame
          </Text>
        </View>

        {/* Capture button */}
        <SafeAreaView edges={['bottom']} style={styles.captureBar}>
          <TouchableOpacity
            style={styles.captureButton}
            onPress={handleCapture}
            activeOpacity={0.7}
          >
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>
        </SafeAreaView>
      </CameraView>
    </View>
  );
}

const CORNER_SIZE = 24;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameGuide: {
    width: '85%',
    aspectRatio: 1.6, // roughly card/document ratio
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: '#fff',
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: '#fff',
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderColor: '#fff',
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderColor: '#fff',
  },
  hint: {
    color: '#fff',
    fontSize: FONT_SIZES.sm,
    marginTop: 16,
    textAlign: 'center',
    opacity: 0.8,
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
  preview: {
    flex: 1,
  },
  previewActions: {
    flexDirection: 'row',
    padding: 24,
    gap: 12,
  },
  spacer: {
    width: 12,
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permissionTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionDesc: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
});
