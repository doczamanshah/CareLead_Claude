import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useUploadArtifact } from '@/hooks/useArtifacts';
import { useTriggerExtraction } from '@/hooks/useIntentSheet';
import { useCreateMedication } from '@/hooks/useMedications';
import { updateProfileBasics, fetchUserProfiles } from '@/services/profiles';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

type CaringFor = 'self' | 'family' | 'other';
type Sex = 'male' | 'female';
type Step = 1 | 2 | 3 | 4;
type QuickWin = null | 'insurance' | 'medication' | 'document';

export default function OnboardingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setProfiles = useProfileStore((s) => s.setProfiles);
  const { activeProfileId } = useActiveProfile();

  const [step, setStep] = useState<Step>(1);
  const [caringFor, setCaringFor] = useState<CaringFor | null>(null);

  // Step 2 state
  const [dob, setDob] = useState<Date | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);
  const [zip, setZip] = useState('');
  const [savingBasics, setSavingBasics] = useState(false);

  // Step 3 state
  const [activeQuickWin, setActiveQuickWin] = useState<QuickWin>(null);
  const [quickWinDone, setQuickWinDone] = useState(false);
  const [quickWinMessage, setQuickWinMessage] = useState<string | null>(null);

  // Step 4 state
  const [finishing, setFinishing] = useState(false);

  // Mark onboarding as completed on mount so a mid-flow app kill
  // drops the user back on Home instead of restarting the wizard.
  useEffect(() => {
    supabase.auth
      .updateUser({ data: { onboarding_completed: true } })
      .catch((err) => console.log('[onboarding] could not set flag', err));
  }, []);

  const advance = () =>
    setStep((s) => (s < 4 ? ((s + 1) as Step) : s));

  const caringLabel = (() => {
    switch (caringFor) {
      case 'other':
        return 'the person you\u2019re caring for';
      case 'family':
        return 'yourself';
      default:
        return 'you';
    }
  })();

  async function handleCaringSelect(value: CaringFor) {
    setCaringFor(value);
    try {
      await supabase.auth.updateUser({ data: { caring_for: value } });
    } catch (err) {
      console.log('[onboarding] could not save caring_for', err);
    }
    advance();
  }

  async function handleSaveBasics() {
    if (!activeProfileId || savingBasics) return;
    setSavingBasics(true);
    try {
      const updates: {
        dateOfBirth?: string;
        gender?: string;
        zipCode?: string;
      } = {};
      if (dob) updates.dateOfBirth = dob.toISOString().slice(0, 10);
      if (sex) updates.gender = sex;
      const trimmedZip = zip.trim();
      if (trimmedZip) updates.zipCode = trimmedZip;

      if (Object.keys(updates).length > 0) {
        const result = await updateProfileBasics(activeProfileId, updates);
        if (!result.success) {
          Alert.alert(
            'Heads up',
            'We couldn\u2019t save that right now, but you can add it later in Settings.',
          );
        } else if (user) {
          const refreshed = await fetchUserProfiles(user.id);
          if (refreshed.success) setProfiles(refreshed.data);
        }
      }
    } catch (err) {
      console.log('[onboarding] basics save failed', err);
    } finally {
      setSavingBasics(false);
      advance();
    }
  }

  function handleSkipBasics() {
    if (savingBasics) return;
    advance();
  }

  function handleQuickWinComplete(message: string) {
    setQuickWinMessage(message);
    setQuickWinDone(true);
  }

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);
    router.replace('/(main)/(tabs)');
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.progressRow}>
          {[1, 2, 3, 4].map((n) => (
            <View
              key={n}
              style={[
                styles.progressDot,
                n === step
                  ? styles.progressDotActive
                  : n < step
                    ? styles.progressDotDone
                    : styles.progressDotIdle,
              ]}
            />
          ))}
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === 1 && (
            <StepCaringFor onSelect={handleCaringSelect} />
          )}

          {step === 2 && (
            <StepBasics
              caringFor={caringFor}
              dob={dob}
              setDob={setDob}
              sex={sex}
              setSex={setSex}
              zip={zip}
              setZip={setZip}
              onContinue={handleSaveBasics}
              onSkip={handleSkipBasics}
              saving={savingBasics}
            />
          )}

          {step === 3 && !quickWinDone && !activeQuickWin && (
            <StepQuickWin
              caringLabel={caringLabel}
              onPick={setActiveQuickWin}
              onSkip={advance}
            />
          )}

          {step === 3 && activeQuickWin === 'insurance' && !quickWinDone && (
            <InsuranceCardFlow
              onDone={() => handleQuickWinComplete('Insurance card saved!')}
              onCancel={() => setActiveQuickWin(null)}
            />
          )}

          {step === 3 && activeQuickWin === 'medication' && !quickWinDone && (
            <AddMedicationFlow
              onDone={() => handleQuickWinComplete('Medication added!')}
              onCancel={() => setActiveQuickWin(null)}
            />
          )}

          {step === 3 && activeQuickWin === 'document' && !quickWinDone && (
            <UploadDocumentFlow
              onDone={() =>
                handleQuickWinComplete(
                  'Document saved! CareLead will process it.',
                )
              }
              onCancel={() => setActiveQuickWin(null)}
            />
          )}

          {step === 3 && quickWinDone && (
            <QuickWinSuccess
              message={quickWinMessage ?? 'Nice! You\u2019re off to a great start.'}
              onContinue={advance}
            />
          )}

          {step === 4 && (
            <StepWelcome onFinish={handleFinish} finishing={finishing} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Step 1 ─────────────────────────────────────────────────────────

function StepCaringFor({ onSelect }: { onSelect: (v: CaringFor) => void }) {
  const options: {
    value: CaringFor;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    desc: string;
  }[] = [
    {
      value: 'self',
      icon: 'person-outline',
      title: 'Just me',
      desc: 'I want to manage my own health information',
    },
    {
      value: 'family',
      icon: 'people-outline',
      title: 'Me and my family',
      desc: 'I\u2019m managing care for myself and family members',
    },
    {
      value: 'other',
      icon: 'heart-outline',
      title: 'Someone I care for',
      desc: 'I\u2019m a caregiver helping someone else',
    },
  ];

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>
        Who will you be managing health information for?
      </Text>
      <Text style={styles.stepSubtitle}>
        This helps CareLead tailor the experience.
      </Text>

      <View style={styles.optionList}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={styles.optionCard}
            activeOpacity={0.7}
            onPress={() => onSelect(opt.value)}
          >
            <View style={styles.optionIconWrap}>
              <Ionicons
                name={opt.icon}
                size={26}
                color={COLORS.primary.DEFAULT}
              />
            </View>
            <View style={styles.optionBody}>
              <Text style={styles.optionTitle}>{opt.title}</Text>
              <Text style={styles.optionDesc}>{opt.desc}</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={COLORS.text.tertiary}
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Step 2 ─────────────────────────────────────────────────────────

function StepBasics({
  caringFor,
  dob,
  setDob,
  sex,
  setSex,
  zip,
  setZip,
  onContinue,
  onSkip,
  saving,
}: {
  caringFor: CaringFor | null;
  dob: Date | null;
  setDob: (d: Date | null) => void;
  sex: Sex | null;
  setSex: (s: Sex) => void;
  zip: string;
  setZip: (v: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  saving: boolean;
}) {
  const title =
    caringFor === 'other'
      ? 'Tell us about the person you\u2019re caring for'
      : 'Let\u2019s set up the basics';

  const today = new Date();
  const maxDate = today;
  const minDate = new Date(today.getFullYear() - 120, 0, 1);

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepSubtitle}>
        This helps CareLead give you better recommendations.
      </Text>

      <View style={styles.formWrap}>
        <DatePicker
          label="Date of birth"
          value={dob}
          onChange={setDob}
          mode="date"
          placeholder="Select date of birth"
          minimumDate={minDate}
          maximumDate={maxDate}
        />

        <Text style={styles.fieldLabel}>Sex</Text>
        <View style={styles.choiceRow}>
          {(['male', 'female'] as const).map((option) => {
            const selected = sex === option;
            return (
              <TouchableOpacity
                key={option}
                style={[
                  styles.choiceChip,
                  selected && styles.choiceChipActive,
                ]}
                onPress={() => setSex(option)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.choiceText,
                    selected && styles.choiceTextActive,
                  ]}
                >
                  {option === 'male' ? 'Male' : 'Female'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.zipWrap}>
          <Input
            label="Zip code (optional)"
            placeholder="e.g., 10001"
            value={zip}
            onChangeText={setZip}
            keyboardType="number-pad"
            maxLength={10}
          />
          <Text style={styles.helperText}>Helps find nearby providers.</Text>
        </View>
      </View>

      <View style={styles.actionBlock}>
        <Button
          title="Continue"
          size="lg"
          onPress={onContinue}
          loading={saving}
        />
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={onSkip}
          activeOpacity={0.7}
          disabled={saving}
        >
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Step 3 ─────────────────────────────────────────────────────────

function StepQuickWin({
  caringLabel,
  onPick,
  onSkip,
}: {
  caringLabel: string;
  onPick: (v: QuickWin) => void;
  onSkip: () => void;
}) {
  const options: {
    value: Exclude<QuickWin, null>;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    desc: string;
  }[] = [
    {
      value: 'insurance',
      icon: 'card-outline',
      title: 'Snap your insurance card',
      desc: 'We\u2019ll read your plan details and add them to your profile',
    },
    {
      value: 'medication',
      icon: 'medical-outline',
      title: 'Add a medication',
      desc: 'Just the name, dose, and how often \u2014 takes 30 seconds',
    },
    {
      value: 'document',
      icon: 'document-outline',
      title: 'Upload a document',
      desc: 'Lab result, discharge summary, anything healthcare-related',
    },
  ];

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Let\u2019s add something to get started</Text>
      <Text style={styles.stepSubtitle}>
        Pick one for {caringLabel} \u2014 you can always add more later.
      </Text>

      <View style={styles.optionList}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={styles.optionCard}
            activeOpacity={0.7}
            onPress={() => onPick(opt.value)}
          >
            <View style={styles.optionIconWrap}>
              <Ionicons
                name={opt.icon}
                size={26}
                color={COLORS.primary.DEFAULT}
              />
            </View>
            <View style={styles.optionBody}>
              <Text style={styles.optionTitle}>{opt.title}</Text>
              <Text style={styles.optionDesc}>{opt.desc}</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={COLORS.text.tertiary}
            />
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={styles.skipBtn}
        onPress={onSkip}
        activeOpacity={0.7}
      >
        <Text style={styles.skipText}>Skip \u2014 I\u2019ll do this later</Text>
      </TouchableOpacity>
    </View>
  );
}

function QuickWinSuccess({
  message,
  onContinue,
}: {
  message: string;
  onContinue: () => void;
}) {
  return (
    <View style={[styles.stepContainer, styles.successContainer]}>
      <View style={styles.successCircle}>
        <Ionicons
          name="checkmark"
          size={40}
          color={COLORS.text.inverse}
        />
      </View>
      <Text style={styles.successTitle}>{message}</Text>
      <Text style={styles.successSubtitle}>
        Nice! You\u2019re off to a great start.
      </Text>
      <View style={styles.successBtnWrap}>
        <Button title="Continue" size="lg" onPress={onContinue} />
      </View>
    </View>
  );
}

// ─── Quick Win: Insurance Card ──────────────────────────────────────

function InsuranceCardFlow({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const { activeProfileId } = useActiveProfile();
  const uploadMutation = useUploadArtifact();
  const extractionMutation = useTriggerExtraction();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function handleCapture() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({
      quality: 0.8,
      imageType: 'jpg',
    });
    if (photo?.uri) setPhotoUri(photo.uri);
  }

  async function handleUse() {
    if (!photoUri || !activeProfileId) return;
    setProcessing(true);
    try {
      const fileInfo = await FileSystem.getInfoAsync(photoUri);
      const fileSize = fileInfo.exists ? (fileInfo.size ?? 0) : 0;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `insurance-${timestamp}.jpg`;

      const artifact = await uploadMutation.mutateAsync({
        profileId: activeProfileId,
        fileName,
        fileUri: photoUri,
        mimeType: 'image/jpeg',
        artifactType: 'document',
        sourceChannel: 'camera',
        fileSizeBytes: fileSize,
      });

      try {
        const extraction = await extractionMutation.mutateAsync({
          artifactId: artifact.id,
          profileId: activeProfileId,
        });
        if (extraction.intentSheetId) {
          await autoAcceptIntentSheet(extraction.intentSheetId);
        }
      } catch (err) {
        console.log('[onboarding] insurance extraction failed', err);
      }

      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      Alert.alert('Upload error', message);
    } finally {
      setProcessing(false);
    }
  }

  if (!permission) {
    return (
      <View style={styles.centeredBlock}>
        <ActivityIndicator color={COLORS.primary.DEFAULT} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Camera access needed</Text>
        <Text style={styles.stepSubtitle}>
          CareLead needs camera access to snap your insurance card.
        </Text>
        <View style={styles.actionBlock}>
          <Button title="Grant camera access" onPress={requestPermission} />
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={onCancel}
            activeOpacity={0.7}
          >
            <Text style={styles.skipText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (processing) {
    return (
      <View style={[styles.stepContainer, styles.centeredBlock]}>
        <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        <Text style={styles.processingText}>
          Processing your insurance card\u2026
        </Text>
      </View>
    );
  }

  if (photoUri) {
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Looks good?</Text>
        <Image
          source={{ uri: photoUri }}
          style={styles.previewImage}
          resizeMode="contain"
        />
        <View style={styles.actionBlock}>
          <Button title="Use photo" size="lg" onPress={handleUse} />
          <View style={styles.buttonGap} />
          <Button
            title="Retake"
            variant="outline"
            onPress={() => setPhotoUri(null)}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Snap your insurance card</Text>
      <Text style={styles.stepSubtitle}>
        Center the front of your card in the frame.
      </Text>

      <View style={styles.cameraFrame}>
        <CameraView ref={cameraRef} style={styles.cameraView} facing="back" />
      </View>

      <View style={styles.actionBlock}>
        <Button title="Take photo" size="lg" onPress={handleCapture} />
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={onCancel}
          activeOpacity={0.7}
        >
          <Text style={styles.skipText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

async function autoAcceptIntentSheet(intentSheetId: string) {
  const { data: items } = await supabase
    .from('intent_items')
    .select('id, item_type')
    .eq('intent_sheet_id', intentSheetId)
    .eq('status', 'pending');

  const dataItems = (items ?? []).filter(
    (it: { item_type: string }) =>
      it.item_type !== 'task' && it.item_type !== 'reminder',
  );
  if (dataItems.length === 0) return;

  await supabase
    .from('intent_items')
    .update({ status: 'accepted' })
    .in(
      'id',
      dataItems.map((it: { id: string }) => it.id),
    );

  const { commitIntentSheet } = await import('@/services/commit');
  await commitIntentSheet(intentSheetId);
}

// ─── Quick Win: Medication (inline form) ────────────────────────────

function AddMedicationFlow({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const { activeProfileId } = useActiveProfile();
  const createMedication = useCreateMedication();

  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [frequency, setFrequency] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!activeProfileId || saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Name required', 'Please enter a medication name.');
      return;
    }
    setSaving(true);
    try {
      await createMedication.mutateAsync({
        profile_id: activeProfileId,
        drug_name: trimmedName,
        dose_text: dose.trim() || undefined,
        frequency_text: frequency.trim() || undefined,
      });
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      Alert.alert('Could not save', message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Add a medication</Text>
      <Text style={styles.stepSubtitle}>
        Just the basics \u2014 you can add details later.
      </Text>

      <View style={styles.formWrap}>
        <Input
          label="Medication name"
          placeholder="e.g., Lisinopril"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoFocus
        />
        <Input
          label="Dose"
          placeholder="e.g., 25mg"
          value={dose}
          onChangeText={setDose}
        />
        <Input
          label="How often"
          placeholder="e.g., Once daily"
          value={frequency}
          onChangeText={setFrequency}
        />
      </View>

      <View style={styles.actionBlock}>
        <Button
          title="Save medication"
          size="lg"
          onPress={handleSave}
          loading={saving}
        />
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={onCancel}
          activeOpacity={0.7}
          disabled={saving}
        >
          <Text style={styles.skipText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Quick Win: Upload Document ─────────────────────────────────────

function UploadDocumentFlow({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const { activeProfileId } = useActiveProfile();
  const uploadMutation = useUploadArtifact();

  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState('');
  const [pickedMime, setPickedMime] = useState('');
  const [pickedSize, setPickedSize] = useState(0);
  const [uploading, setUploading] = useState(false);

  async function handlePick() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const mime = asset.mimeType ?? 'application/octet-stream';
      if (mime === 'image/heic' || mime === 'image/heif') {
        Alert.alert(
          'Unsupported format',
          'HEIC/HEIF images aren\u2019t supported. Please choose a JPEG, PNG, or PDF.',
        );
        return;
      }
      setPickedUri(asset.uri);
      setPickedName(asset.name);
      setPickedMime(mime);
      setPickedSize(asset.size ?? 0);
    } catch {
      Alert.alert('Error', 'Could not open the document picker.');
    }
  }

  async function handleUpload() {
    if (!pickedUri || !activeProfileId || uploading) return;
    setUploading(true);
    try {
      await uploadMutation.mutateAsync({
        profileId: activeProfileId,
        fileName: pickedName,
        fileUri: pickedUri,
        mimeType: pickedMime,
        artifactType: 'document',
        sourceChannel: 'upload',
        fileSizeBytes: pickedSize,
      });
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      Alert.alert('Upload error', message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Upload a document</Text>
      <Text style={styles.stepSubtitle}>
        Pick a PDF, JPEG, or PNG from your device.
      </Text>

      {pickedUri ? (
        <View style={styles.pickedCard}>
          <Ionicons
            name={pickedMime === 'application/pdf' ? 'document-text' : 'image'}
            size={32}
            color={COLORS.primary.DEFAULT}
          />
          <View style={styles.pickedBody}>
            <Text style={styles.pickedName} numberOfLines={2}>
              {pickedName}
            </Text>
            <Text style={styles.pickedMeta}>
              {(pickedSize / 1024).toFixed(1)} KB
            </Text>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.dropZone}
          onPress={handlePick}
          activeOpacity={0.7}
        >
          <Ionicons
            name="cloud-upload-outline"
            size={40}
            color={COLORS.primary.DEFAULT}
          />
          <Text style={styles.dropText}>Tap to browse files</Text>
        </TouchableOpacity>
      )}

      <View style={styles.actionBlock}>
        {pickedUri ? (
          <>
            <Button
              title="Upload"
              size="lg"
              onPress={handleUpload}
              loading={uploading}
            />
            <View style={styles.buttonGap} />
            <Button
              title="Choose different file"
              variant="outline"
              onPress={handlePick}
            />
          </>
        ) : null}
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={onCancel}
          activeOpacity={0.7}
          disabled={uploading}
        >
          <Text style={styles.skipText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Step 4 ─────────────────────────────────────────────────────────

function StepWelcome({
  onFinish,
  finishing,
}: {
  onFinish: () => void;
  finishing: boolean;
}) {
  const highlights: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    desc: string;
  }[] = [
    {
      icon: 'chatbubble-ellipses-outline',
      title: 'Ask anything',
      desc: 'Ask CareLead about your health profile anytime',
    },
    {
      icon: 'notifications-outline',
      title: 'Stay on track',
      desc: 'Get reminders for medications, appointments, and screenings',
    },
    {
      icon: 'share-outline',
      title: 'Share with confidence',
      desc: 'Export and share your health info with providers',
    },
  ];

  return (
    <View style={styles.stepContainer}>
      <View style={styles.successCircle}>
        <Ionicons
          name="sparkles"
          size={36}
          color={COLORS.text.inverse}
        />
      </View>
      <Text style={styles.stepTitle}>Welcome to CareLead!</Text>
      <Text style={styles.stepSubtitle}>
        Your health profile is ready. The more you add over time, the more
        helpful CareLead becomes.
      </Text>

      <View style={styles.highlightList}>
        {highlights.map((h) => (
          <View key={h.title} style={styles.highlightCard}>
            <View style={styles.highlightIconWrap}>
              <Ionicons
                name={h.icon}
                size={22}
                color={COLORS.secondary.dark}
              />
            </View>
            <View style={styles.highlightBody}>
              <Text style={styles.highlightTitle}>{h.title}</Text>
              <Text style={styles.highlightDesc}>{h.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.actionBlock}>
        <Button
          title="Go to Home"
          size="lg"
          onPress={onFinish}
          loading={finishing}
        />
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
    gap: 8,
  },
  progressDot: {
    height: 6,
    borderRadius: 3,
  },
  progressDotActive: {
    width: 28,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  progressDotDone: {
    width: 18,
    backgroundColor: COLORS.secondary.DEFAULT,
  },
  progressDotIdle: {
    width: 18,
    backgroundColor: COLORS.border.DEFAULT,
  },
  stepContainer: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  stepTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    marginBottom: 24,
    lineHeight: 22,
  },
  optionList: {
    gap: 12,
    marginBottom: 24,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  optionIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.secondary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  optionBody: {
    flex: 1,
  },
  optionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  optionDesc: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },
  formWrap: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
    marginTop: 4,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  choiceChip: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
    alignItems: 'center',
  },
  choiceChipActive: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  choiceText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  choiceTextActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  zipWrap: {
    marginTop: 4,
  },
  helperText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: -8,
    marginBottom: 8,
  },
  actionBlock: {
    marginTop: 16,
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  skipText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  buttonGap: {
    height: 12,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  processingText: {
    marginTop: 16,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  cameraFrame: {
    height: 280,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginBottom: 16,
  },
  cameraView: {
    flex: 1,
  },
  previewImage: {
    width: '100%',
    height: 280,
    borderRadius: 16,
    backgroundColor: COLORS.surface.muted,
    marginBottom: 16,
  },
  dropZone: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.border.dark,
    borderRadius: 16,
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  dropText: {
    marginTop: 12,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.primary.DEFAULT,
  },
  pickedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    marginBottom: 16,
  },
  pickedBody: {
    flex: 1,
    marginLeft: 14,
  },
  pickedName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  pickedMeta: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  successContainer: {
    alignItems: 'center',
    paddingTop: 40,
  },
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.secondary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    alignSelf: 'center',
  },
  successTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
    textAlign: 'center',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  successBtnWrap: {
    width: '100%',
  },
  highlightList: {
    gap: 12,
    marginBottom: 24,
  },
  highlightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  highlightIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.secondary.DEFAULT + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  highlightBody: {
    flex: 1,
  },
  highlightTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  highlightDesc: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },
});
