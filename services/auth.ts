import { supabase } from '@/lib/supabase';

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
