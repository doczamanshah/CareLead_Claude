import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateBillingCase, useTriggerFreeformExtraction } from '@/hooks/useBilling';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

function todayTitle(): string {
  const d = new Date();
  return `New Bill — ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
}

export default function StartBillingCaseScreen() {
  const router = useRouter();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const createCase = useCreateBillingCase();
  const triggerFreeform = useTriggerFreeformExtraction();

  const [title, setTitle] = useState('');
  const [freeformText, setFreeformText] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleContinue() {
    if (!activeProfileId || !activeProfile) return;
    setBusy(true);
    try {
      const caseTitle = title.trim() || todayTitle();
      const hasFreeform = !!freeformText.trim();
      const caseData = await createCase.mutateAsync({
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
        title: caseTitle,
        ...(hasFreeform ? { freeformInput: freeformText.trim() } : {}),
      });
      // Auto-trigger freeform extraction if user provided text
      if (hasFreeform) {
        triggerFreeform.mutate({
          caseId: caseData.id,
          profileId: activeProfileId,
          householdId: activeProfile.household_id,
          text: freeformText.trim(),
        });
      }
      router.replace(`/(main)/billing/${caseData.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      Alert.alert('Error', msg);
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
          <Text style={styles.busyText}>Creating your case...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={18} color={COLORS.primary.DEFAULT} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Start a New Bill</Text>
        </View>

        <View style={styles.body}>
          <TextInput
            style={styles.titleInput}
            placeholder="Name this bill (optional)"
            placeholderTextColor={COLORS.text.tertiary}
            value={title}
            onChangeText={setTitle}
            returnKeyType="next"
          />

          <TextInput
            style={styles.freeformInput}
            placeholder={"Tell us about this bill — or just tap Continue to start tracking it.\n\nExample: 'Got a $3,400 bill from Memorial Hospital for an ER visit on March 15. Insurance is Blue Cross, member ID 12345. I think I owe around $800.'"}
            placeholderTextColor={COLORS.text.tertiary}
            value={freeformText}
            onChangeText={setFreeformText}
            multiline
            textAlignVertical="top"
          />
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.continueButton}
            activeOpacity={0.7}
            onPress={handleContinue}
          >
            <Text style={styles.continueButtonText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: { flex: 1 },
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
    paddingTop: 8,
    paddingBottom: 16,
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

  // Body
  body: {
    flex: 1,
    paddingHorizontal: 24,
  },
  titleInput: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    paddingVertical: 12,
    marginBottom: 20,
  },
  freeformInput: {
    flex: 1,
    minHeight: 160,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 16,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    textAlignVertical: 'top',
  },

  // Footer
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  continueButton: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
});
