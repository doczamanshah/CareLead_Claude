import { supabase } from '@/lib/supabase';
import type { CareGuidanceLevel } from '@/services/commit';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export type PreferenceKey = 'care_guidance_level' | 'weekly_digest_enabled';

export interface UserPreference {
  id: string;
  user_id: string;
  preference_key: PreferenceKey;
  value_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Get a single preference value for the current user.
 */
export async function getPreference(
  userId: string,
  key: PreferenceKey,
): Promise<ServiceResult<Record<string, unknown> | null>> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('value_json')
    .eq('user_id', userId)
    .eq('preference_key', key)
    .maybeSingle();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: data?.value_json ?? null };
}

/**
 * Set (upsert) a preference value for the current user.
 */
export async function setPreference(
  userId: string,
  key: PreferenceKey,
  value: Record<string, unknown>,
): Promise<ServiceResult<UserPreference>> {
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert(
      {
        user_id: userId,
        preference_key: key,
        value_json: value,
      },
      { onConflict: 'user_id,preference_key' },
    )
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: data as UserPreference };
}

/**
 * Get the user's care guidance level preference.
 * Defaults to 'balanced' if not set.
 */
export async function getCareGuidanceLevel(
  userId: string,
): Promise<ServiceResult<CareGuidanceLevel>> {
  const result = await getPreference(userId, 'care_guidance_level');
  if (!result.success) return result;

  const level = (result.data?.level as CareGuidanceLevel) ?? 'balanced';
  return { success: true, data: level };
}

/**
 * Set the user's care guidance level preference.
 */
export async function setCareGuidanceLevel(
  userId: string,
  level: CareGuidanceLevel,
): Promise<ServiceResult<UserPreference>> {
  return setPreference(userId, 'care_guidance_level', { level });
}

/**
 * Get whether the weekly digest is enabled. Defaults to true.
 */
export async function getWeeklyDigestEnabled(
  userId: string,
): Promise<ServiceResult<boolean>> {
  const result = await getPreference(userId, 'weekly_digest_enabled');
  if (!result.success) return result;

  const enabled = result.data?.enabled !== false; // default true
  return { success: true, data: enabled };
}

/**
 * Set the weekly digest enabled preference.
 */
export async function setWeeklyDigestEnabled(
  userId: string,
  enabled: boolean,
): Promise<ServiceResult<UserPreference>> {
  return setPreference(userId, 'weekly_digest_enabled', { enabled });
}
