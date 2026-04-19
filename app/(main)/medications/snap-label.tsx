import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  Alert,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { supabase } from '@/lib/supabase';
import { uploadArtifact } from '@/services/artifacts';
import { checkForDuplicateMedication } from '@/services/medications';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateMedication } from '@/hooks/useMedications';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

type Step = 'permission' | 'camera' | 'preview' | 'extracting' | 'review' | 'error';

interface ExtractedLabel {
  medication_name: string | null;
  generic_name: string | null;
  brand_name: string | null;
  dose: string | null;
  form: string | null;
  frequency: string | null;
  quantity: number | null;
  refills_remaining: number | null;
  prescriber: string | null;
  pharmacy_name: string | null;
  pharmacy_phone: string | null;
  rx_number: string | null;
  last_fill_date: string | null;
  expiration_date: string | null;
  instructions: string | null;
  confidence: number | null;
}

const EMPTY_EXTRACTION: ExtractedLabel = {
  medication_name: null,
  generic_name: null,
  brand_name: null,
  dose: null,
  form: null,
  frequency: null,
  quantity: null,
  refills_remaining: null,
  prescriber: null,
  pharmacy_name: null,
  pharmacy_phone: null,
  rx_number: null,
  last_fill_date: null,
  expiration_date: null,
  instructions: null,
  confidence: null,
};

export default function SnapLabelScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const createMedication = useCreateMedication();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [step, setStep] = useState<Step>('camera');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractedLabel>(EMPTY_EXTRACTION);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted) setStep('permission');
  }, [permission]);

  async function handleCapture() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({
      quality: 0.8,
      imageType: 'jpg',
    });
    if (photo?.uri) {
      setPhotoUri(photo.uri);
      setStep('preview');
    }
  }

  function handleRetake() {
    setPhotoUri(null);
    setArtifactId(null);
    setExtraction(EMPTY_EXTRACTION);
    setErrorMessage(null);
    setStep('camera');
  }

  async function handleUsePhoto() {
    if (!photoUri || !activeProfileId) return;
    setStep('extracting');
    setErrorMessage(null);

    try {
      const fileInfo = await FileSystem.getInfoAsync(photoUri);
      const fileSize = fileInfo.exists ? fileInfo.size ?? 0 : 0;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `med-label-${timestamp}.jpg`;

      const uploadRes = await uploadArtifact({
        profileId: activeProfileId,
        fileName,
        fileUri: photoUri,
        mimeType: 'image/jpeg',
        artifactType: 'document',
        sourceChannel: 'camera',
        fileSizeBytes: fileSize,
      });

      if (!uploadRes.success) {
        setErrorMessage(uploadRes.error);
        setStep('error');
        return;
      }

      setArtifactId(uploadRes.data.id);

      const { data, error } = await supabase.functions.invoke('extract-med-label', {
        body: { artifactId: uploadRes.data.id, profileId: activeProfileId },
      });

      if (error || !data?.medication) {
        setErrorMessage(error?.message ?? 'Could not read the label clearly.');
        setStep('error');
        return;
      }

      const med = data.medication as Partial<ExtractedLabel>;
      setExtraction({ ...EMPTY_EXTRACTION, ...med });
      setStep('review');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Extraction failed';
      setErrorMessage(msg);
      setStep('error');
    }
  }

  function updateField<K extends keyof ExtractedLabel>(key: K, value: ExtractedLabel[K]) {
    setExtraction((prev) => ({ ...prev, [key]: value }));
  }

  function persistMedication() {
    if (!activeProfileId) return;
    const drugName = extraction.medication_name?.trim();
    if (!drugName) {
      Alert.alert('Medication name required', 'Please add a medication name before saving.');
      return;
    }

    createMedication.mutate(
      {
        profile_id: activeProfileId,
        drug_name: drugName,
        strength: extraction.dose?.trim() || undefined,
        form: normalizeForm(extraction.form),
        dose_text: extraction.dose?.trim() || undefined,
        frequency_text: extraction.frequency?.trim() || undefined,
        instructions: extraction.instructions?.trim() || undefined,
        pharmacy_name: extraction.pharmacy_name?.trim() || undefined,
        pharmacy_phone: extraction.pharmacy_phone?.trim() || undefined,
        prescriber_name: extraction.prescriber?.trim() || undefined,
        last_fill_date: extraction.last_fill_date?.trim() || undefined,
        refills_remaining: extraction.refills_remaining ?? undefined,
      },
      {
        onSuccess: () => {
          router.replace('/(main)/medications');
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : 'Failed to save medication';
          Alert.alert('Could not save', msg);
        },
      },
    );
  }

  async function handleConfirm() {
    if (!activeProfileId) return;
    const drugName = extraction.medication_name?.trim();
    if (!drugName) {
      Alert.alert('Medication name required', 'Please add a medication name before saving.');
      return;
    }

    const dupCheck = await checkForDuplicateMedication(activeProfileId, drugName);
    if (dupCheck.success && dupCheck.data.isDuplicate && dupCheck.data.existingMed) {
      const existing = dupCheck.data.existingMed;
      Alert.alert(
        'Similar medication found',
        `You already have ${existing.name} (${existing.dose}) on file. What would you like to do?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open existing',
            onPress: () => router.replace(`/(main)/medications/${existing.id}` as never),
          },
          {
            text: 'Add anyway',
            style: 'destructive',
            onPress: () => persistMedication(),
          },
        ],
      );
      return;
    }

    persistMedication();
  }

  // ── Permission denied ──────────────────────────────────────────────────
  if (step === 'permission') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Ionicons name="camera-outline" size={48} color={COLORS.text.secondary} />
          <Text style={styles.permissionTitle}>Camera access required</Text>
          <Text style={styles.permissionDesc}>
            Snap a Label needs camera access so we can read your medication bottle.
          </Text>
          <Button title="Grant Camera Access" onPress={requestPermission} />
          <TouchableOpacity onPress={() => router.back()} style={styles.cancelLink}>
            <Text style={styles.cancelLinkText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Camera view ────────────────────────────────────────────────────────
  if (step === 'camera') {
    if (!permission?.granted) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.centered}>
            <ActivityIndicator color={COLORS.primary.DEFAULT} />
          </View>
        </SafeAreaView>
      );
    }
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back">
          <SafeAreaView edges={['top']} style={styles.cameraTopBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.cameraCloseBtn}>
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.cameraTitle}>Snap a Label</Text>
            <View style={{ width: 40 }} />
          </SafeAreaView>

          <View style={styles.cameraOverlay}>
            <View style={styles.frameGuide}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
            <Text style={styles.cameraHint}>
              Line up the prescription label in the frame
            </Text>
          </View>

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

  // ── Preview ────────────────────────────────────────────────────────────
  if (step === 'preview' && photoUri) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="contain" />
        <View style={styles.previewActions}>
          <Button title="Retake" variant="outline" onPress={handleRetake} />
          <View style={{ width: 12 }} />
          <Button title="Use Photo" onPress={handleUsePhoto} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Extracting ─────────────────────────────────────────────────────────
  if (step === 'extracting') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
          <Text style={styles.extractingTitle}>Reading your medication label...</Text>
          <Text style={styles.extractingSubtitle}>
            CareLead is parsing the label and filling in the details.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────
  if (step === 'error') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.error.DEFAULT} />
          <Text style={styles.errorTitle}>Couldn't read the label clearly</Text>
          <Text style={styles.errorDesc}>
            {errorMessage ?? 'The extraction did not return a medication.'} Try again with a clearer photo, or enter manually.
          </Text>
          <View style={styles.errorActions}>
            <Button title="Retake photo" onPress={handleRetake} />
            <View style={{ height: 12 }} />
            <Button
              title="Enter manually instead"
              variant="outline"
              onPress={() => router.replace('/(main)/medications/create')}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Review ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.reviewContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.reviewHeader}>
            <TouchableOpacity onPress={handleRetake}>
              <Text style={styles.cancelText}>Retake</Text>
            </TouchableOpacity>
            <View style={styles.aiBadge}>
              <Ionicons name="sparkles" size={12} color={COLORS.secondary.DEFAULT} />
              <Text style={styles.aiBadgeText}>From label</Text>
            </View>
          </View>

          <Text style={styles.reviewTitle}>Review & Add</Text>
          <Text style={styles.reviewSubtitle}>
            Check what we read from the label. Edit anything before saving.
          </Text>

          {photoUri && (
            <Image source={{ uri: photoUri }} style={styles.thumbnail} resizeMode="cover" />
          )}

          <View style={styles.form}>
            <ReviewField
              label="Medication name *"
              value={extraction.medication_name ?? ''}
              onChange={(v) => updateField('medication_name', v || null)}
              placeholder="e.g., Lisinopril"
            />
            <ReviewField
              label="Dose / strength"
              value={extraction.dose ?? ''}
              onChange={(v) => updateField('dose', v || null)}
              placeholder="e.g., 10mg"
            />
            <ReviewField
              label="Frequency"
              value={extraction.frequency ?? ''}
              onChange={(v) => updateField('frequency', v || null)}
              placeholder="e.g., Once daily"
            />
            <ReviewField
              label="Form"
              value={extraction.form ?? ''}
              onChange={(v) => updateField('form', v || null)}
              placeholder="e.g., tablet, capsule"
            />
            <ReviewField
              label="Instructions"
              value={extraction.instructions ?? ''}
              onChange={(v) => updateField('instructions', v || null)}
              placeholder="e.g., Take with food"
              multiline
            />
            <ReviewField
              label="Prescriber"
              value={extraction.prescriber ?? ''}
              onChange={(v) => updateField('prescriber', v || null)}
              placeholder="e.g., Dr. Smith"
            />
            <ReviewField
              label="Pharmacy"
              value={extraction.pharmacy_name ?? ''}
              onChange={(v) => updateField('pharmacy_name', v || null)}
              placeholder="e.g., CVS Pharmacy"
            />
            <ReviewField
              label="Pharmacy phone"
              value={extraction.pharmacy_phone ?? ''}
              onChange={(v) => updateField('pharmacy_phone', v || null)}
              placeholder="e.g., (555) 123-4567"
              keyboardType="phone-pad"
            />
            <ReviewField
              label="Refills remaining"
              value={extraction.refills_remaining != null ? String(extraction.refills_remaining) : ''}
              onChange={(v) => {
                const n = v.trim() === '' ? null : Number(v);
                updateField('refills_remaining', Number.isFinite(n as number) ? (n as number) : null);
              }}
              placeholder="e.g., 2"
              keyboardType="number-pad"
            />
            <ReviewField
              label="Last fill date"
              value={extraction.last_fill_date ?? ''}
              onChange={(v) => updateField('last_fill_date', v || null)}
              placeholder="YYYY-MM-DD"
            />
          </View>

          <View style={styles.buttonRow}>
            <Button
              title="Confirm & Add"
              onPress={handleConfirm}
              loading={createMedication.isPending}
              disabled={!extraction.medication_name?.trim()}
              size="lg"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ReviewField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'phone-pad';
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Input
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        multiline={multiline}
        numberOfLines={multiline ? 2 : undefined}
        style={multiline ? styles.multiline : undefined}
        keyboardType={keyboardType}
      />
    </View>
  );
}

function normalizeForm(raw: string | null): 'tablet' | 'capsule' | 'liquid' | 'cream' | 'injection' | 'inhaler' | 'patch' | 'drops' | 'other' | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase().trim();
  if (/tablet|tab\b/.test(v)) return 'tablet';
  if (/capsule|cap\b/.test(v)) return 'capsule';
  if (/liquid|solution|suspension|syrup/.test(v)) return 'liquid';
  if (/cream|ointment|gel|lotion/.test(v)) return 'cream';
  if (/inject/.test(v)) return 'injection';
  if (/inhal|spray/.test(v)) return 'inhaler';
  if (/patch/.test(v)) return 'patch';
  if (/drop/.test(v)) return 'drops';
  return 'other';
}

const CORNER_SIZE = 24;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  cancelLink: { marginTop: 8, padding: 8 },
  cancelLinkText: { fontSize: FONT_SIZES.sm, color: COLORS.text.secondary },
  permissionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
    marginTop: 8,
  },
  permissionDesc: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  // Camera
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraTopBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cameraCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  cameraTitle: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  cameraOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameGuide: { width: '85%', aspectRatio: 1.4, position: 'relative' },
  corner: { position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE },
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
  cameraHint: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.sm,
    marginTop: 16,
    textAlign: 'center',
    opacity: 0.85,
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
  // Preview
  preview: { flex: 1 },
  previewActions: {
    flexDirection: 'row',
    padding: 24,
    gap: 12,
  },
  // Extracting
  extractingTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginTop: 16,
    textAlign: 'center',
  },
  extractingSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 20,
  },
  // Error
  errorTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginTop: 8,
    textAlign: 'center',
  },
  errorDesc: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  errorActions: {
    alignSelf: 'stretch',
    marginTop: 8,
  },
  // Review
  reviewContent: { paddingHorizontal: 24, paddingBottom: 48, paddingTop: 8 },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cancelText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.secondary.DEFAULT + '20',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  aiBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.secondary.DEFAULT,
  },
  reviewTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  reviewSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
    marginBottom: 16,
    lineHeight: 20,
  },
  thumbnail: {
    width: '100%',
    height: 140,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: COLORS.surface.muted,
  },
  form: {
    gap: 4,
  },
  fieldRow: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  multiline: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  buttonRow: {
    marginTop: 20,
  },
});
