import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/authStore';
import { setPinForUser, verifyPin } from '@/services/biometric';
import { logAuthEvent } from '@/services/securityAudit';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const PIN_LENGTH = 4;

type Step = 'current' | 'new' | 'confirm';

export default function SetupPinScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const user = useAuthStore((s) => s.user);
  const isChange = params.mode === 'change';

  const [step, setStep] = useState<Step>(isChange ? 'current' : 'new');
  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRefs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    const t = setTimeout(() => inputRefs.current[0]?.focus(), 150);
    return () => clearTimeout(t);
  }, [step]);

  function reset() {
    setDigits(Array(PIN_LENGTH).fill(''));
    inputRefs.current[0]?.focus();
  }

  async function handleComplete(pin: string) {
    if (!user?.id || busy) return;
    setBusy(true);
    setError(null);

    if (step === 'current') {
      const ok = await verifyPin(user.id, pin);
      setBusy(false);
      if (!ok) {
        setError('Incorrect PIN. Try again.');
        reset();
        return;
      }
      setStep('new');
      reset();
      return;
    }

    if (step === 'new') {
      setFirstPin(pin);
      setStep('confirm');
      reset();
      setBusy(false);
      return;
    }

    // confirm
    if (pin !== firstPin) {
      setError("PINs don't match. Please start over.");
      setFirstPin(null);
      setStep('new');
      reset();
      setBusy(false);
      return;
    }

    await setPinForUser(user.id, pin);
    logAuthEvent({
      eventType: 'pin_set',
      userId: user.id,
      detail: { mode: isChange ? 'change' : 'initial' },
    });
    setBusy(false);

    if (isChange) {
      router.back();
    } else {
      router.replace('/(main)/(tabs)');
    }
  }

  function handleChange(index: number, value: string) {
    const sanitized = value.replace(/\D/g, '');
    setError(null);

    if (sanitized.length > 1) {
      const next = Array(PIN_LENGTH).fill('');
      for (let i = 0; i < Math.min(sanitized.length, PIN_LENGTH); i++) {
        next[i] = sanitized[i];
      }
      setDigits(next);
      if (next.every((d) => d !== '')) {
        handleComplete(next.join(''));
      }
      return;
    }

    const next = [...digits];
    next[index] = sanitized;
    setDigits(next);

    if (sanitized && index < PIN_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    if (next.every((d) => d !== '')) {
      handleComplete(next.join(''));
    }
  }

  function handleKeyPress(
    index: number,
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const next = [...digits];
      next[index - 1] = '';
      setDigits(next);
    }
  }

  const title = (() => {
    if (step === 'current') return 'Enter current PIN';
    if (step === 'new') return isChange ? 'Set a new PIN' : 'Set a 4-digit PIN';
    return 'Confirm your PIN';
  })();

  const subtitle = (() => {
    if (step === 'current') return 'Enter your existing PIN to continue.';
    if (step === 'new') {
      return isChange
        ? 'Pick a new 4-digit PIN for unlocking CareLead.'
        : "This PIN will be used to unlock CareLead when Face ID isn't available.";
    }
    return 'Re-enter the PIN to confirm.';
  })();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.headerBar}>
          {isChange ? (
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={24} color={COLORS.text.DEFAULT} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.container}>
          <View style={styles.lockIcon}>
            <Ionicons
              name="lock-closed"
              size={32}
              color={COLORS.primary.DEFAULT}
            />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.pinRow}>
            {digits.map((digit, index) => (
              <TextInput
                key={`${step}-${index}`}
                ref={(r) => {
                  inputRefs.current[index] = r;
                }}
                value={digit}
                onChangeText={(v) => handleChange(index, v)}
                onKeyPress={(e) => handleKeyPress(index, e)}
                keyboardType="number-pad"
                maxLength={PIN_LENGTH}
                secureTextEntry
                style={[
                  styles.pinBox,
                  digit && styles.pinBoxFilled,
                  error && styles.pinBoxError,
                ]}
                selectTextOnFocus
                editable={!busy}
              />
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  flex: { flex: 1 },
  headerBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 48,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    alignItems: 'center',
  },
  lockIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 22,
    paddingHorizontal: 8,
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
  error: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error.DEFAULT,
    textAlign: 'center',
    marginTop: 8,
  },
});
