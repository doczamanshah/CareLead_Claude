import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Alert,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { useCareGuidanceLevel, useWeeklyDigest } from '@/hooks/usePreferences';
import { useAuthStore } from '@/stores/authStore';
import {
  autoLockLabel,
  disableBiometric,
  enableBiometricForUser,
  getAutoLockSetting,
  getBiometricCapability,
  isBiometricEnabledForUser,
  promptBiometric,
  setAutoLockSetting,
  type AutoLockSetting,
  type BiometricCapability,
} from '@/services/biometric';
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

export default function SettingsScreen() {
  const { level, setLevel, isUpdating } = useCareGuidanceLevel();
  const { enabled: weeklyDigestEnabled, setEnabled: setWeeklyDigest } = useWeeklyDigest();
  const user = useAuthStore((s) => s.user);

  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(true);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [autoLock, setAutoLock] = useState<AutoLockSetting>('30');
  const [showAutoLockOptions, setShowAutoLockOptions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cap, enabled, lockSetting] = await Promise.all([
        getBiometricCapability(),
        user?.id ? isBiometricEnabledForUser(user.id) : Promise.resolve(false),
        getAutoLockSetting(),
      ]);
      if (cancelled) return;
      setCapability(cap);
      setBiometricEnabled(enabled);
      setAutoLock(lockSetting);
      setBiometricLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Error', error.message);
    }
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
});
