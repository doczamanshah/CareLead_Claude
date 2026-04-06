import { supabase } from '@/lib/supabase';
import type { Profile, ProfileFact, ProfileWithFacts } from '@/lib/types/profile';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Fetch all profiles the current user has access to via household membership.
 */
export async function fetchUserProfiles(
  userId: string,
): Promise<ServiceResult<Profile[]>> {
  const { data: members, error: memberError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (memberError) {
    return { success: false, error: memberError.message, code: memberError.code };
  }

  if (!members || members.length === 0) {
    return { success: true, data: [] };
  }

  const householdIds = members.map((m) => m.household_id);

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .in('household_id', householdIds)
    .is('deleted_at', null)
    .order('relationship', { ascending: true })
    .order('display_name', { ascending: true });

  if (profileError) {
    return { success: false, error: profileError.message, code: profileError.code };
  }

  return { success: true, data: (profiles ?? []) as Profile[] };
}

/**
 * Fetch a single profile with all its facts grouped by category.
 */
export async function fetchProfileDetail(
  profileId: string,
): Promise<ServiceResult<ProfileWithFacts>> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .is('deleted_at', null)
    .single();

  if (profileError) {
    return { success: false, error: profileError.message, code: profileError.code };
  }

  const { data: facts, error: factsError } = await supabase
    .from('profile_facts')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .order('category', { ascending: true })
    .order('created_at', { ascending: false });

  if (factsError) {
    return { success: false, error: factsError.message, code: factsError.code };
  }

  return {
    success: true,
    data: { ...(profile as Profile), facts: (facts ?? []) as ProfileFact[] },
  };
}

/**
 * Create a dependent profile in a household.
 */
export async function createDependentProfile(
  householdId: string,
  data: {
    display_name: string;
    date_of_birth?: string;
    gender?: string;
  },
): Promise<ServiceResult<Profile>> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .insert({
      household_id: householdId,
      display_name: data.display_name,
      date_of_birth: data.date_of_birth ?? null,
      gender: data.gender ?? null,
      relationship: 'dependent',
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: profile as Profile };
}

/**
 * Update basic profile info (name, DOB, gender).
 */
export async function updateProfile(
  profileId: string,
  data: {
    display_name?: string;
    date_of_birth?: string | null;
    gender?: string | null;
  },
): Promise<ServiceResult<Profile>> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .update(data)
    .eq('id', profileId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: profile as Profile };
}

/**
 * Add a profile fact (manual entry, verified immediately).
 */
export async function addProfileFact(
  profileId: string,
  userId: string,
  fact: {
    category: ProfileFact['category'];
    field_key: string;
    value_json: Record<string, unknown>;
  },
): Promise<ServiceResult<ProfileFact>> {
  const { data, error } = await supabase
    .from('profile_facts')
    .insert({
      profile_id: profileId,
      category: fact.category,
      field_key: fact.field_key,
      value_json: fact.value_json,
      source_type: 'manual',
      verification_status: 'verified',
      verified_at: new Date().toISOString(),
      verified_by: userId,
      actor_id: userId,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: data as ProfileFact };
}

/**
 * Delete a profile fact (soft delete).
 */
export async function deleteProfileFact(
  factId: string,
): Promise<ServiceResult<null>> {
  const { error } = await supabase
    .from('profile_facts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', factId);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: null };
}
