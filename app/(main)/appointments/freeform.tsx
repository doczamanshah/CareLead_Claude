import { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  type TextInput as RNTextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useExtractAppointment } from '@/hooks/useAppointments';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const HINT_CHIPS: { label: string; prompt: string }[] = [
  { label: 'Who with?', prompt: 'The appointment is with ' },
  { label: 'Where?', prompt: 'It is at ' },
  { label: 'When?', prompt: 'The appointment is on ' },
  { label: 'What for?', prompt: "It's for " },
  { label: "Who's coming?", prompt: 'Coming with me: ' },
  { label: 'How getting there?', prompt: 'Getting there by ' },
];

const PLACEHOLDER_TEXT =
  "Tell us about your appointment — for example:\n\n" +
  "\"I have a follow-up with Dr. Iqbal at SPC clinic tomorrow at 10am for my blood pressure check. My daughter Sarah is driving me.\"";

export default function FreeformAppointmentScreen() {
  const router = useRouter();
  const { activeProfile } = useActiveProfile();
  const extract = useExtractAppointment();
  const inputRef = useRef<RNTextInput | null>(null);

  const [text, setText] = useState('');

  const appendPrompt = (prompt: string) => {
    const prefix = text.length > 0 && !text.endsWith('\n') ? '\n\n' : '';
    const next = `${text}${prefix}${prompt}`;
    setText(next);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleContinue = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      Alert.alert(
        'Tell us a little first',
        "Describe the appointment in your own words, or tap Enter Details for manual entry.",
      );
      return;
    }
    try {
      const result = await extract.mutateAsync({
        text: trimmed,
        profileName: activeProfile?.display_name ?? null,
      });
      router.replace({
        pathname: '/(main)/appointments/review',
        params: {
          extracted: JSON.stringify(result),
          freeform: trimmed,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      Alert.alert(
        "We couldn't understand that",
        msg,
        [
          {
            text: 'Try again',
            style: 'default',
          },
          {
            text: 'Enter details manually',
            onPress: () => router.replace('/(main)/appointments/manual-create'),
          },
        ],
      );
    }
  };

  if (extract.isPending) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
          <Text style={styles.busyText}>Understanding your appointment...</Text>
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
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={COLORS.primary.DEFAULT}
            />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>New Appointment</Text>
          <Text style={styles.subtitle}>
            Describe it in your own words. Tap the mic on your keyboard to
            dictate.
          </Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            ref={inputRef}
            style={styles.freeformInput}
            placeholder={PLACEHOLDER_TEXT}
            placeholderTextColor={COLORS.text.tertiary}
            value={text}
            onChangeText={setText}
            multiline
            textAlignVertical="top"
            autoFocus
          />

          <Text style={styles.hintLabel}>Need a prompt?</Text>
          <View style={styles.chipWrap}>
            {HINT_CHIPS.map((chip) => (
              <TouchableOpacity
                key={chip.label}
                style={styles.chip}
                activeOpacity={0.7}
                onPress={() => appendPrompt(chip.prompt)}
              >
                <Text style={styles.chipText}>{chip.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.continueButton,
              !text.trim() && styles.continueButtonDisabled,
            ]}
            activeOpacity={0.7}
            onPress={handleContinue}
            disabled={!text.trim()}
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
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
    lineHeight: 20,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  freeformInput: {
    minHeight: 180,
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

  hintLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.tertiary,
    marginTop: 20,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  chipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },

  footer: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    backgroundColor: COLORS.background.DEFAULT,
  },
  continueButton: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonDisabled: {
    opacity: 0.5,
  },
  continueButtonText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
});
