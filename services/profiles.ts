import { supabase } from '@/lib/supabase';
import type {
  Profile,
  ProfileFact,
  ProfileWithFacts,
  RelationshipLabel,
} from '@/lib/types/profile';
import { normalizeSexForEligibility } from '@/lib/utils/gender';

/**
 * Canonicalize a gender value before writing to the DB. If the value
 * normalizes to male/female (incl. 'Male', 'Female', 'm', 'f', etc.), store
 * the lowercase canonical form so the preventive eligibility engine and any
 * downstream readers see a consistent value. Leave other values (null,
 * 'Non-binary', 'Prefer not to say', etc.) untouched.
 */
function canonicalizeGender(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const canonical = normalizeSexForEligibility(value);
  return canonical ?? value;
}

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
 * Update basic profile info (name, DOB, gender, relationship_label).
 */
export async function updateProfile(
  profileId: string,
  data: {
    display_name?: string;
    date_of_birth?: string | null;
    gender?: string | null;
    relationship_label?: RelationshipLabel | null;
  },
): Promise<ServiceResult<Profile>> {
  const patch: typeof data = { ...data };
  if ('gender' in patch) {
    patch.gender = canonicalizeGender(patch.gender) as string | null | undefined;
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', profileId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: profile as Profile };
}

/**
 * Add a family member (dependent profile) to the household via RPC.
 * The RPC runs as SECURITY DEFINER and logs the audit event atomically.
 */
export async function addFamilyMember(params: {
  householdId: string;
  name: string;
  relationship: Exclude<RelationshipLabel, 'self'>;
  dateOfBirth?: string;
  gender?: string;
}): Promise<ServiceResult<{ profileId: string }>> {
  const canonicalGender = canonicalizeGender(params.gender ?? null);

  const { data, error } = await supabase.rpc('add_family_member', {
    p_household_id: params.householdId,
    p_display_name: params.name,
    p_relationship: params.relationship,
    p_date_of_birth: params.dateOfBirth ?? null,
    p_gender: typeof canonicalGender === 'string' ? canonicalGender : null,
  });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const profileId = (data as { profile_id?: string } | null)?.profile_id;
  if (!profileId) {
    return { success: false, error: 'Could not create family member' };
  }

  return { success: true, data: { profileId } };
}

/**
 * Soft-delete a profile. Used by the "remove family member" flow.
 * The self profile cannot be removed (enforced at the UI layer).
 */
export async function softDeleteProfile(
  profileId: string,
): Promise<ServiceResult<null>> {
  const { error } = await supabase
    .from('profiles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', profileId);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: null };
}

/**
 * Update onboarding basics (DOB, gender, zip code).
 * DOB and gender are stored on the profile; zip is stored on auth user metadata
 * (no zip column exists yet — reserved for future use).
 */
export async function updateProfileBasics(
  profileId: string,
  updates: {
    dateOfBirth?: string;
    gender?: string;
    zipCode?: string;
  },
): Promise<ServiceResult<void>> {
  const patch: { date_of_birth?: string; gender?: string } = {};
  if (updates.dateOfBirth) patch.date_of_birth = updates.dateOfBirth;
  if (updates.gender) {
    const canonical = canonicalizeGender(updates.gender);
    if (typeof canonical === 'string') patch.gender = canonical;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', profileId);

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }
  }

  if (updates.zipCode) {
    const { error: metaError } = await supabase.auth.updateUser({
      data: { zip_code: updates.zipCode },
    });
    if (metaError) {
      return { success: false, error: metaError.message };
    }
  }

  return { success: true, data: undefined };
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
 * Create a profile fact from a document-derived enrichment suggestion.
 *
 * Differs from `addProfileFact` in two ways: source_type is `document`
 * (not `manual`) and verification_status is `unverified` so the fact carries
 * its provenance forward. The enrichment flow needs this distinction because
 * the user only confirmed "yes, add this" — they did not re-verify the value.
 */
export async function createProfileFactFromEnrichment(
  profileId: string,
  userId: string,
  fact: {
    category: ProfileFact['category'];
    field_key: string;
    value_json: Record<string, unknown>;
    source_ref: string;
  },
): Promise<ServiceResult<ProfileFact>> {
  const { data, error } = await supabase
    .from('profile_facts')
    .insert({
      profile_id: profileId,
      category: fact.category,
      field_key: fact.field_key,
      value_json: fact.value_json,
      source_type: 'document',
      source_ref: fact.source_ref,
      verification_status: 'unverified',
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
