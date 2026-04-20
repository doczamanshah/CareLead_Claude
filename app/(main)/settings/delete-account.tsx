/**
 * Account deletion screen.
 *
 * Two-step confirmation:
 *   1. Warning screen explains what happens and asks the user to confirm.
 *   2. User types the word DELETE to unlock the final button.
 *
 * Backed by `deleteAccount()` in services/auth.ts, which calls the
 * `delete_user_account()` RPC and then signs the user out.
 */

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { deleteAccount } from '@/services/auth';
import { sanitizeErrorMessage } from '@/lib/utils/sanitizeError';

const CONFIRMATION_WORD = 'DELETE';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<'warn' | 'confirm'>('warn');
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  const canDelete = typedConfirmation.trim().toUpperCase() === CONFIRMATION_WORD;

  async function handleDelete() {
    if (!canDelete || deleting) return;
    setDeleting(true);
    const result = await deleteAccount({ queryClient });
    setDeleting(false);

    if (!result.success) {
      Alert.alert(
        'Could not delete account',
        sanitizeErrorMessage(result.error),
      );
      return;
    }

    router.replace('/(auth)/welcome');
  }

  const deleteButtonDisabled = !canDelete || deleting;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.navBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.navButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          disabled={deleting}
        >
          <Ionicons name="chevron-back" size={26} color={COLORS.primary.DEFAULT} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Delete Account</Text>
        <View style={styles.navButton} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.iconWrap}>
            <Ionicons
              name="warning-outline"
              size={48}
              color={COLORS.error.DEFAULT}
            />
          </View>

          {stage === 'warn' ? (
            <>
              <Text style={styles.title}>Delete your account?</Text>
              <Text style={styles.body}>
                This will permanently delete your account and all of your
                health data in CareLead. Medications, appointments, tasks,
                bills, results, preventive care, and documents will all be
                removed.
              </Text>
              <Text style={styles.body}>
                This action cannot be undone. Your data will be deleted
                within 30 days.
              </Text>
              <Text style={styles.bodySecondary}>
                If you share a household with another caregiver, only your
                access and the profiles you alone manage will be removed —
                profiles others also manage will remain with them.
              </Text>

              <TouchableOpacity
                style={styles.destructiveButton}
                onPress={() => setStage('confirm')}
                activeOpacity={0.8}
              >
                <Text style={styles.destructiveButtonText}>Delete My Account</Text>
              </TouchableOpacity>
              <View style={styles.cancelWrap}>
                <Button
                  title="Cancel"
                  onPress={() => router.back()}
                  variant="ghost"
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Are you absolutely sure?</Text>
              <Text style={styles.body}>
                Type <Text style={styles.emphasis}>{CONFIRMATION_WORD}</Text>{' '}
                below to confirm. This will permanently erase your data.
              </Text>

              <View style={styles.inputWrap}>
                <Input
                  value={typedConfirmation}
                  onChangeText={setTypedConfirmation}
                  placeholder={CONFIRMATION_WORD}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  returnKeyType="done"
                  editable={!deleting}
                />
              </View>

              <TouchableOpacity
                style={[
                  styles.destructiveButton,
                  deleteButtonDisabled && styles.destructiveButtonDisabled,
                ]}
                onPress={handleDelete}
                activeOpacity={0.8}
                disabled={deleteButtonDisabled}
              >
                {deleting ? (
                  <ActivityIndicator color={COLORS.text.inverse} />
                ) : (
                  <Text style={styles.destructiveButtonText}>
                    Confirm Deletion
                  </Text>
                )}
              </TouchableOpacity>
              <View style={styles.cancelWrap}>
                <Button
                  title="Cancel"
                  onPress={() => router.back()}
                  variant="ghost"
                  disabled={deleting}
                />
              </View>
            </>
          )}
        </ScrollView>
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
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.surface.DEFAULT,
    borderBottomColor: COLORS.border.DEFAULT,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navButton: {
    width: 40,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  navTitle: {
    flex: 1,
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 48,
  },
  iconWrap: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
    marginBottom: 16,
  },
  bodySecondary: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
    marginBottom: 24,
  },
  emphasis: {
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.error.DEFAULT,
  },
  inputWrap: {
    marginBottom: 24,
  },
  destructiveButton: {
    backgroundColor: COLORS.error.DEFAULT,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  destructiveButtonDisabled: {
    opacity: 0.5,
  },
  destructiveButtonText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  cancelWrap: {
    marginTop: 8,
  },
});
