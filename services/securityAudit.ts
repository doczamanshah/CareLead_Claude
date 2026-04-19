import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

/**
 * Security audit logging for auth and session events.
 *
 * HIPAA rules for this module:
 *   • Never send PHI: no names, phone numbers, email addresses, medication
 *     names, lab values, provider names, or any health data in `detail`.
 *   • Never send IP addresses.
 *   • `device_info` stores generic platform only ("ios" | "android" | "web"),
 *     never device IDs or model strings.
 *   • All calls are fire-and-forget — UI must never block on audit writes.
 */

export type AuthEventType =
  | 'sign_in_phone'
  | 'sign_in_email'
  | 'sign_up_phone'
  | 'sign_up_email'
  | 'sign_out'
  | 'otp_requested'
  | 'otp_verified'
  | 'otp_failed'
  | 'biometric_unlock'
  | 'biometric_failed'
  | 'session_expired'
  | 'session_refreshed'
  | 'password_reset_requested'
  | 'invite_accepted'
  | 'invite_declined'
  | 'device_changed'
  | 'pin_unlock'
  | 'pin_failed'
  | 'pin_set'
  | 'pin_removed'
  | 'pin_lockout';

interface LogAuthEventParams {
  eventType: AuthEventType;
  userId: string | null;
  detail?: Record<string, unknown>;
}

function getPlatformTag(): string {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

/**
 * Fire-and-forget audit log write. Never throws; never blocks the caller.
 * If the insert fails (no network, RLS denial, etc.) we swallow the error —
 * the UX cannot be held hostage to audit logging.
 */
export function logAuthEvent(params: LogAuthEventParams): void {
  const { eventType, userId, detail } = params;

  // Fire-and-forget — explicitly not awaited.
  void (async () => {
    try {
      await supabase.from('security_audit_log').insert({
        user_id: userId,
        event_type: eventType,
        device_info: getPlatformTag(),
        detail: detail ?? {},
      });
    } catch {
      // Swallow — audit failures must never break auth flows.
    }
  })();
}
