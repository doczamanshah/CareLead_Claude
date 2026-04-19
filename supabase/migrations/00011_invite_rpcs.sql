-- ══════════════════════════════════════════════════════════════════════
-- Migration 00011: Caregiver Invite RPCs
-- Phase 3 Auth Overhaul — Phase D
--
-- Problem: The caregiver_invites / profile_access_grants / consent_records
-- RLS policies require household membership, but a new caregiver accepting
-- an invite is NOT yet a household member. These RPCs run with
-- SECURITY DEFINER so an authenticated user can look up their invite by
-- token and complete acceptance before they're added to the household.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Look up invite by token ───────────────────────────────────────
-- Returns invite details enriched with inviter display name and the
-- display names of the profiles being shared. No PHI returned.

CREATE OR REPLACE FUNCTION lookup_invite_by_token(p_token TEXT)
RETURNS TABLE (
  invite_id           UUID,
  household_id        UUID,
  invited_by_user_id  UUID,
  inviter_display_name TEXT,
  invited_email       TEXT,
  invited_phone       TEXT,
  invited_name        TEXT,
  profile_ids         UUID[],
  profile_names       TEXT[],
  permission_template TEXT,
  status              TEXT,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    ci.id AS invite_id,
    ci.household_id,
    ci.invited_by_user_id,
    (
      SELECT p.display_name
      FROM profiles p
      WHERE p.user_id = ci.invited_by_user_id
        AND p.relationship = 'self'
        AND p.deleted_at IS NULL
      LIMIT 1
    ) AS inviter_display_name,
    ci.invited_email,
    ci.invited_phone,
    ci.invited_name,
    ci.profile_ids,
    (
      SELECT ARRAY_AGG(p.display_name ORDER BY p.display_name)
      FROM profiles p
      WHERE p.id = ANY(ci.profile_ids)
        AND p.deleted_at IS NULL
    ) AS profile_names,
    ci.permission_template,
    ci.status,
    ci.expires_at,
    ci.created_at
  FROM caregiver_invites ci
  WHERE ci.token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION lookup_invite_by_token(TEXT) TO authenticated;

-- ── 2. Accept caregiver invite ───────────────────────────────────────
-- Runs the full accept flow server-side: validates token, creates grants,
-- consent records, adds user to household, marks invite accepted.

CREATE OR REPLACE FUNCTION accept_caregiver_invite(p_token TEXT)
RETURNS TABLE (
  grant_id            UUID,
  profile_id          UUID,
  permission_template TEXT,
  scopes              JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite     caregiver_invites%ROWTYPE;
  v_user_id    UUID;
  v_scopes     JSONB;
  v_profile_id UUID;
  v_grant_id   UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load the invite
  SELECT * INTO v_invite
  FROM caregiver_invites
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'This invitation has already been %', v_invite.status;
  END IF;

  IF v_invite.expires_at < now() THEN
    UPDATE caregiver_invites
    SET status = 'expired'
    WHERE id = v_invite.id;
    RAISE EXCEPTION 'This invitation has expired';
  END IF;

  IF v_invite.invited_by_user_id = v_user_id THEN
    RAISE EXCEPTION 'You cannot accept your own invitation';
  END IF;

  -- Resolve scopes for the template
  v_scopes := CASE v_invite.permission_template
    WHEN 'full_helper' THEN
      '["profile.read","profile.write","health.read","health.write","docs.read","docs.write","tasks.read","tasks.write","appointments.read","appointments.write","medications.read","medications.write","export.generate","intent.confirm"]'::JSONB
    WHEN 'bills_insurance' THEN
      '["profile.read","health.read","docs.read","docs.write","tasks.read","tasks.write"]'::JSONB
    WHEN 'medications' THEN
      '["profile.read","health.read","medications.read","medications.write","tasks.read"]'::JSONB
    WHEN 'appointments_tasks' THEN
      '["profile.read","appointments.read","appointments.write","tasks.read","tasks.write"]'::JSONB
    WHEN 'documents_only' THEN
      '["profile.read","docs.read"]'::JSONB
    WHEN 'view_only' THEN
      '["profile.read","health.read"]'::JSONB
    ELSE '[]'::JSONB
  END;

  -- Create grants + consent records for each profile
  FOREACH v_profile_id IN ARRAY v_invite.profile_ids
  LOOP
    INSERT INTO profile_access_grants (
      profile_id,
      grantee_user_id,
      granted_by_user_id,
      permission_template,
      scopes,
      status,
      granted_at
    ) VALUES (
      v_profile_id,
      v_user_id,
      v_invite.invited_by_user_id,
      v_invite.permission_template,
      v_scopes,
      'active',
      now()
    )
    RETURNING id INTO v_grant_id;

    INSERT INTO consent_records (
      profile_id,
      consenter_user_id,
      grantee_user_id,
      grant_id,
      consent_type,
      permission_template,
      scopes
    ) VALUES (
      v_profile_id,
      v_invite.invited_by_user_id,
      v_user_id,
      v_grant_id,
      'access_granted',
      v_invite.permission_template,
      v_scopes
    );

    INSERT INTO audit_events (
      profile_id,
      actor_id,
      event_type,
      metadata
    ) VALUES (
      v_profile_id,
      v_user_id,
      'caregiver.access_granted',
      jsonb_build_object(
        'grant_id', v_grant_id,
        'permission_template', v_invite.permission_template,
        'invite_id', v_invite.id
      )
    );

    -- Return row for the caller
    grant_id := v_grant_id;
    profile_id := v_profile_id;
    permission_template := v_invite.permission_template;
    scopes := v_scopes;
    RETURN NEXT;
  END LOOP;

  -- Add user to household as caregiver if not already a member
  INSERT INTO household_members (household_id, user_id, role, status)
  SELECT v_invite.household_id, v_user_id, 'caregiver', 'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM household_members
    WHERE household_id = v_invite.household_id
      AND user_id = v_user_id
      AND status = 'active'
  );

  -- Mark invite accepted
  UPDATE caregiver_invites
  SET
    status = 'accepted',
    accepted_at = now(),
    accepted_by_user_id = v_user_id
  WHERE id = v_invite.id;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION accept_caregiver_invite(TEXT) TO authenticated;

-- ── 3. Find pending invites for the current user ────────────────────
-- Checks caregiver_invites for any pending row whose invited_email or
-- invited_phone matches the arguments. Used to surface a banner when a
-- newly-signed-up user has a waiting invite.

CREATE OR REPLACE FUNCTION find_invites_for_contact(
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS TABLE (
  invite_id           UUID,
  household_id        UUID,
  invited_by_user_id  UUID,
  inviter_display_name TEXT,
  invited_email       TEXT,
  invited_phone       TEXT,
  invited_name        TEXT,
  profile_ids         UUID[],
  profile_names       TEXT[],
  permission_template TEXT,
  token               TEXT,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_email IS NULL AND p_phone IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ci.id AS invite_id,
    ci.household_id,
    ci.invited_by_user_id,
    (
      SELECT p.display_name
      FROM profiles p
      WHERE p.user_id = ci.invited_by_user_id
        AND p.relationship = 'self'
        AND p.deleted_at IS NULL
      LIMIT 1
    ) AS inviter_display_name,
    ci.invited_email,
    ci.invited_phone,
    ci.invited_name,
    ci.profile_ids,
    (
      SELECT ARRAY_AGG(p.display_name ORDER BY p.display_name)
      FROM profiles p
      WHERE p.id = ANY(ci.profile_ids)
        AND p.deleted_at IS NULL
    ) AS profile_names,
    ci.permission_template,
    ci.token,
    ci.expires_at,
    ci.created_at
  FROM caregiver_invites ci
  WHERE ci.status = 'pending'
    AND ci.expires_at > now()
    AND ci.invited_by_user_id <> auth.uid()
    AND (
      (p_email IS NOT NULL AND LOWER(ci.invited_email) = LOWER(p_email))
      OR (p_phone IS NOT NULL AND ci.invited_phone = p_phone)
    )
  ORDER BY ci.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION find_invites_for_contact(TEXT, TEXT) TO authenticated;
