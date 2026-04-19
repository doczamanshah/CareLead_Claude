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
  invited_email: string | null;
  invited_phone: string | null;
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
  invited_email?: string;
  invited_phone?: string;
  invited_name?: string;
  profile_ids: string[];
  permission_template: PermissionTemplateId;
}

// ── Invite Lookup (via RPC) ──────────────────────────────────────────

/**
 * An invite surfaced by the security-definer lookup RPC. Includes the
 * inviter's display name and the display names of each shared profile
 * so the accept screen can render without additional queries.
 */
export interface InviteLookup {
  invite_id: string;
  household_id: string;
  invited_by_user_id: string;
  inviter_display_name: string | null;
  invited_email: string | null;
  invited_phone: string | null;
  invited_name: string | null;
  profile_ids: string[];
  profile_names: string[] | null;
  permission_template: PermissionTemplateId;
  status: InviteStatus;
  expires_at: string;
  created_at: string;
}

/** Pending-invite lookup for the current user (keyed by phone/email). */
export interface PendingInviteForUser extends Omit<InviteLookup, 'status'> {
  token: string;
}

// ── Caregiver Enrichment ─────────────────────────────────────────────

export type CaregiverEnrichmentKind =
  | 'add_medications'
  | 'add_allergies'
  | 'add_insurance'
  | 'link_conditions_to_meds'
  | 'capture_recent_visit'
  | 'refresh_medications';

export type CaregiverEnrichmentPriority = 'high' | 'medium' | 'low';

export interface CaregiverEnrichmentPrompt {
  id: string;
  kind: CaregiverEnrichmentKind;
  profileId: string;
  patientName: string;
  title: string;
  detail: string;
  actionLabel: string;
  actionRoute: string;
  actionParams?: Record<string, string>;
  priority: CaregiverEnrichmentPriority;
}
