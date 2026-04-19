import { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateBillingCase, useUploadBillingDocument } from '@/hooks/useBilling';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

type Mode = 'choose' | 'camera';

function todayTitle(): string {
  const d = new Date();
  return `New Bill — ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
}

export default function CreateBillingCaseScreen() {
  const router = useRouter();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const createCase = useCreateBillingCase();
  const uploadDoc = useUploadBillingDocument();

  const [mode, setMode] = useState<Mode>('choose');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSnapBill() {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera Access Required', 'Please grant camera access to take photos.');
        return;
      }
    }
    setMode('camera');
  }

  async function handleTakePhoto() {
    if (!cameraRef.current || capturing || !activeProfileId || !activeProfile) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo?.uri) {
        Alert.alert('Error', 'Failed to capture photo');
        setCapturing(false);
        return;
      }
      setBusy(true);
      setMode('choose');

      const caseData = await createCase.mutateAsync({
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
        title: todayTitle(),
      });

      await uploadDoc.mutateAsync({
        caseId: caseData.id,
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
        docType: 'bill',
        fileUri: photo.uri,
        fileName: `bill-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
      });

      router.replace(`/(main)/billing/${caseData.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      Alert.alert('Error', msg);
      setBusy(false);
      setCapturing(false);
    }
  }

  // ── Camera Mode ──
  if (mode === 'camera') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.cameraContainer}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="back"
          />
          <View style={styles.cameraControls}>
            <TouchableOpacity
              onPress={() => { setMode('choose'); setCapturing(false); }}
              style={styles.cameraCancelButton}
            >
              <Text style={styles.cameraCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleTakePhoto}
              disabled={capturing}
              style={[styles.captureButton, capturing && styles.captureButtonDisabled]}
              activeOpacity={0.7}
            >
              {capturing ? (
                <ActivityIndicator color={COLORS.text.inverse} size="small" />
              ) : (
                <Ionicons name="camera" size={28} color={COLORS.text.inverse} />
              )}
            </TouchableOpacity>
            <View style={styles.cameraPlaceholder} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading Overlay ──
  if (busy) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
          <Text style={styles.busyText}>Getting things ready...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Choose Mode (default) ──
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={18} color={COLORS.primary.DEFAULT} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Track a Bill</Text>
        <Text style={styles.subtitle}>
          How would you like to get started?
        </Text>
      </View>

      <View style={styles.optionsContainer}>
        <TouchableOpacity
          style={styles.optionCard}
          activeOpacity={0.7}
          onPress={handleSnapBill}
        >
          <View style={styles.optionIconCircle}>
            <Ionicons name="camera-outline" size={26} color={COLORS.primary.DEFAULT} />
          </View>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>Snap a Bill</Text>
            <Text style={styles.optionDesc}>Take a photo and we'll tell you what you owe</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.text.tertiary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.optionCard}
          activeOpacity={0.7}
          onPress={() => router.push('/(main)/billing/start')}
        >
          <View style={styles.optionIconCircle}>
            <Ionicons name="document-text-outline" size={26} color={COLORS.primary.DEFAULT} />
          </View>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>Start a New Bill</Text>
            <Text style={styles.optionDesc}>Describe your bill or start tracking it</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.text.tertiary} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  busyText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    marginTop: 16,
  },

  // Header
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
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
    lineHeight: 20,
  },

  // Option cards
  optionsContainer: {
    paddingHorizontal: 24,
    paddingTop: 24,
    gap: 12,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  optionIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  optionDesc: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },

  // Camera mode
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  cameraControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    backgroundColor: '#000',
  },
  cameraCancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    width: 70,
  },
  cameraCancelText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.medium,
  },
  captureButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: COLORS.text.inverse,
  },
  captureButtonDisabled: {
    opacity: 0.5,
  },
  cameraPlaceholder: {
    width: 70,
  },
});
