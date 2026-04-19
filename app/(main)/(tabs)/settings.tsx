import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Alert,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { useCareGuidanceLevel, useWeeklyDigest } from '@/hooks/usePreferences';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { usePatientPriorities } from '@/hooks/usePatientPriorities';
import {
  useLastReviewedAt,
  useReviewFrequency,
  useSetReviewFrequency,
} from '@/hooks/useProfileReview';
import { useAuthStore } from '@/stores/authStore';
import type { ReviewFrequency } from '@/lib/types/profile';
import {
  autoLockLabel,
  clearPin,
  disableBiometric,
  enableBiometricForUser,
  getAutoLockSetting,
  getBiometricCapability,
  getSessionDuration,
  isBiometricEnabledForUser,
  isPinSetForUser,
  promptBiometric,
  setAutoLockSetting,
  sessionDurationLabel,
  setSessionDuration,
  verifyPin,
  type AutoLockSetting,
  type BiometricCapability,
  type SessionDuration,
} from '@/services/biometric';
import { cleanupOnSignOut } from '@/services/auth';
import { logAuthEvent } from '@/services/securityAudit';
import type { CareGuidanceLevel } from '@/services/commit';

const GUIDANCE_OPTIONS: {
  key: CareGuidanceLevel;
  label: string;
  description: string;
}[] = [
  {
    key: 'essentials',
    label: 'Just the essentials',
    description: 'Only critical tasks — for experienced patients/caregivers who know the drill.',
  },
  {
    key: 'balanced',
    label: 'Balanced',
    description: 'Critical + important tasks. The recommended default.',
  },
  {
    key: 'comprehensive',
    label: 'Comprehensive',
    description: 'All tasks including helpful suggestions like research and organizing.',
  },
];

const AUTO_LOCK_OPTIONS: { key: AutoLockSetting; label: string }[] = [
  { key: '30', label: '30 seconds' },
  { key: '60', label: '1 minute' },
  { key: '300', label: '5 minutes' },
  { key: 'never', label: 'Never' },
];

const SESSION_DURATION_OPTIONS: { key: SessionDuration; label: string }[] = [
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
];

const REVIEW_FREQUENCY_OPTIONS: { key: ReviewFrequency; label: string }[] = [
  { key: 'quarterly', label: 'Every 3 months' },
  { key: 'biannual', label: 'Every 6 months' },
  { key: 'never', label: 'Never' },
];

function formatLastReviewed(iso: string | null | undefined): string {
  if (!iso) return 'Never reviewed';
  const date = new Date(iso);
  return `Last reviewed ${date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

function formatPriorityUpdate(iso: string | null | undefined): string {
  if (!iso) return 'Just now';
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'Recently';
  const diffDays = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Updated today';
  if (diffDays === 1) return 'Updated yesterday';
  if (diffDays < 7) return `Updated ${diffDays}d ago`;
  if (diffDays < 30) return `Updated ${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `Updated ${Math.floor(diffDays / 30)}mo ago`;
  return `Updated ${Math.floor(diffDays / 365)}y ago`;
}

export default function SettingsScreen() {
  const { level, setLevel, isUpdating } = useCareGuidanceLevel();
  const { enabled: weeklyDigestEnabled, setEnabled: setWeeklyDigest } = useWeeklyDigest();
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeProfileId } = useActiveProfile();
  const { data: lastReviewedAt } = useLastReviewedAt(activeProfileId);
  const { data: priorities } = usePatientPriorities(activeProfileId);
  const hasPriorities =
    !!priorities &&
    (priorities.health_priorities.length > 0 ||
      priorities.friction_points.length > 0 ||
      priorities.conditions_of_focus.length > 0);
  const priorityPreview = hasPriorities
    ? priorities!.health_priorities
        .slice(0, 2)
        .map((hp) => hp.topic)
        .join(', ')
    : null;
  const { data: reviewFrequency } = useReviewFrequency();
  const setFrequencyMutation = useSetReviewFrequency();
  const [showReviewFrequencyOptions, setShowReviewFrequencyOptions] = useState(false);

  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(true);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [pinSet, setPinSet] = useState(false);
  const [autoLock, setAutoLock] = useState<AutoLockSetting>('30');
  const [showAutoLockOptions, setShowAutoLockOptions] = useState(false);
  const [sessionDuration, setSessionDurationState] = useState<SessionDuration>('7d');
  const [showSessionDurationOptions, setShowSessionDurationOptions] = useState(false);

  const loadSecurityState = useCallback(async () => {
    const [cap, enabled, lockSetting, pin, duration] = await Promise.all([
      getBiometricCapability(),
      user?.id ? isBiometricEnabledForUser(user.id) : Promise.resolve(false),
      getAutoLockSetting(),
      user?.id ? isPinSetForUser(user.id) : Promise.resolve(false),
      getSessionDuration(),
    ]);
    setCapability(cap);
    setBiometricEnabled(enabled);
    setAutoLock(lockSetting);
    setPinSet(pin);
    setSessionDurationState(duration);
    setBiometricLoading(false);
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadSecurityState();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSecurityState]);

  // Re-probe PIN state after the user returns from setup-pin screen.
  useFocusEffect(
    useCallback(() => {
      loadSecurityState();
    }, [loadSecurityState]),
  );

  async function handleToggleBiometric(next: boolean) {
    if (!user?.id || biometricBusy || !capability) return;
    const label = capability.label;

    if (next) {
      setBiometricBusy(true);
      const result = await promptBiometric(`Enable ${label} for CareLead`);
      if (result.success) {
        await enableBiometricForUser(user.id);
        setBiometricEnabled(true);
      } else if (result.error && result.error !== 'user_cancel' && result.error !== 'cancelled') {
        Alert.alert(
          `Could not enable ${label}`,
          `Error: ${result.error}\n\nMake sure ${label} is set up in your device Settings and that CareLead has permission to use it.`,
        );
      }
      setBiometricBusy(false);
      return;
    }

    // Disabling — require biometric verification
    setBiometricBusy(true);
    const result = await promptBiometric(`Verify ${label} to turn off app lock`);
    if (result.success) {
      await disableBiometric();
      setBiometricEnabled(false);
    } else {
      Alert.alert(
        'Could not disable',
        `${label} verification is required to turn off app lock.${result.error ? `\n\nError: ${result.error}` : ''}`,
      );
    }
    setBiometricBusy(false);
  }

  async function handlePickAutoLock(value: AutoLockSetting) {
    setAutoLock(value);
    setShowAutoLockOptions(false);
    await setAutoLockSetting(value);
  }

  async function handlePickSessionDuration(value: SessionDuration) {
    setSessionDurationState(value);
    setShowSessionDurationOptions(false);
    await setSessionDuration(value);
  }

  function handleSetPin() {
    router.push('/(auth)/setup-pin');
  }

  function handleChangePin() {
    router.push({ pathname: '/(auth)/setup-pin', params: { mode: 'change' } });
  }

  function promptForPin(
    title: string,
    message: string,
    onVerified: () => void,
  ) {
    if (!user?.id) return;
    Alert.prompt(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async (pin?: string) => {
            if (!pin) return;
            const ok = await verifyPin(user.id, pin);
            if (!ok) {
              Alert.alert('Incorrect PIN', 'Please try again.');
              return;
            }
            onVerified();
          },
        },
      ],
      'secure-text',
    );
  }

  function handleRemovePin() {
    if (!user?.id) return;
    promptForPin(
      'Remove PIN',
      'Enter your current PIN to confirm removal.',
      async () => {
        await clearPin();
        logAuthEvent({ eventType: 'pin_removed', userId: user.id });
        setPinSet(false);
      },
    );
  }

  async function handleSignOut() {
    Alert.alert('Sign out?', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await cleanupOnSignOut({ queryClient });
        },
      },
    ]);
  }

  const securityAvailable = !!capability?.available && !!capability?.enrolled;
  const biometricLabel = capability?.label ?? 'Biometrics';

  return (
    <ScreenLayout title="Settings">
      {/* Security Section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Security</Text>
        <Card>
          <View style={styles.toggleRow}>
            <View style={styles.toggleContent}>
              <Text style={styles.toggleLabel}>{biometricLabel}</Text>
              <Text style={styles.toggleDescription}>
                {securityAvailable
                  ? `Require ${biometricLabel} to unlock CareLead.`
                  : capability && !capability.available
                    ? 'Not available on this device.'
                    : 'Set up Face ID or Touch ID in device settings to enable.'}
              </Text>
            </View>
            {biometricLoading ? (
              <ActivityIndicator color={COLORS.primary.DEFAULT} />
            ) : biometricBusy ? (
              <ActivityIndicator color={COLORS.primary.DEFAULT} />
            ) : (
              <Switch
                value={biometricEnabled}
                onValueChange={handleToggleBiometric}
                disabled={!securityAvailable}
                trackColor={{ false: COLORS.border.dark, true: COLORS.primary.light }}
                thumbColor={biometricEnabled ? COLORS.primary.DEFAULT : COLORS.surface.DEFAULT}
              />
            )}
          </View>
        </Card>

        {biometricEnabled && securityAvailable ? (
          <View style={styles.autoLockWrap}>
            <TouchableOpacity
              style={styles.autoLockRow}
              activeOpacity={0.7}
              onPress={() => setShowAutoLockOptions((v) => !v)}
            >
              <View style={styles.autoLockContent}>
                <Text style={styles.autoLockLabel}>Auto-Lock</Text>
                <Text style={styles.autoLockValue}>
                  Lock after {autoLockLabel(autoLock)}
                </Text>
              </View>
              <Ionicons
                name={showAutoLockOptions ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={COLORS.text.tertiary}
              />
            </TouchableOpacity>

            {showAutoLockOptions ? (
              <View style={styles.autoLockOptions}>
                {AUTO_LOCK_OPTIONS.map((opt) => {
                  const selected = autoLock === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[
                        styles.autoLockOption,
                        selected && styles.autoLockOptionSelected,
                      ]}
                      onPress={() => handlePickAutoLock(opt.key)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.autoLockOptionText,
                          selected && styles.autoLockOptionTextSelected,
                        ]}
                      >
                        {opt.label}
                      </Text>
                      {selected ? (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={COLORS.primary.DEFAULT}
                        />
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* PIN management */}
        {!biometricLoading ? (
          <View style={styles.pinWrap}>
            {pinSet ? (
              <>
                <TouchableOpacity
                  style={styles.autoLockRow}
                  activeOpacity={0.7}
                  onPress={handleChangePin}
                >
                  <View style={styles.autoLockContent}>
                    <Text style={styles.autoLockLabel}>Change PIN</Text>
                    <Text style={styles.autoLockValue}>
                      Update your 4-digit unlock PIN
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={COLORS.text.tertiary}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.autoLockRow, styles.pinRemoveRow]}
                  activeOpacity={0.7}
                  onPress={handleRemovePin}
                >
                  <View style={styles.autoLockContent}>
                    <Text style={[styles.autoLockLabel, styles.pinRemoveLabel]}>
                      Remove PIN
                    </Text>
                    <Text style={styles.autoLockValue}>
                      Turn off PIN unlock
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={COLORS.text.tertiary}
                  />
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={styles.autoLockRow}
                activeOpacity={0.7}
                onPress={handleSetPin}
              >
                <View style={styles.autoLockContent}>
                  <Text style={styles.autoLockLabel}>Set a PIN</Text>
                  <Text style={styles.autoLockValue}>
                    {securityAvailable
                      ? `Backup unlock for when ${biometricLabel} isn't available`
                      : 'Protect CareLead with a 4-digit PIN'}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={COLORS.text.tertiary}
                />
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {/* Session duration */}
        <View style={styles.pinWrap}>
          <TouchableOpacity
            style={styles.autoLockRow}
            activeOpacity={0.7}
            onPress={() => setShowSessionDurationOptions((v) => !v)}
          >
            <View style={styles.autoLockContent}>
              <Text style={styles.autoLockLabel}>Session Duration</Text>
              <Text style={styles.autoLockValue}>
                Sign in required every {sessionDurationLabel(sessionDuration)}
              </Text>
            </View>
            <Ionicons
              name={showSessionDurationOptions ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={COLORS.text.tertiary}
            />
          </TouchableOpacity>

          {showSessionDurationOptions ? (
            <View style={styles.autoLockOptions}>
              {SESSION_DURATION_OPTIONS.map((opt) => {
                const selected = sessionDuration === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.autoLockOption,
                      selected && styles.autoLockOptionSelected,
                    ]}
                    onPress={() => handlePickSessionDuration(opt.key)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.autoLockOptionText,
                        selected && styles.autoLockOptionTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {selected ? (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={COLORS.primary.DEFAULT}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>
      </View>

      {/* Health Profile Section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Health Profile</Text>
        <Text style={styles.sectionDescription}>
          A periodic check-in to keep your saved health info accurate.
        </Text>
        <TouchableOpacity
          style={styles.autoLockRow}
          activeOpacity={0.7}
          onPress={() => router.push('/(main)/capture/import-summary')}
        >
          <View style={styles.autoLockContent}>
            <Text style={styles.autoLockLabel}>Import health data</Text>
            <Text style={styles.autoLockValue}>
              Bring in a CCD/CCDA or PDF summary from your patient portal
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={COLORS.text.tertiary}
          />
        </TouchableOpacity>
        <View style={styles.pinWrap} />
        <TouchableOpacity
          style={styles.autoLockRow}
          activeOpacity={0.7}
          onPress={() => router.push('/(main)/profile/review')}
        >
          <View style={styles.autoLockContent}>
            <Text style={styles.autoLockLabel}>Profile Review</Text>
            <Text style={styles.autoLockValue}>
              {formatLastReviewed(lastReviewedAt)}
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={COLORS.text.tertiary}
          />
        </TouchableOpacity>

        <View style={styles.pinWrap}>
          <TouchableOpacity
            style={styles.autoLockRow}
            activeOpacity={0.7}
            onPress={() => setShowReviewFrequencyOptions((v) => !v)}
          >
            <View style={styles.autoLockContent}>
              <Text style={styles.autoLockLabel}>Review Frequency</Text>
              <Text style={styles.autoLockValue}>
                {REVIEW_FREQUENCY_OPTIONS.find(
                  (o) => o.key === reviewFrequency,
                )?.label ?? 'Every 3 months'}
              </Text>
            </View>
            <Ionicons
              name={showReviewFrequencyOptions ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={COLORS.text.tertiary}
            />
          </TouchableOpacity>

          {showReviewFrequencyOptions ? (
            <View style={styles.autoLockOptions}>
              {REVIEW_FREQUENCY_OPTIONS.map((opt) => {
                const selected = reviewFrequency === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.autoLockOption,
                      selected && styles.autoLockOptionSelected,
                    ]}
                    onPress={() => {
                      setFrequencyMutation.mutate(opt.key);
                      setShowReviewFrequencyOptions(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.autoLockOptionText,
                        selected && styles.autoLockOptionTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {selected ? (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={COLORS.primary.DEFAULT}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>
      </View>

      {/* Personalization Section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Personalization</Text>
        <Text style={styles.sectionDescription}>
          Shape how CareLead organizes your tasks and briefing around what
          matters to you.
        </Text>
        <TouchableOpacity
          style={styles.autoLockRow}
          activeOpacity={0.7}
          onPress={() => {
            if (!activeProfileId) return;
            router.push(`/(main)/profile/${activeProfileId}/priorities`);
          }}
          disabled={!activeProfileId}
        >
          <View style={styles.autoLockContent}>
            <Text style={styles.autoLockLabel}>Your Priorities</Text>
            {hasPriorities ? (
              <Text style={styles.autoLockValue}>
                {priorityPreview}
                {priorities!.health_priorities.length > 2
                  ? ` +${priorities!.health_priorities.length - 2} more`
                  : ''}
                {' · '}
                {formatPriorityUpdate(priorities!.updated_at)}
              </Text>
            ) : (
              <Text
                style={[
                  styles.autoLockValue,
                  { color: COLORS.text.tertiary },
                ]}
              >
                Not set yet
              </Text>
            )}
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={COLORS.text.tertiary}
          />
        </TouchableOpacity>
      </View>

      {/* Care Guidance Section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Care Guidance</Text>
        <Text style={styles.sectionDescription}>
          Control how many follow-up tasks are auto-generated when you capture health documents.
        </Text>
        {GUIDANCE_OPTIONS.map((option) => {
          const isSelected = level === option.key;
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.optionCard, isSelected && styles.optionCardSelected]}
              onPress={() => setLevel(option.key)}
              disabled={isUpdating}
              activeOpacity={0.7}
            >
              <View style={styles.optionRow}>
                <View
                  style={[
                    styles.radio,
                    isSelected && styles.radioSelected,
                  ]}
                >
                  {isSelected && <View style={styles.radioDot} />}
                </View>
                <View style={styles.optionContent}>
                  <Text
                    style={[
                      styles.optionLabel,
                      isSelected && styles.optionLabelSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Weekly Summary Section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Weekly Summary</Text>
        <Card>
          <View style={styles.toggleRow}>
            <View style={styles.toggleContent}>
              <Text style={styles.toggleLabel}>Weekly overview</Text>
              <Text style={styles.toggleDescription}>
                Get a weekly overview of your care tasks and progress every Monday.
              </Text>
            </View>
            <Switch
              value={weeklyDigestEnabled}
              onValueChange={setWeeklyDigest}
              trackColor={{ false: COLORS.border.dark, true: COLORS.primary.light }}
              thumbColor={weeklyDigestEnabled ? COLORS.primary.DEFAULT : COLORS.surface.DEFAULT}
            />
          </View>
        </Card>
      </View>

      {/* Account Section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Account</Text>
        <Button
          title="Sign Out"
          onPress={handleSignOut}
          variant="outline"
        />
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 32,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  optionCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: COLORS.border.light,
  },
  optionCardSelected: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '08',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.border.dark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  radioSelected: {
    borderColor: COLORS.primary.DEFAULT,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  optionContent: {
    flex: 1,
  },
  optionLabel: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  optionLabelSelected: {
    color: COLORS.primary.DEFAULT,
  },
  optionDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleContent: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },
  autoLockWrap: {
    marginTop: 8,
  },
  autoLockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  autoLockContent: {
    flex: 1,
  },
  autoLockLabel: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  autoLockValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  autoLockOptions: {
    marginTop: 8,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    overflow: 'hidden',
  },
  autoLockOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  autoLockOptionSelected: {
    backgroundColor: COLORS.primary.DEFAULT + '08',
  },
  autoLockOptionText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
  },
  autoLockOptionTextSelected: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  pinWrap: {
    marginTop: 8,
  },
  pinRemoveRow: {
    marginTop: 8,
  },
  pinRemoveLabel: {
    color: COLORS.error.DEFAULT,
  },
});
