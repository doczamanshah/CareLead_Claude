import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useLockStore } from '@/stores/lockStore';
import {
  getBiometricCapability,
  promptBiometric,
  isPinSetForUser,
  verifyPin,
  incrementPinAttempts,
  resetPinAttempts,
  MAX_PIN_ATTEMPTS,
  type BiometricCapability,
} from '@/services/biometric';
import { cleanupOnSignOut } from '@/services/auth';
import { logAuthEvent } from '@/services/securityAudit';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const PIN_LENGTH = 4;

type Mode = 'biometric' | 'pin';

export default function AppLockScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const unlock = useLockStore((s) => s.unlock);

  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pinDigits, setPinDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [pinError, setPinError] = useState<string | null>(null);
  const autoTriggeredRef = useRef(false);
  const pinInputRefs = useRef<Array<TextInput | null>>([]);

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

  const biometricAvailable =
    capability?.available === true && capability?.enrolled === true;

  // Initial capability + PIN probe
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cap = await getBiometricCapability();
      const pin = user?.id ? await isPinSetForUser(user.id) : false;
      if (cancelled) return;
      setCapability(cap);
      setHasPin(pin);
      const bioAvail = cap.available && cap.enrolled;
      setMode(bioAvail ? 'biometric' : pin ? 'pin' : 'biometric');
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleBiometricUnlock = useCallback(async () => {
    if (authenticating || !capability) return;
    setAuthenticating(true);
    setFailed(false);
    const label = capability.label ?? 'biometrics';
    const result = await promptBiometric(`Unlock CareLead with ${label}`);
    setAuthenticating(false);
    if (result.success) {
      logAuthEvent({
        eventType: 'biometric_unlock',
        userId: user?.id ?? null,
        detail: { kind: capability.kind },
      });
      unlock();
      router.replace('/(main)/(tabs)');
    } else {
      logAuthEvent({
        eventType: 'biometric_failed',
        userId: user?.id ?? null,
        detail: { kind: capability.kind, error: result.error ?? 'unknown' },
      });
      setFailed(true);
    }
  }, [authenticating, capability, router, unlock, user?.id]);

  // Auto-trigger biometric prompt shortly after mount (biometric mode only)
  useEffect(() => {
    if (mode !== 'biometric') return;
    if (!capability) return;
    if (autoTriggeredRef.current) return;
    if (!biometricAvailable) return;
    autoTriggeredRef.current = true;
    const timeout = setTimeout(() => {
      handleBiometricUnlock();
    }, 500);
    return () => clearTimeout(timeout);
  }, [mode, capability, biometricAvailable, handleBiometricUnlock]);

  // Focus PIN on mode switch
  useEffect(() => {
    if (mode === 'pin') {
      const t = setTimeout(() => pinInputRefs.current[0]?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [mode]);

  async function handlePinComplete(pin: string) {
    if (!user?.id || authenticating) return;
    setAuthenticating(true);
    setPinError(null);

    const ok = await verifyPin(user.id, pin);
    if (ok) {
      await resetPinAttempts();
      logAuthEvent({ eventType: 'pin_unlock', userId: user.id });
      setAuthenticating(false);
      unlock();
      router.replace('/(main)/(tabs)');
      return;
    }

    const attempts = await incrementPinAttempts();
    logAuthEvent({
      eventType: 'pin_failed',
      userId: user.id,
      detail: { attempts },
    });

    if (attempts >= MAX_PIN_ATTEMPTS) {
      logAuthEvent({ eventType: 'pin_lockout', userId: user.id });
      setAuthenticating(false);
      Alert.alert(
        'Too many attempts',
        'For your security, you have been signed out. Sign in again to continue.',
        [
          {
            text: 'OK',
            onPress: async () => {
              unlock();
              await cleanupOnSignOut({
                queryClient,
                logAudit: false,
                reason: 'pin_lockout',
              });
              router.replace('/(auth)');
            },
          },
        ],
      );
      return;
    }

    const remaining = MAX_PIN_ATTEMPTS - attempts;
    setPinError(
      remaining === 1
        ? 'Incorrect PIN. 1 attempt left.'
        : `Incorrect PIN. ${remaining} attempts left.`,
    );
    setPinDigits(Array(PIN_LENGTH).fill(''));
    pinInputRefs.current[0]?.focus();
    setAuthenticating(false);
  }

  function handlePinChange(index: number, value: string) {
    const sanitized = value.replace(/\D/g, '');
    setPinError(null);

    if (sanitized.length > 1) {
      const next = Array(PIN_LENGTH).fill('');
      for (let i = 0; i < Math.min(sanitized.length, PIN_LENGTH); i++) {
        next[i] = sanitized[i];
      }
      setPinDigits(next);
      if (next.every((d) => d !== '')) {
        handlePinComplete(next.join(''));
      }
      return;
    }

    const next = [...pinDigits];
    next[index] = sanitized;
    setPinDigits(next);

    if (sanitized && index < PIN_LENGTH - 1) {
      pinInputRefs.current[index + 1]?.focus();
    }

    if (next.every((d) => d !== '')) {
      handlePinComplete(next.join(''));
    }
  }

  function handlePinKeyPress(
    index: number,
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) {
    if (e.nativeEvent.key === 'Backspace' && !pinDigits[index] && index > 0) {
      pinInputRefs.current[index - 1]?.focus();
      const next = [...pinDigits];
      next[index - 1] = '';
      setPinDigits(next);
    }
  }

  function handleUsePhone() {
    Alert.alert(
      'Re-authenticate',
      'Sign in again with your phone number to continue.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            unlock();
            await cleanupOnSignOut({ queryClient, reason: 'user_reauth' });
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
          unlock();
          await cleanupOnSignOut({ queryClient });
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

  if (mode === 'pin') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <View style={styles.container}>
            <View style={styles.hero}>
              <View style={styles.logoWrap}>
                <Ionicons
                  name="lock-closed"
                  size={40}
                  color={COLORS.primary.DEFAULT}
                />
              </View>
              <Text style={styles.welcome}>Welcome back, {displayName}</Text>
              <Text style={styles.subtitle}>Enter your PIN to unlock CareLead.</Text>

              <View style={styles.pinRow}>
                {pinDigits.map((digit, index) => (
                  <TextInput
                    key={index}
                    ref={(r) => {
                      pinInputRefs.current[index] = r;
                    }}
                    value={digit}
                    onChangeText={(v) => handlePinChange(index, v)}
                    onKeyPress={(e) => handlePinKeyPress(index, e)}
                    keyboardType="number-pad"
                    maxLength={PIN_LENGTH}
                    secureTextEntry
                    style={[
                      styles.pinBox,
                      digit && styles.pinBoxFilled,
                      pinError && styles.pinBoxError,
                    ]}
                    selectTextOnFocus
                    editable={!authenticating}
                  />
                ))}
              </View>

              {pinError ? <Text style={styles.failedText}>{pinError}</Text> : null}
            </View>

            <View style={styles.actions}>
              {biometricAvailable ? (
                <TouchableOpacity
                  style={styles.linkBtn}
                  activeOpacity={0.7}
                  onPress={() => {
                    setPinError(null);
                    setPinDigits(Array(PIN_LENGTH).fill(''));
                    setMode('biometric');
                    autoTriggeredRef.current = false;
                  }}
                >
                  <Text style={styles.linkText}>
                    Use {capability?.label ?? 'biometrics'} instead
                  </Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={styles.linkBtn}
                activeOpacity={0.7}
                onPress={handleUsePhone}
              >
                <Text style={styles.linkTextSubtle}>Forgot PIN?</Text>
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
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

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
            onPress={handleBiometricUnlock}
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
            onPress={handleBiometricUnlock}
            loading={authenticating}
          />

          {hasPin ? (
            <TouchableOpacity
              style={styles.linkBtn}
              activeOpacity={0.7}
              onPress={() => setMode('pin')}
            >
              <Text style={styles.linkText}>Use PIN instead</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.linkBtn}
            activeOpacity={0.7}
            onPress={handleUsePhone}
          >
            <Text style={styles.linkTextSubtle}>Use phone number instead</Text>
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
  flex: { flex: 1 },
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
  pinRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  pinBox: {
    width: 56,
    height: 64,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1.5,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    textAlign: 'center',
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  pinBoxFilled: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '08',
  },
  pinBoxError: {
    borderColor: COLORS.error.DEFAULT,
  },
  failedText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    marginTop: 8,
    textAlign: 'center',
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
  linkTextSubtle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
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
