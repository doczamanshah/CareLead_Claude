import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateNoteArtifact } from '@/hooks/useArtifacts';
import { useTriggerExtraction } from '@/hooks/useIntentSheet';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const EXAMPLE_PROMPTS = [
  'After my visit today...',
  'My medications are...',
  "I'm allergic to...",
  'My doctor said...',
];

export default function VoiceScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const createNoteMutation = useCreateNoteArtifact();
  const extractionMutation = useTriggerExtraction();

  const [transcript, setTranscript] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
  const hasText = transcript.trim().length > 0;

  // Track keyboard visibility for showing/hiding example prompts
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setIsKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setIsKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  function handleClear() {
    Alert.alert('Clear Text', 'Discard your current text?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setTranscript('');
          inputRef.current?.focus();
        },
      },
    ]);
  }

  function handlePromptTap(prompt: string) {
    setTranscript(prompt);
    inputRef.current?.focus();
  }

  async function handleExtract() {
    if (!hasText || !activeProfileId) return;

    Keyboard.dismiss();
    setIsSaving(true);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const title = `voice-note-${timestamp}`;

      const artifact = await createNoteMutation.mutateAsync({
        profileId: activeProfileId,
        title,
        text: transcript.trim(),
        sourceChannel: 'voice',
      });

      try {
        const extraction = await extractionMutation.mutateAsync({
          artifactId: artifact.id,
          profileId: activeProfileId,
        });

        if (extraction.intentSheetId) {
          router.replace(`/(main)/intent-sheet/${extraction.intentSheetId}`);
          return;
        }
      } catch {
        // Extraction can be retried — don't block navigation
      }

      router.replace('/(main)/(tabs)/documents');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      Alert.alert('Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <View style={styles.content}>
          {/* Minimal header */}
          <View style={styles.header}>
            <Text style={styles.title}>Voice Note</Text>
            <Text style={styles.subtitle}>
              Speak using the mic button on your keyboard, or type directly.
            </Text>
          </View>

          {/* Single text area with inline clear button */}
          <View style={styles.inputWrapper}>
            {hasText && (
              <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
                <Text style={styles.clearButtonText}>Clear</Text>
              </TouchableOpacity>
            )}
            <TextInput
              ref={inputRef}
              style={styles.textInput}
              value={transcript}
              onChangeText={setTranscript}
              placeholder="Tap here and speak or type your health info..."
              placeholderTextColor={COLORS.text.tertiary}
              multiline
              textAlignVertical="top"
              autoFocus={false}
              returnKeyType="default"
              blurOnSubmit={false}
            />
          </View>

          {/* Word count */}
          <Text style={styles.wordCount}>
            {hasText ? `${wordCount} ${wordCount === 1 ? 'word' : 'words'}` : ' '}
          </Text>

          {/* Example prompts — only when keyboard is hidden and no text entered */}
          {!isKeyboardVisible && !hasText && (
            <View style={styles.promptsSection}>
              <Text style={styles.promptsLabel}>Try saying something like:</Text>
              <View style={styles.promptsRow}>
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <TouchableOpacity
                    key={prompt}
                    style={styles.promptChip}
                    onPress={() => handlePromptTap(prompt)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.promptChipText}>{prompt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Spacer pushes button to bottom */}
          <View style={styles.flex} />
        </View>

        {/* Floating extract button — always visible above keyboard */}
        <View style={styles.bottomBar}>
          <Button
            title="Extract Health Info"
            onPress={handleExtract}
            loading={isSaving}
            disabled={!hasText || !activeProfileId}
            size="lg"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  inputWrapper: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    minHeight: 220,
    position: 'relative',
  },
  clearButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.surface.muted,
  },
  clearButtonText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  textInput: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    padding: 16,
    paddingTop: 16,
    paddingRight: 70,
    minHeight: 220,
    lineHeight: 24,
  },
  wordCount: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textAlign: 'right',
    marginTop: 8,
    marginBottom: 4,
  },
  promptsSection: {
    marginTop: 16,
  },
  promptsLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginBottom: 10,
  },
  promptsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  promptChip: {
    backgroundColor: COLORS.primary.DEFAULT + '0A',
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '20',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  promptChipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    backgroundColor: COLORS.background.DEFAULT,
  },
});
