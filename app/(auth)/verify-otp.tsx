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
import { sendPhoneOtp, verifyPhoneOtp } from '@/services/auth';
import { logAuthEvent } from '@/services/securityAudit';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

export default function VerifyOtpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone?: string; display?: string }>();
  const phone = typeof params.phone === 'string' ? params.phone : '';
  const display = typeof params.display === 'string' ? params.display : phone;

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const [resending, setResending] = useState(false);

  const inputRefs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    const timer = setInterval(() => {
      setResendIn((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => inputRefs.current[0]?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  function handleChange(index: number, value: string) {
    const sanitized = value.replace(/\D/g, '');
    setError(null);

    if (sanitized.length > 1) {
      // Paste or auto-fill of full code
      const next = Array(OTP_LENGTH).fill('');
      for (let i = 0; i < Math.min(sanitized.length, OTP_LENGTH); i++) {
        next[i] = sanitized[i];
      }
      setDigits(next);
      const lastFilled = Math.min(sanitized.length, OTP_LENGTH) - 1;
      inputRefs.current[Math.min(lastFilled + 1, OTP_LENGTH - 1)]?.focus();
      if (next.every((d) => d !== '')) {
        submit(next.join(''));
      }
      return;
    }

    const next = [...digits];
    next[index] = sanitized;
    setDigits(next);

    if (sanitized && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    if (next.every((d) => d !== '')) {
      submit(next.join(''));
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

  async function submit(code: string) {
    if (verifying) return;
    setVerifying(true);
    setError(null);
    const result = await verifyPhoneOtp(phone, code);
    setVerifying(false);

    if (!result.success) {
      logAuthEvent({
        eventType: 'otp_failed',
        userId: null,
        detail: { channel: 'sms' },
      });
      setError('Invalid code. Please try again.');
      setDigits(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
      return;
    }

    const userId = result.data.user?.id ?? null;
    const hasName = Boolean(result.data.user?.user_metadata?.full_name);
    logAuthEvent({
      eventType: 'otp_verified',
      userId,
      detail: { channel: 'sms' },
    });
    logAuthEvent({
      eventType: hasName ? 'sign_in_phone' : 'sign_up_phone',
      userId,
      detail: { channel: 'sms' },
    });

    if (hasName) {
      // Returning user — AuthGate will route to home once profiles load
      return;
    }

    router.replace('/(auth)/collect-name');
  }

  async function handleResend() {
    if (resendIn > 0 || resending) return;
    setResending(true);
    setError(null);
    const result = await sendPhoneOtp(phone);
    setResending(false);

    logAuthEvent({
      eventType: 'otp_requested',
      userId: null,
      detail: { channel: 'sms', resend: true, success: result.success },
    });

    if (!result.success) {
      setError('Could not resend the code. Please try again.');
      return;
    }

    setResendIn(RESEND_SECONDS);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.headerBar}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={COLORS.text.DEFAULT} />
          </TouchableOpacity>
        </View>

        <View style={styles.container}>
          <Text style={styles.title}>Enter your code</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to <Text style={styles.phoneText}>{display}</Text>
          </Text>

          <View style={styles.otpRow}>
            {digits.map((digit, index) => (
              <TextInput
                key={index}
                ref={(r) => {
                  inputRefs.current[index] = r;
                }}
                value={digit}
                onChangeText={(v) => handleChange(index, v)}
                onKeyPress={(e) => handleKeyPress(index, e)}
                keyboardType="number-pad"
                maxLength={OTP_LENGTH}
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                style={[styles.otpBox, digit && styles.otpBoxFilled, error && styles.otpBoxError]}
                selectTextOnFocus
                editable={!verifying}
              />
            ))}
          </View>

          {verifying && (
            <Text style={styles.verifyingText}>Verifying…</Text>
          )}
          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            onPress={handleResend}
            disabled={resendIn > 0 || resending}
            style={styles.resendBtn}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.resendText,
                resendIn > 0 && styles.resendTextDisabled,
              ]}
            >
              {resendIn > 0
                ? `Resend code in ${resendIn}s`
                : resending
                  ? 'Sending…'
                  : 'Resend code'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.changeBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.changeText}>Change number</Text>
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
  headerBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
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
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    marginBottom: 32,
    lineHeight: 22,
  },
  phoneText: {
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 16,
  },
  otpBox: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 56,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1.5,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    textAlign: 'center',
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  otpBoxFilled: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '08',
  },
  otpBoxError: {
    borderColor: COLORS.error.DEFAULT,
  },
  verifyingText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginTop: 8,
  },
  error: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error.DEFAULT,
    textAlign: 'center',
    marginTop: 8,
  },
  resendBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 16,
  },
  resendText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  resendTextDisabled: {
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  changeBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  changeText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
