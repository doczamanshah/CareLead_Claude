-- ============================================================================
-- Family members support
--
-- Adds a `relationship_label` column to `profiles` so we can store the
-- human-readable relationship (parent, spouse, child, sibling, grandparent,
-- other) alongside the existing `relationship` column (which remains the
-- binary self/dependent flag used by RLS helpers and eligibility engines).
--
-- Also adds an RPC + delete policy for the "remove family member" flow.
-- ============================================================================

-- 1. relationship_label column --------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS relationship_label TEXT
    CHECK (relationship_label IN (
      'self', 'parent', 'spouse', 'child', 'sibling', 'grandparent', 'other'
    ));

-- Backfill: self profiles get 'self', existing dependents get 'other' so
-- they have a sensible default. The user can edit this later.
UPDATE profiles
  SET relationship_label = CASE
    WHEN relationship = 'self' THEN 'self'
    ELSE 'other'
  END
  WHERE relationship_label IS NULL;

-- 2. Profile DELETE policy (soft-delete via UPDATE remains the default, but
--    the "remove family member" flow uses soft-delete through UPDATE which
--    is already allowed by profiles_update). No new policy needed.
-- ------------------------------------------------------------------------

-- 3. RPC: add_family_member
--    Creates a dependent profile inside the caller's household. Runs as
--    SECURITY DEFINER so RLS doesn't block the insert when the caller only
--    has the default 'owner' role (the profiles_insert policy already
--    checks is_household_member, which covers this, but wrapping the logic
--    in an RPC keeps service code simple and lets us log the audit event
--    atomically).
-- ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_family_member(
  p_household_id     UUID,
  p_display_name     TEXT,
  p_relationship     TEXT,
  p_date_of_birth    DATE DEFAULT NULL,
  p_gender           TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_profile_id   UUID;
  v_is_member    BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_display_name IS NULL OR length(trim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'display_name required';
  END IF;

  IF p_relationship NOT IN (
    'parent', 'spouse', 'child', 'sibling', 'grandparent', 'other'
  ) THEN
    RAISE EXCEPTION 'invalid relationship: %', p_relationship;
  END IF;

  -- Verify caller is an active member of the household
  SELECT EXISTS (
    SELECT 1 FROM household_members
    WHERE household_id = p_household_id
      AND user_id = v_uid
      AND status = 'active'
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'not a member of household %', p_household_id;
  END IF;

  INSERT INTO profiles (
    household_id,
    user_id,
    display_name,
    relationship,
    relationship_label,
    date_of_birth,
    gender
  ) VALUES (
    p_household_id,
    NULL,                        -- dependent profiles don't own a user_id
    trim(p_display_name),
    'dependent',
    p_relationship,
    p_date_of_birth,
    p_gender
  )
  RETURNING id INTO v_profile_id;

  INSERT INTO audit_events (profile_id, actor_id, event_type, metadata)
  VALUES (
    v_profile_id,
    v_uid,
    'profile.created',
    jsonb_build_object(
      'source', 'add_family_member',
      'relationship', p_relationship
    )
  );

  RETURN json_build_object('profile_id', v_profile_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
