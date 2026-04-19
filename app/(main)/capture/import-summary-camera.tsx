import { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function ImportSummaryCameraScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  async function handleCapture() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({
      quality: 0.85,
      imageType: 'jpg',
    });
    if (photo?.uri) setPhotoUri(photo.uri);
  }

  async function handleUsePhoto() {
    if (!photoUri) return;
    const fileInfo = await FileSystem.getInfoAsync(photoUri);
    const fileSize = fileInfo.exists ? fileInfo.size ?? 0 : 0;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    router.replace({
      pathname: '/(main)/capture/import-processing',
      params: {
        fileUri: photoUri,
        fileName: `health-summary-${timestamp}.jpg`,
        mimeType: 'image/jpeg',
        fileSize: String(fileSize),
        sourceChannel: 'camera',
      },
    } as never);
  }

  if (!permission) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={COLORS.primary.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.centered}>
        <Ionicons name="camera-outline" size={40} color={COLORS.text.secondary} />
        <Text style={styles.permissionTitle}>Camera access required</Text>
        <Text style={styles.permissionDesc}>
          We need camera access to photograph your health summary.
        </Text>
        <Button title="Grant Camera Access" onPress={requestPermission} />
      </SafeAreaView>
    );
  }

  if (photoUri) {
    return (
      <SafeAreaView style={styles.previewSafe}>
        <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="contain" />
        <View style={styles.previewActions}>
          <Button title="Retake" variant="outline" onPress={() => setPhotoUri(null)} />
          <View style={{ width: 12 }} />
          <Button title="Use Photo" onPress={handleUsePhoto} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        <SafeAreaView edges={['top']} style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Photograph Health Summary</Text>
          <View style={{ width: 40 }} />
        </SafeAreaView>

        <View style={styles.overlay}>
          <Text style={styles.hint}>
            Capture the full page. You can take more photos later if needed.
          </Text>
        </View>

        <SafeAreaView edges={['bottom']} style={styles.captureBar}>
          <TouchableOpacity style={styles.captureButton} onPress={handleCapture} activeOpacity={0.7}>
            <View style={styles.captureInner} />
          </TouchableOpacity>
        </SafeAreaView>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
    backgroundColor: COLORS.background.DEFAULT,
  },
  permissionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  permissionDesc: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  topTitle: { color: '#FFFFFF', fontSize: FONT_SIZES.base, fontWeight: FONT_WEIGHTS.semibold },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  hint: { color: '#FFFFFF', fontSize: FONT_SIZES.sm, textAlign: 'center', opacity: 0.85 },
  captureBar: { alignItems: 'center', paddingBottom: 24 },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  previewSafe: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  preview: { flex: 1 },
  previewActions: { flexDirection: 'row', padding: 24, gap: 12 },
});
