import type { PermissionTemplateId, PermissionScope } from '@/lib/constants/permissionTemplates';

// ── Access Grants ────────────────────────────────────────────────────

export type AccessGrantStatus = 'pending' | 'active' | 'revoked' | 'expired';

export interface AccessGrant {
  id: string;
  profile_id: string;
  grantee_user_id: string;
  granted_by_user_id: string;
  permission_template: PermissionTemplateId;
  scopes: PermissionScope[];
  status: AccessGrantStatus;
  granted_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** AccessGrant enriched with grantee profile display name for UI display. */
export interface AccessGrantWithName extends AccessGrant {
  grantee_display_name: string | null;
  grantee_email: string | null;
}

// ── Consent Records ──────────────────────────────────────────────────

export type ConsentType = 'access_granted' | 'access_modified' | 'access_revoked';

export interface ConsentRecord {
  id: string;
  profile_id: string;
  consenter_user_id: string;
  grantee_user_id: string;
  grant_id: string;
  consent_type: ConsentType;
  permission_template: PermissionTemplateId;
  scopes: PermissionScope[];
  notes: string | null;
  created_at: string;
}

// ── Caregiver Invites ────────────────────────────────────────────────

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface CaregiverInvite {
  id: string;
  household_id: string;
  invited_by_user_id: string;
  invited_email: string;
  invited_name: string | null;
  profile_ids: string[];
  permission_template: PermissionTemplateId;
  token: string;
  status: InviteStatus;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  created_at: string;
}

// ── Service Params ───────────────────────────────────────────────────

export interface CreateInviteParams {
  invited_email: string;
  invited_name?: string;
  profile_ids: string[];
  permission_template: PermissionTemplateId;
}
