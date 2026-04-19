import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useLockStore } from '@/stores/lockStore';
import {
  getBiometricCapability,
  promptBiometric,
  clearBiometricPreferences,
  type BiometricCapability,
} from '@/services/biometric';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function AppLockScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const unlock = useLockStore((s) => s.unlock);

  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [failed, setFailed] = useState(false);
  const autoTriggeredRef = useRef(false);

  const displayName = (() => {
    const selfProfile =
      profiles.find((p) => p.id === activeProfileId) ??
      profiles.find((p) => p.relationship === 'self') ??
      profiles[0];
    if (selfProfile?.display_name) {
      return selfProfile.display_name.split(' ')[0];
    }
    const metaName = user?.user_metadata?.full_name as string | undefined;
    if (metaName) return metaName.split(' ')[0];
    return 'back';
  })();

  const handleUnlock = useCallback(async () => {
    if (authenticating) return;
    setAuthenticating(true);
    setFailed(false);
    const label = capability?.label ?? 'biometrics';
    const result = await promptBiometric(`Unlock CareLead with ${label}`);
    setAuthenticating(false);
    if (result.success) {
      unlock();
      router.replace('/(main)/(tabs)');
    } else {
      setFailed(true);
    }
  }, [authenticating, capability, router, unlock]);

  useEffect(() => {
    let cancelled = false;
    getBiometricCapability().then((cap) => {
      if (!cancelled) setCapability(cap);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-trigger biometric prompt shortly after mount
  useEffect(() => {
    if (!capability) return;
    if (autoTriggeredRef.current) return;
    if (!capability.available || !capability.enrolled) return;
    autoTriggeredRef.current = true;
    const timeout = setTimeout(() => {
      handleUnlock();
    }, 500);
    return () => clearTimeout(timeout);
  }, [capability, handleUnlock]);

  function handleUsePhone() {
    Alert.alert(
      'Re-authenticate',
      'Sign in again with your phone number to continue.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            await clearBiometricPreferences();
            unlock();
            await supabase.auth.signOut();
            router.replace('/(auth)/phone-entry');
          },
        },
      ],
    );
  }

  function handleSignOut() {
    Alert.alert('Sign out?', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await clearBiometricPreferences();
          unlock();
          await supabase.auth.signOut();
          router.replace('/(auth)');
        },
      },
    ]);
  }

  const iconName: keyof typeof Ionicons.glyphMap =
    capability?.kind === 'face'
      ? 'scan-outline'
      : capability?.kind === 'fingerprint'
        ? 'finger-print-outline'
        : 'lock-closed-outline';

  const actionLabel = capability
    ? `Unlock with ${capability.label}`
    : 'Unlock';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.logoWrap}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.welcome}>Welcome back, {displayName}</Text>
          <Text style={styles.subtitle}>
            Your health information is locked for your security.
          </Text>

          <TouchableOpacity
            style={styles.biometricButton}
            activeOpacity={0.8}
            onPress={handleUnlock}
            disabled={authenticating}
          >
            <Ionicons
              name={iconName}
              size={64}
              color={COLORS.primary.DEFAULT}
            />
          </TouchableOpacity>

          {failed ? (
            <Text style={styles.failedText}>
              Authentication failed. Try again.
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Button
            title={failed ? 'Try again' : actionLabel}
            size="lg"
            onPress={handleUnlock}
            loading={authenticating}
          />

          <TouchableOpacity
            style={styles.linkBtn}
            activeOpacity={0.7}
            onPress={handleUsePhone}
          >
            <Text style={styles.linkText}>Use phone number instead</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.signOutBtn}
            activeOpacity={0.7}
            onPress={handleSignOut}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingVertical: 32,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    overflow: 'hidden',
  },
  logo: {
    width: 72,
    height: 72,
  },
  welcome: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 40,
    paddingHorizontal: 16,
    lineHeight: 22,
  },
  biometricButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  failedText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    marginTop: 8,
  },
  actions: {
    gap: 12,
  },
  linkBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  linkText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  signOutBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  signOutText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
