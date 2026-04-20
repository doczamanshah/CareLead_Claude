import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { safeLog, safeError } from '@/lib/utils/safeLog';

const KEY_ENABLED = 'carelead_biometric_enabled';
const KEY_USER_ID = 'carelead_biometric_user_id';
const KEY_AUTO_LOCK = 'carelead_auto_lock_seconds';
const KEY_LAST_BG = 'carelead_last_background_ts';
const KEY_PROMPTED_USER_ID = 'carelead_biometric_prompted_user_id';
const KEY_PIN_HASH = 'carelead_pin_hash';
const KEY_PIN_USER_ID = 'carelead_pin_user_id';
const KEY_PIN_ATTEMPTS = 'carelead_pin_attempts';
const KEY_SESSION_DURATION = 'carelead_session_duration';
const KEY_SESSION_STARTED_AT = 'carelead_session_started_at';

export type AutoLockSetting = '30' | '60' | '300' | 'never';
export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'generic';
export type SessionDuration = '24h' | '7d' | '30d';

export const DEFAULT_AUTO_LOCK: AutoLockSetting = '30';
export const DEFAULT_SESSION_DURATION: SessionDuration = '7d';
export const MAX_PIN_ATTEMPTS = 5;

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

    safeLog('[biometric] capability check', { hasHardware, enrolled, types });

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
    safeError('[biometric] capability check failed', err);
    return { available: false, enrolled: false, kind: 'generic', label: 'Biometrics' };
  }
}

export async function promptBiometric(reason: string): Promise<{
  success: boolean;
  error?: string;
}> {
  safeLog('[biometric] prompt requested');
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      disableDeviceFallback: true,
    });
    safeLog('[biometric] prompt result', { success: result.success });
    if (result.success) return { success: true };
    return { success: false, error: (result as { error?: string }).error ?? 'cancelled' };
  } catch (err) {
    safeError('[biometric] prompt threw', err);
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

// ─────────────────────────────────────────────────────────────────────────
// PIN (fallback lock mechanism for devices without biometrics)
// ─────────────────────────────────────────────────────────────────────────

async function hashPin(pin: string, userId: string): Promise<string> {
  // SHA-256 of (pin + userId as salt). Per-user salt avoids rainbow-table
  // reuse across different users on the same device.
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${pin}:${userId}`,
  );
}

export async function isPinSetForUser(userId: string): Promise<boolean> {
  const [hash, savedUserId] = await Promise.all([
    getItem(KEY_PIN_HASH),
    getItem(KEY_PIN_USER_ID),
  ]);
  return !!hash && savedUserId === userId;
}

export async function hasAnyPin(): Promise<boolean> {
  const hash = await getItem(KEY_PIN_HASH);
  return !!hash;
}

export async function setPinForUser(userId: string, pin: string): Promise<void> {
  const hash = await hashPin(pin, userId);
  await Promise.all([
    setItem(KEY_PIN_HASH, hash),
    setItem(KEY_PIN_USER_ID, userId),
    setItem(KEY_PIN_ATTEMPTS, '0'),
  ]);
}

export async function verifyPin(userId: string, pin: string): Promise<boolean> {
  const [storedHash, storedUserId] = await Promise.all([
    getItem(KEY_PIN_HASH),
    getItem(KEY_PIN_USER_ID),
  ]);
  if (!storedHash || storedUserId !== userId) return false;
  const candidate = await hashPin(pin, userId);
  return candidate === storedHash;
}

export async function clearPin(): Promise<void> {
  await Promise.all([
    removeItem(KEY_PIN_HASH),
    removeItem(KEY_PIN_USER_ID),
    removeItem(KEY_PIN_ATTEMPTS),
  ]);
}

export async function getPinAttempts(): Promise<number> {
  const raw = await getItem(KEY_PIN_ATTEMPTS);
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

export async function incrementPinAttempts(): Promise<number> {
  const current = await getPinAttempts();
  const next = current + 1;
  await setItem(KEY_PIN_ATTEMPTS, next.toString());
  return next;
}

export async function resetPinAttempts(): Promise<void> {
  await setItem(KEY_PIN_ATTEMPTS, '0');
}

// ─────────────────────────────────────────────────────────────────────────
// Session duration / expiry
// ─────────────────────────────────────────────────────────────────────────

export async function getSessionDuration(): Promise<SessionDuration> {
  const value = await getItem(KEY_SESSION_DURATION);
  if (value === '24h' || value === '7d' || value === '30d') return value;
  return DEFAULT_SESSION_DURATION;
}

export async function setSessionDuration(value: SessionDuration): Promise<void> {
  await setItem(KEY_SESSION_DURATION, value);
}

export function sessionDurationLabel(value: SessionDuration): string {
  switch (value) {
    case '24h':
      return '24 hours';
    case '7d':
      return '7 days';
    case '30d':
      return '30 days';
  }
}

export function sessionDurationMs(value: SessionDuration): number {
  switch (value) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
  }
}

export async function recordSessionStart(): Promise<void> {
  await setItem(KEY_SESSION_STARTED_AT, Date.now().toString());
}

export async function getSessionStartedAt(): Promise<number | null> {
  const raw = await getItem(KEY_SESSION_STARTED_AT);
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function clearSessionStart(): Promise<void> {
  await removeItem(KEY_SESSION_STARTED_AT);
}

// ─────────────────────────────────────────────────────────────────────────
// Comprehensive cleanup — called on every sign-out path.
// ─────────────────────────────────────────────────────────────────────────

export async function clearAllSecurityPreferences(): Promise<void> {
  await Promise.all([
    removeItem(KEY_ENABLED),
    removeItem(KEY_USER_ID),
    removeItem(KEY_LAST_BG),
    removeItem(KEY_PROMPTED_USER_ID),
    removeItem(KEY_AUTO_LOCK),
    removeItem(KEY_PIN_HASH),
    removeItem(KEY_PIN_USER_ID),
    removeItem(KEY_PIN_ATTEMPTS),
    removeItem(KEY_SESSION_DURATION),
    removeItem(KEY_SESSION_STARTED_AT),
  ]);
}
