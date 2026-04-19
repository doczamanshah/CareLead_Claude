import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

interface SignupBootstrapResult {
  household_id: string;
  profile_id: string;
  member_id: string;
}

/**
 * After a user signs up and confirms their email, bootstrap their account
 * by creating a household, membership, and self profile.
 * Uses a SECURITY DEFINER function to bypass RLS during bootstrap.
 */
export async function bootstrapNewUser(
  userId: string,
  displayName: string = 'Me',
): Promise<ServiceResult<SignupBootstrapResult>> {
  const { data, error } = await supabase.rpc('create_household_for_user', {
    p_user_id: userId,
    p_display_name: `${displayName}'s Household`,
    p_user_display_name: displayName,
  });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: data as SignupBootstrapResult };
}

/**
 * Check if a user already has a household (i.e., has been bootstrapped).
 */
export async function userHasHousehold(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('household_members')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1);

  if (error || !data || data.length === 0) {
    return false;
  }

  return true;
}

/**
 * Send a one-time verification code via SMS to the given phone number.
 * Works for both new and returning users — Supabase creates the account
 * on first verification.
 * Phone must be in E.164 format (e.g., +15551234567).
 */
export async function sendPhoneOtp(
  phone: string,
): Promise<ServiceResult<void>> {
  const { error } = await supabase.auth.signInWithOtp({ phone });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: undefined };
}

/**
 * Verify the SMS code and establish a session.
 * On success, Supabase auto-creates the user if they are new.
 */
export async function verifyPhoneOtp(
  phone: string,
  token: string,
): Promise<ServiceResult<Session>> {
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  });

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data.session) {
    return { success: false, error: 'Verification succeeded but no session was returned.' };
  }

  return { success: true, data: data.session };
}

/**
 * Send a password reset email. The user clicks the link to set a new password.
 */
export async function resetPassword(
  email: string,
): Promise<ServiceResult<void>> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim());

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: undefined };
}

/**
 * Update the user's display name across auth metadata, the self profile,
 * and the household name. Used by the post-OTP name collection screen.
 */
export async function updateUserDisplayName(
  userId: string,
  name: string,
): Promise<ServiceResult<void>> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { success: false, error: 'Name cannot be empty.' };
  }

  const { error: metaError } = await supabase.auth.updateUser({
    data: { full_name: trimmed },
  });
  if (metaError) {
    return { success: false, error: metaError.message };
  }

  const { data: profile, error: profileFetchError } = await supabase
    .from('profiles')
    .select('id, household_id')
    .eq('user_id', userId)
    .eq('relationship', 'self')
    .is('deleted_at', null)
    .maybeSingle();

  if (profileFetchError) {
    return { success: false, error: profileFetchError.message };
  }

  if (profile) {
    const { error: profileUpdateError } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', profile.id);
    if (profileUpdateError) {
      return { success: false, error: profileUpdateError.message };
    }

    const { error: householdUpdateError } = await supabase
      .from('households')
      .update({ name: `${trimmed}'s Household` })
      .eq('id', profile.household_id);
    if (householdUpdateError) {
      return { success: false, error: householdUpdateError.message };
    }
  }

  return { success: true, data: undefined };
}
