import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { fetchUserProfiles } from '@/services/profiles';
import { updateUserDisplayName } from '@/services/auth';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function CollectNameScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setProfiles = useProfileStore((s) => s.setProfiles);

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshProfiles() {
    if (!user) return;
    try {
      const refreshed = await fetchUserProfiles(user.id);
      if (refreshed.success) setProfiles(refreshed.data);
    } catch (err) {
      console.log('[collect-name] profile refresh failed', err);
    }
  }

  async function handleContinue() {
    if (!user || saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter your name to continue.');
      return;
    }

    setSaving(true);
    setError(null);

    console.log('[collect-name] saving name');
    try {
      const result = await updateUserDisplayName(user.id, trimmed);
      if (!result.success) {
        console.log('[collect-name] update returned error:', result.error);
      } else {
        console.log('[collect-name] update succeeded');
      }
    } catch (err) {
      console.log('[collect-name] unexpected error while saving name', err);
      Alert.alert(
        'Heads up',
        "We couldn't save your name right now, but you can set it later in Settings.",
      );
    }

    await refreshProfiles();

    console.log('[collect-name] navigating to onboarding');
    router.replace('/(auth)/onboarding');
  }

  async function handleSkip() {
    if (saving) return;
    setSaving(true);
    console.log('[collect-name] skipped, navigating to onboarding');
    await refreshProfiles();
    router.replace('/(auth)/onboarding');
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.container}>
          <View>
            <Text style={styles.title}>Welcome to CareLead!</Text>
            <Text style={styles.subtitle}>What should we call you?</Text>

            <View style={styles.inputWrap}>
              <Input
                label="Your name"
                placeholder="e.g., Alex Rivera"
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  setError(null);
                }}
                autoCapitalize="words"
                autoComplete="name"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleContinue}
                error={error ?? undefined}
              />
            </View>

            <Button
              title="Continue"
              size="lg"
              onPress={handleContinue}
              loading={saving}
            />
          </View>

          <TouchableOpacity
            style={styles.skipBtn}
            onPress={handleSkip}
            activeOpacity={0.7}
            disabled={saving}
          >
            <Text style={styles.skipText}>Skip for now</Text>
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
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: FONT_SIZES['3xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.text.secondary,
    marginBottom: 32,
  },
  inputWrap: {
    marginBottom: 8,
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
