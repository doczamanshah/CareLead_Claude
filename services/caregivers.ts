import { supabase } from '@/lib/supabase';
import { PERMISSION_TEMPLATE_MAP } from '@/lib/constants/permissionTemplates';
import type { PermissionTemplateId, PermissionScope } from '@/lib/constants/permissionTemplates';
import type {
  AccessGrant,
  AccessGrantWithName,
  ConsentRecord,
  CaregiverInvite,
  CreateInviteParams,
  InviteLookup,
  PendingInviteForUser,
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
 * Look up an invite by token (without accepting it). Used by the
 * accept-invite screen to render invite details before the user confirms.
 * Goes through a SECURITY DEFINER RPC so a caregiver who is not yet a
 * household member can still read the invite row.
 */
export async function lookupInviteByToken(
  token: string,
): Promise<ServiceResult<InviteLookup>> {
  const { data, error } = await supabase.rpc('lookup_invite_by_token', {
    p_token: token,
  });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const rows = (data ?? []) as InviteLookup[];
  if (rows.length === 0) {
    return { success: false, error: 'Invite not found.' };
  }

  return { success: true, data: rows[0] };
}

/**
 * Accept a caregiver invite by token. Delegates to a SECURITY DEFINER RPC
 * that creates grants, consent records, adds the user to the household,
 * and marks the invite accepted — all atomically server-side.
 */
export async function acceptInvite(
  token: string,
  _userId: string,
): Promise<ServiceResult<AccessGrant[]>> {
  const { data, error } = await supabase.rpc('accept_caregiver_invite', {
    p_token: token,
  });

  if (error) {
    // Normalise common messages from RAISE EXCEPTION so the UI can show them directly.
    const msg = error.message || 'Failed to accept invitation.';
    return { success: false, error: msg, code: error.code };
  }

  const grants = (data ?? []) as Array<{
    grant_id: string;
    profile_id: string;
    permission_template: PermissionTemplateId;
    scopes: PermissionScope[];
  }>;

  // Shape into the AccessGrant type the caller expects.
  const now = new Date().toISOString();
  const shaped: AccessGrant[] = grants.map((g) => ({
    id: g.grant_id,
    profile_id: g.profile_id,
    grantee_user_id: '', // server-known; UI doesn't need it at this point
    granted_by_user_id: '',
    permission_template: g.permission_template,
    scopes: g.scopes,
    status: 'active',
    granted_at: now,
    revoked_at: null,
    revoked_by: null,
    expires_at: null,
    created_at: now,
    updated_at: now,
  }));

  return { success: true, data: shaped };
}

/**
 * Check for pending invites addressed to a given phone or email. Returns
 * invites the current user could accept (excludes their own outgoing ones).
 */
export async function checkPendingInvitesForUser(
  email: string | null,
  phone: string | null,
): Promise<ServiceResult<PendingInviteForUser[]>> {
  if (!email && !phone) {
    return { success: true, data: [] };
  }

  const { data, error } = await supabase.rpc('find_invites_for_contact', {
    p_email: email ?? null,
    p_phone: phone ?? null,
  });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as PendingInviteForUser[] };
}

/**
 * Cancel (revoke) a pending invite. Alias for revokeInvite that records
 * an audit event.
 */
export async function cancelInvite(
  inviteId: string,
  userId: string,
): Promise<ServiceResult<CaregiverInvite>> {
  return revokeInvite(inviteId, userId);
}

/**
 * Re-share an existing invite: fetches the current invite row so the UI
 * can re-open the share sheet with the same token. Does not create a new
 * invite or extend expiry.
 */
export async function resendInvite(
  inviteId: string,
): Promise<ServiceResult<CaregiverInvite>> {
  const { data, error } = await supabase
    .from('caregiver_invites')
    .select('*')
    .eq('id', inviteId)
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Invite not found.' };
  }

  if (data.status !== 'pending') {
    return { success: false, error: `This invitation is ${data.status} — create a new one.` };
  }

  return { success: true, data: data as CaregiverInvite };
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

  // Audit — one event per profile involved (non-PHI metadata only)
  if (data && userId) {
    const invite = data as CaregiverInvite;
    for (const profileId of invite.profile_ids) {
      await supabase.from('audit_events').insert({
        profile_id: profileId,
        actor_id: userId,
        event_type: 'caregiver.invite_revoked',
        metadata: {
          invite_id: invite.id,
          permission_template: invite.permission_template,
        },
      });
    }
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
