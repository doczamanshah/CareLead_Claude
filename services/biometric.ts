import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY_ENABLED = 'carelead_biometric_enabled';
const KEY_USER_ID = 'carelead_biometric_user_id';
const KEY_AUTO_LOCK = 'carelead_auto_lock_seconds';
const KEY_LAST_BG = 'carelead_last_background_ts';
const KEY_PROMPTED_USER_ID = 'carelead_biometric_prompted_user_id';

export type AutoLockSetting = '30' | '60' | '300' | 'never';
export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'generic';

export const DEFAULT_AUTO_LOCK: AutoLockSetting = '30';

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // noop
  }
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // noop
  }
}

export interface BiometricCapability {
  available: boolean;
  enrolled: boolean;
  kind: BiometricKind;
  label: string;
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  if (Platform.OS === 'web') {
    return { available: false, enrolled: false, kind: 'generic', label: 'Biometrics' };
  }

  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    console.log('[biometric] capability check', { hasHardware, enrolled, types });

    let kind: BiometricKind = 'generic';
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      kind = 'face';
    } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      kind = 'fingerprint';
    } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      kind = 'iris';
    }

    const label =
      kind === 'face'
        ? Platform.OS === 'ios'
          ? 'Face ID'
          : 'Face Unlock'
        : kind === 'fingerprint'
          ? Platform.OS === 'ios'
            ? 'Touch ID'
            : 'Fingerprint'
          : kind === 'iris'
            ? 'Iris'
            : 'Biometrics';

    return { available: hasHardware, enrolled, kind, label };
  } catch (err) {
    console.error('[biometric] capability check failed', err);
    return { available: false, enrolled: false, kind: 'generic', label: 'Biometrics' };
  }
}

export async function promptBiometric(reason: string): Promise<{
  success: boolean;
  error?: string;
}> {
  console.log('[biometric] prompt requested', { reason });
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      disableDeviceFallback: true,
    });
    console.log('[biometric] prompt result', result);
    if (result.success) return { success: true };
    return { success: false, error: (result as { error?: string }).error ?? 'cancelled' };
  } catch (err) {
    console.error('[biometric] prompt threw', err);
    return { success: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function isBiometricEnabledForUser(userId: string): Promise<boolean> {
  const [enabled, savedUserId] = await Promise.all([
    getItem(KEY_ENABLED),
    getItem(KEY_USER_ID),
  ]);
  return enabled === 'true' && savedUserId === userId;
}

export async function enableBiometricForUser(userId: string): Promise<void> {
  await Promise.all([
    setItem(KEY_ENABLED, 'true'),
    setItem(KEY_USER_ID, userId),
  ]);
}

export async function disableBiometric(): Promise<void> {
  await Promise.all([
    setItem(KEY_ENABLED, 'false'),
    removeItem(KEY_USER_ID),
  ]);
}

export async function clearBiometricPreferences(): Promise<void> {
  await Promise.all([
    removeItem(KEY_ENABLED),
    removeItem(KEY_USER_ID),
    removeItem(KEY_LAST_BG),
    removeItem(KEY_PROMPTED_USER_ID),
  ]);
}

export async function hasBeenPromptedForUser(userId: string): Promise<boolean> {
  const saved = await getItem(KEY_PROMPTED_USER_ID);
  return saved === userId;
}

export async function markPromptedForUser(userId: string): Promise<void> {
  await setItem(KEY_PROMPTED_USER_ID, userId);
}

export async function getAutoLockSetting(): Promise<AutoLockSetting> {
  const value = await getItem(KEY_AUTO_LOCK);
  if (value === '30' || value === '60' || value === '300' || value === 'never') {
    return value;
  }
  return DEFAULT_AUTO_LOCK;
}

export async function setAutoLockSetting(value: AutoLockSetting): Promise<void> {
  await setItem(KEY_AUTO_LOCK, value);
}

export async function recordBackgroundTimestamp(): Promise<void> {
  await setItem(KEY_LAST_BG, Date.now().toString());
}

export async function getBackgroundTimestamp(): Promise<number | null> {
  const raw = await getItem(KEY_LAST_BG);
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function clearBackgroundTimestamp(): Promise<void> {
  await removeItem(KEY_LAST_BG);
}

/**
 * Returns true if the app should lock based on how long it was in the background.
 * 'never' means the app never locks on background; any other value compares seconds elapsed.
 */
export function shouldLockAfterBackground(
  elapsedMs: number,
  autoLock: AutoLockSetting,
): boolean {
  if (autoLock === 'never') return false;
  const thresholdMs = parseInt(autoLock, 10) * 1000;
  return elapsedMs >= thresholdMs;
}

export function autoLockLabel(value: AutoLockSetting): string {
  switch (value) {
    case '30':
      return '30 seconds';
    case '60':
      return '1 minute';
    case '300':
      return '5 minutes';
    case 'never':
      return 'Never';
  }
}
