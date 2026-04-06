-- ============================================================================
-- Signup Bootstrap Function
-- Atomically creates household + member + self profile for a new user.
-- Runs as SECURITY DEFINER to bypass RLS during the bootstrap.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_household_for_user(
  p_user_id UUID,
  p_display_name TEXT DEFAULT 'My Household',
  p_user_display_name TEXT DEFAULT 'Me'
)
RETURNS JSON AS $$
DECLARE
  v_household_id UUID;
  v_profile_id UUID;
  v_member_id UUID;
BEGIN
  -- 1. Create the household
  INSERT INTO households (name)
  VALUES (p_display_name)
  RETURNING id INTO v_household_id;

  -- 2. Add user as owner (active immediately)
  INSERT INTO household_members (household_id, user_id, role, status)
  VALUES (v_household_id, p_user_id, 'owner', 'active')
  RETURNING id INTO v_member_id;

  -- 3. Create the self profile
  INSERT INTO profiles (household_id, user_id, display_name, relationship)
  VALUES (v_household_id, p_user_id, p_user_display_name, 'self')
  RETURNING id INTO v_profile_id;

  -- 4. Log the audit event
  INSERT INTO audit_events (profile_id, actor_id, event_type, metadata)
  VALUES (
    v_profile_id,
    p_user_id,
    'profile.created',
    jsonb_build_object('source', 'signup', 'relationship', 'self')
  );

  RETURN json_build_object(
    'household_id', v_household_id,
    'profile_id', v_profile_id,
    'member_id', v_member_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
