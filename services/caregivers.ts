import { supabase } from '@/lib/supabase';
import { PERMISSION_TEMPLATE_MAP } from '@/lib/constants/permissionTemplates';
import type { PermissionTemplateId, PermissionScope } from '@/lib/constants/permissionTemplates';
import type {
  AccessGrant,
  AccessGrantWithName,
  ConsentRecord,
  CaregiverInvite,
  CreateInviteParams,
} from '@/lib/types/caregivers';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// ── Access Grants ────────────────────────────────────────────────────

/**
 * Fetch all access grants for a given profile (who has access to this profile).
 */
export async function fetchAccessGrants(
  profileId: string,
): Promise<ServiceResult<AccessGrantWithName[]>> {
  const { data, error } = await supabase
    .from('profile_access_grants')
    .select('*')
    .eq('profile_id', profileId)
    .in('status', ['pending', 'active'])
    .order('granted_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  // Enrich with grantee display names by looking up profiles linked to each grantee_user_id
  const grants = (data ?? []) as AccessGrant[];
  const granteeUserIds = [...new Set(grants.map((g) => g.grantee_user_id))];

  let nameMap: Record<string, { display_name: string | null; email: string | null }> = {};
  if (granteeUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', granteeUserIds)
      .eq('relationship', 'self')
      .is('deleted_at', null);

    for (const p of profiles ?? []) {
      if (p.user_id) {
        nameMap[p.user_id] = { display_name: p.display_name, email: null };
      }
    }
  }

  const enriched: AccessGrantWithName[] = grants.map((g) => ({
    ...g,
    grantee_display_name: nameMap[g.grantee_user_id]?.display_name ?? null,
    grantee_email: nameMap[g.grantee_user_id]?.email ?? null,
  }));

  return { success: true, data: enriched };
}

/**
 * Fetch all profiles the current user has been granted access to.
 */
export async function fetchMyAccessGrants(
  userId: string,
): Promise<ServiceResult<AccessGrant[]>> {
  const { data, error } = await supabase
    .from('profile_access_grants')
    .select('*')
    .eq('grantee_user_id', userId)
    .eq('status', 'active')
    .order('granted_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as AccessGrant[] };
}

// ── Invitations ──────────────────────────────────────────────────────

/**
 * Create a caregiver invitation.
 */
export async function createInvite(
  householdId: string,
  params: CreateInviteParams,
  userId: string,
): Promise<ServiceResult<CaregiverInvite>> {
  if (!params.invited_email && !params.invited_phone) {
    return { success: false, error: 'An email or phone number is required.' };
  }

  const template = PERMISSION_TEMPLATE_MAP[params.permission_template];
  if (!template) {
    return { success: false, error: `Unknown permission template: ${params.permission_template}` };
  }

  // Generate a random invite token
  const token = generateToken();

  // Expire in 7 days
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const { data, error } = await supabase
    .from('caregiver_invites')
    .insert({
      household_id: householdId,
      invited_by_user_id: userId,
      invited_email: params.invited_email?.toLowerCase().trim() || null,
      invited_phone: params.invited_phone?.trim() || null,
      invited_name: params.invited_name?.trim() || null,
      profile_ids: params.profile_ids,
      permission_template: params.permission_template,
      token,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  // Audit
  for (const profileId of params.profile_ids) {
    await supabase.from('audit_events').insert({
      profile_id: profileId,
      actor_id: userId,
      event_type: 'caregiver.invited',
      metadata: {
        invite_id: data.id,
        permission_template: params.permission_template,
        ...(params.invited_email ? { invited_email: params.invited_email.toLowerCase().trim() } : {}),
        ...(params.invited_phone ? { invited_phone: params.invited_phone.trim() } : {}),
      },
    });
  }

  return { success: true, data: data as CaregiverInvite };
}

/**
 * Fetch pending invites for a household.
 */
export async function fetchPendingInvites(
  householdId: string,
): Promise<ServiceResult<CaregiverInvite[]>> {
  const { data, error } = await supabase
    .from('caregiver_invites')
    .select('*')
    .eq('household_id', householdId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as CaregiverInvite[] };
}

/**
 * Accept a caregiver invite by token. Creates access grants and consent records for each profile.
 */
export async function acceptInvite(
  token: string,
  userId: string,
): Promise<ServiceResult<AccessGrant[]>> {
  // 1. Fetch the invite
  const { data: invite, error: fetchErr } = await supabase
    .from('caregiver_invites')
    .select('*')
    .eq('token', token)
    .eq('status', 'pending')
    .single();

  if (fetchErr || !invite) {
    return { success: false, error: 'Invite not found or already used.' };
  }

  // Check expiration
  if (new Date(invite.expires_at) < new Date()) {
    await supabase
      .from('caregiver_invites')
      .update({ status: 'expired' })
      .eq('id', invite.id);
    return { success: false, error: 'This invitation has expired.' };
  }

  const template = PERMISSION_TEMPLATE_MAP[invite.permission_template as PermissionTemplateId];
  const scopes = template?.scopes ?? [];

  // 2. Create access grants for each profile
  const grants: AccessGrant[] = [];
  for (const profileId of invite.profile_ids) {
    const { data: grant, error: grantErr } = await supabase
      .from('profile_access_grants')
      .insert({
        profile_id: profileId,
        grantee_user_id: userId,
        granted_by_user_id: invite.invited_by_user_id,
        permission_template: invite.permission_template,
        scopes,
        status: 'active',
        granted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (grantErr) {
      return { success: false, error: grantErr.message, code: grantErr.code };
    }

    grants.push(grant as AccessGrant);

    // 3. Create consent record
    await supabase.from('consent_records').insert({
      profile_id: profileId,
      consenter_user_id: invite.invited_by_user_id,
      grantee_user_id: userId,
      grant_id: grant.id,
      consent_type: 'access_granted',
      permission_template: invite.permission_template,
      scopes,
    });

    // Audit
    await supabase.from('audit_events').insert({
      profile_id: profileId,
      actor_id: userId,
      event_type: 'caregiver.access_granted',
      metadata: {
        grant_id: grant.id,
        permission_template: invite.permission_template,
        invite_id: invite.id,
      },
    });
  }

  // 4. Add user to household as caregiver if not already a member
  const { data: existingMember } = await supabase
    .from('household_members')
    .select('id')
    .eq('household_id', invite.household_id)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (!existingMember) {
    await supabase.from('household_members').insert({
      household_id: invite.household_id,
      user_id: userId,
      role: 'caregiver',
      status: 'active',
    });
  }

  // 5. Mark invite as accepted
  await supabase
    .from('caregiver_invites')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      accepted_by_user_id: userId,
    })
    .eq('id', invite.id);

  return { success: true, data: grants };
}

/**
 * Revoke a caregiver invite (cancel before it's accepted).
 */
export async function revokeInvite(
  inviteId: string,
  userId: string,
): Promise<ServiceResult<CaregiverInvite>> {
  const { data, error } = await supabase
    .from('caregiver_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: data as CaregiverInvite };
}

// ── Permission Management ────────────────────────────────────────────

/**
 * Revoke an active access grant. Creates a consent record.
 */
export async function revokeAccess(
  grantId: string,
  revokedBy: string,
): Promise<ServiceResult<AccessGrant>> {
  const { data, error } = await supabase
    .from('profile_access_grants')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by: revokedBy,
    })
    .eq('id', grantId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const grant = data as AccessGrant;

  // Consent record
  await supabase.from('consent_records').insert({
    profile_id: grant.profile_id,
    consenter_user_id: revokedBy,
    grantee_user_id: grant.grantee_user_id,
    grant_id: grantId,
    consent_type: 'access_revoked',
    permission_template: grant.permission_template,
    scopes: grant.scopes,
  });

  // Audit
  await supabase.from('audit_events').insert({
    profile_id: grant.profile_id,
    actor_id: revokedBy,
    event_type: 'caregiver.access_revoked',
    metadata: {
      grant_id: grantId,
      grantee_user_id: grant.grantee_user_id,
      permission_template: grant.permission_template,
    },
  });

  return { success: true, data: grant };
}

/**
 * Update the permission template for an existing access grant. Creates a consent record.
 */
export async function updatePermissions(
  grantId: string,
  newTemplate: PermissionTemplateId,
  userId: string,
): Promise<ServiceResult<AccessGrant>> {
  const template = PERMISSION_TEMPLATE_MAP[newTemplate];
  if (!template) {
    return { success: false, error: `Unknown permission template: ${newTemplate}` };
  }

  const { data, error } = await supabase
    .from('profile_access_grants')
    .update({
      permission_template: newTemplate,
      scopes: template.scopes,
    })
    .eq('id', grantId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const grant = data as AccessGrant;

  // Consent record
  await supabase.from('consent_records').insert({
    profile_id: grant.profile_id,
    consenter_user_id: userId,
    grantee_user_id: grant.grantee_user_id,
    grant_id: grantId,
    consent_type: 'access_modified',
    permission_template: newTemplate,
    scopes: template.scopes,
  });

  // Audit
  await supabase.from('audit_events').insert({
    profile_id: grant.profile_id,
    actor_id: userId,
    event_type: 'caregiver.permissions_changed',
    metadata: {
      grant_id: grantId,
      new_template: newTemplate,
      grantee_user_id: grant.grantee_user_id,
    },
  });

  return { success: true, data: grant };
}

// ── Consent History ──────────────────────────────────────────────────

/**
 * Fetch the consent audit trail for a profile.
 */
export async function fetchConsentHistory(
  profileId: string,
): Promise<ServiceResult<ConsentRecord[]>> {
  const { data, error } = await supabase
    .from('consent_records')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as ConsentRecord[] };
}

/**
 * Fetch consent history for a specific grant.
 */
export async function fetchGrantConsentHistory(
  grantId: string,
): Promise<ServiceResult<ConsentRecord[]>> {
  const { data, error } = await supabase
    .from('consent_records')
    .select('*')
    .eq('grant_id', grantId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as ConsentRecord[] };
}

// ── Access Checks ────────────────────────────────────────────────────

/**
 * Check if a user has a specific capability scope for a profile.
 */
export async function checkAccess(
  userId: string,
  profileId: string,
  scope: PermissionScope,
): Promise<ServiceResult<boolean>> {
  const { data, error } = await supabase
    .from('profile_access_grants')
    .select('scopes')
    .eq('grantee_user_id', userId)
    .eq('profile_id', profileId)
    .eq('status', 'active');

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const hasAccess = (data ?? []).some((grant) => {
    const scopes = grant.scopes as PermissionScope[];
    return scopes.includes(scope);
  });

  return { success: true, data: hasAccess };
}

// ── Helpers ──────────────────────────────────────────────────────────

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}
