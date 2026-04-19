import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { bootstrapNewUser, resetPassword } from '@/services/auth';
import { logAuthEvent } from '@/services/securityAudit';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

type Mode = 'signin' | 'signup' | 'forgot';

export default function EmailAuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword('');
    setConfirmPassword('');
  }

  async function handleSignIn() {
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    logAuthEvent({
      eventType: 'sign_in_email',
      userId: data?.user?.id ?? null,
      detail: { success: !authError },
    });
    if (authError) setError(authError.message);
  }

  async function handleSignUp() {
    if (!name.trim() || !email || !password || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() } },
    });

    if (authError) {
      logAuthEvent({
        eventType: 'sign_up_email',
        userId: null,
        detail: { success: false },
      });
      setLoading(false);
      setError(authError.message);
      return;
    }

    if (data.user) {
      logAuthEvent({
        eventType: 'sign_up_email',
        userId: data.user.id,
        detail: { success: true },
      });
      const result = await bootstrapNewUser(data.user.id, name.trim());
      if (!result.success) {
        setLoading(false);
        setError('Account created but setup failed. Please sign in to retry.');
        return;
      }
    }

    setLoading(false);

    if (!data.session) {
      Alert.alert(
        'Check your email',
        'We sent you a confirmation link. Please verify your email to continue.',
      );
    }
  }

  async function handleForgot() {
    if (!email) {
      setError('Please enter your email address.');
      return;
    }
    setLoading(true);
    setError(null);
    const result = await resetPassword(email);
    setLoading(false);

    logAuthEvent({
      eventType: 'password_reset_requested',
      userId: null,
      detail: { success: result.success },
    });

    if (!result.success) {
      setError(result.error);
      return;
    }

    Alert.alert(
      'Check your email',
      'We sent you a password reset link. Follow the link to set a new password.',
      [{ text: 'OK', onPress: () => switchMode('signin') }],
    );
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

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {mode !== 'forgot' && (
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[styles.toggleBtn, mode === 'signin' && styles.toggleBtnActive]}
                onPress={() => switchMode('signin')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.toggleText,
                    mode === 'signin' && styles.toggleTextActive,
                  ]}
                >
                  Sign In
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleBtn, mode === 'signup' && styles.toggleBtnActive]}
                onPress={() => switchMode('signup')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.toggleText,
                    mode === 'signup' && styles.toggleTextActive,
                  ]}
                >
                  Sign Up
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {mode === 'signin' && (
            <>
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Sign in to your CareLead account.</Text>

              <Input
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
              <Input
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="password"
              />

              {error && <Text style={styles.error}>{error}</Text>}

              <View style={styles.buttonWrap}>
                <Button title="Sign In" size="lg" onPress={handleSignIn} loading={loading} />
              </View>

              <TouchableOpacity
                style={styles.inlineLink}
                onPress={() => switchMode('forgot')}
                activeOpacity={0.7}
              >
                <Text style={styles.inlineLinkText}>Forgot password?</Text>
              </TouchableOpacity>
            </>
          )}

          {mode === 'signup' && (
            <>
              <Text style={styles.title}>Create your account</Text>
              <Text style={styles.subtitle}>Start managing your care today.</Text>

              <Input
                label="Your name"
                placeholder="What should we call you?"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
              />
              <Input
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
              <Input
                label="Password"
                placeholder="At least 6 characters"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
              />
              <Input
                label="Confirm password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoComplete="new-password"
              />

              {error && <Text style={styles.error}>{error}</Text>}

              <View style={styles.buttonWrap}>
                <Button
                  title="Create Account"
                  size="lg"
                  onPress={handleSignUp}
                  loading={loading}
                />
              </View>
            </>
          )}

          {mode === 'forgot' && (
            <>
              <TouchableOpacity
                onPress={() => switchMode('signin')}
                style={styles.inlineBack}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="chevron-back"
                  size={16}
                  color={COLORS.primary.DEFAULT}
                />
                <Text style={styles.inlineBackText}>Back to sign in</Text>
              </TouchableOpacity>

              <Text style={styles.title}>Reset your password</Text>
              <Text style={styles.subtitle}>
                Enter the email tied to your account and we'll send you a reset link.
              </Text>

              <Input
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoFocus
              />

              {error && <Text style={styles.error}>{error}</Text>}

              <View style={styles.buttonWrap}>
                <Button
                  title="Send reset link"
                  size="lg"
                  onPress={handleForgot}
                  loading={loading}
                />
              </View>
            </>
          )}
        </ScrollView>

        <TouchableOpacity
          style={styles.phoneLink}
          onPress={() => router.replace('/(auth)/phone-entry')}
          activeOpacity={0.7}
        >
          <Text style={styles.phoneLinkText}>Use phone instead</Text>
        </TouchableOpacity>
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
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface.muted,
    borderRadius: 12,
    padding: 4,
    marginBottom: 32,
  },
  toggleBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  toggleBtnActive: {
    backgroundColor: COLORS.surface.DEFAULT,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  toggleText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  toggleTextActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
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
    marginBottom: 24,
    lineHeight: 22,
  },
  error: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error.DEFAULT,
    marginTop: 4,
    marginBottom: 4,
  },
  buttonWrap: {
    marginTop: 16,
  },
  inlineLink: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  inlineLinkText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  inlineBack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  inlineBackText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
    marginLeft: 2,
  },
  phoneLink: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  phoneLinkText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
