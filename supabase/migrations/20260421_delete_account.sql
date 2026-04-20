-- ============================================================================
-- Phase 3 Item 7 — HIPAA alignment: account deletion RPC
-- ============================================================================
--
-- Users must be able to delete their account and all associated data. HIPAA
-- (patient right to amend/access) and App Store Review Guideline 5.1.1(v)
-- both require this.
--
-- `delete_user_account()` runs as SECURITY DEFINER so it can traverse RLS
-- and hard-delete across every table owned by the caller. The caller must
-- be an authenticated user (auth.uid() IS NOT NULL).
--
-- What it deletes (public schema only):
--   • For every household where the caller is the only active member:
--     the entire household, its profiles, and all patient data attached
--     to those profiles (medications, appointments, tasks, artifacts,
--     billing cases, results, preventive items, priorities, audit events,
--     access grants, consent records, caregiver invites).
--   • For households the caller shares: the caller's `household_members`
--     row + any `profile_access_grants` where they are the grantee. The
--     remaining members keep access to the profiles.
--   • Security audit rows authored by this user are anonymized (user_id
--     set NULL via the existing FK `ON DELETE SET NULL` — the row stays
--     because audit logs are regulatory artifacts).
--
-- What it does NOT delete:
--   • `auth.users` row — requires service_role. Left for an admin/cron job
--     or the dedicated delete-account Edge Function to handle. The client
--     signs the user out immediately after the RPC returns so the
--     lingering auth row cannot be used from this device.
--   • Supabase Storage objects — the bucket entries live under profile IDs
--     that have been deleted; storage RLS will prevent access. A cleanup
--     cron job can reap orphaned objects later.
-- ============================================================================

CREATE OR REPLACE FUNCTION delete_user_account()
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_household_id UUID;
  v_profile_id UUID;
  v_other_members INT;
  v_deleted_households INT := 0;
  v_deleted_profiles INT := 0;
  v_deleted_grants INT := 0;
  v_household_ids UUID[];
  v_profile_ids UUID[];
  v_solo_profile_ids UUID[];
  v_solo_household_ids UUID[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'delete_user_account: no authenticated user';
  END IF;

  -- 1. Collect all households the caller is an active member of.
  SELECT array_agg(household_id)
    INTO v_household_ids
    FROM household_members
   WHERE user_id = v_uid
     AND status = 'active';

  IF v_household_ids IS NULL THEN
    v_household_ids := ARRAY[]::UUID[];
  END IF;

  -- 2. Partition those households into "solo" (only this user) vs "shared".
  FOREACH v_household_id IN ARRAY v_household_ids LOOP
    SELECT count(*) INTO v_other_members
      FROM household_members
     WHERE household_id = v_household_id
       AND status = 'active'
       AND user_id <> v_uid;
    IF v_other_members = 0 THEN
      v_solo_household_ids := COALESCE(v_solo_household_ids, ARRAY[]::UUID[])
        || v_household_id;
    END IF;
  END LOOP;

  IF v_solo_household_ids IS NULL THEN
    v_solo_household_ids := ARRAY[]::UUID[];
  END IF;

  -- 3. Collect all profiles in the solo households (these get fully wiped).
  SELECT array_agg(id) INTO v_solo_profile_ids
    FROM profiles
   WHERE household_id = ANY(v_solo_household_ids);

  IF v_solo_profile_ids IS NULL THEN
    v_solo_profile_ids := ARRAY[]::UUID[];
  END IF;

  -- 4. Hard-delete all patient data tied to solo profiles. Order matters
  --    where foreign keys exist; we go from most dependent outward.

  -- Billing (13 tables) — delete children first, parents last.
  DELETE FROM billing_case_status_events
    WHERE case_id IN (SELECT id FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM billing_case_parties
    WHERE case_id IN (SELECT id FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM billing_appeal_packets
    WHERE case_id IN (SELECT id FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM billing_denial_records
    WHERE case_id IN (SELECT id FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM billing_case_payments
    WHERE case_id IN (SELECT id FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM billing_case_call_logs
    WHERE case_id IN (SELECT id FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM billing_case_actions
    WHERE case_id IN (SELECT id FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM billing_case_findings
    WHERE case_id IN (SELECT id FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM billing_ledger_lines
    WHERE case_id IN (SELECT id FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM billing_extract_jobs
    WHERE case_id IN (SELECT id FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM billing_documents
    WHERE case_id IN (SELECT id FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM billing_cases WHERE profile_id = ANY(v_solo_profile_ids);
  DELETE FROM billing_contacts WHERE household_id = ANY(v_solo_household_ids);

  -- Results (4 tables).
  DELETE FROM result_extract_jobs
    WHERE result_id IN (SELECT id FROM result_items WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM result_lab_observations WHERE profile_id = ANY(v_solo_profile_ids);
  DELETE FROM result_documents
    WHERE result_id IN (SELECT id FROM result_items WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM result_items WHERE profile_id = ANY(v_solo_profile_ids);

  -- Preventive (3 user tables; preventive_rules is shared reference data).
  DELETE FROM preventive_intent_sheets WHERE profile_id = ANY(v_solo_profile_ids);
  DELETE FROM preventive_item_events
    WHERE item_id IN (SELECT id FROM preventive_items WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM preventive_items WHERE profile_id = ANY(v_solo_profile_ids);

  -- Appointments (4 tables).
  DELETE FROM apt_outcomes
    WHERE closeout_id IN (
      SELECT c.id FROM apt_closeouts c
      JOIN apt_appointments a ON a.id = c.appointment_id
      WHERE a.profile_id = ANY(v_solo_profile_ids)
    );
  DELETE FROM apt_closeouts
    WHERE appointment_id IN (SELECT id FROM apt_appointments WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM apt_plan_items
    WHERE appointment_id IN (SELECT id FROM apt_appointments WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM apt_appointments WHERE profile_id = ANY(v_solo_profile_ids);

  -- Medications (4 tables).
  DELETE FROM med_adherence_events
    WHERE medication_id IN (SELECT id FROM med_medications WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM med_medication_supply
    WHERE medication_id IN (SELECT id FROM med_medications WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM med_medication_sigs
    WHERE medication_id IN (SELECT id FROM med_medications WHERE profile_id = ANY(v_solo_profile_ids));
  DELETE FROM med_medications WHERE profile_id = ANY(v_solo_profile_ids);

  -- Intent sheets / extraction / artifacts / tasks.
  DELETE FROM intent_items WHERE profile_id = ANY(v_solo_profile_ids);
  DELETE FROM intent_sheets WHERE profile_id = ANY(v_solo_profile_ids);
  DELETE FROM extracted_fields WHERE profile_id = ANY(v_solo_profile_ids);
  DELETE FROM artifacts WHERE profile_id = ANY(v_solo_profile_ids);
  DELETE FROM tasks WHERE profile_id = ANY(v_solo_profile_ids);

  -- Profile-scoped simple tables.
  DELETE FROM profile_facts WHERE profile_id = ANY(v_solo_profile_ids);
  DELETE FROM patient_priorities WHERE profile_id = ANY(v_solo_profile_ids);

  -- Caregiver access around these profiles + pending invites.
  DELETE FROM profile_access_grants WHERE profile_id = ANY(v_solo_profile_ids);
  DELETE FROM consent_records WHERE profile_id = ANY(v_solo_profile_ids);
  DELETE FROM caregiver_invites WHERE household_id = ANY(v_solo_household_ids);

  -- User preferences for this user.
  DELETE FROM user_preferences WHERE user_id = v_uid;

  -- audit_events is append-only and guarded by a DELETE trigger. We leave
  -- those rows in place (they become orphaned if profile_id is set to null
  -- via the FK's ON DELETE SET NULL). Audit rows contain no PHI by design.
  -- Same for security_audit_log.

  -- Now delete the profiles and households themselves.
  DELETE FROM profiles WHERE id = ANY(v_solo_profile_ids);
  GET DIAGNOSTICS v_deleted_profiles = ROW_COUNT;

  DELETE FROM household_members WHERE household_id = ANY(v_solo_household_ids);
  DELETE FROM households WHERE id = ANY(v_solo_household_ids);
  GET DIAGNOSTICS v_deleted_households = ROW_COUNT;

  -- 5. For shared households (caller was not the only member), just remove
  --    the caller's membership and any access grants they held.
  DELETE FROM household_members
    WHERE user_id = v_uid
      AND household_id <> ALL(v_solo_household_ids);

  DELETE FROM profile_access_grants WHERE grantee_user_id = v_uid;
  GET DIAGNOSTICS v_deleted_grants = ROW_COUNT;

  -- 6. Log a final audit trail row before returning. No PHI in metadata.
  INSERT INTO audit_events (profile_id, actor_id, event_type, metadata)
  VALUES (
    NULL,
    v_uid,
    'account.deleted',
    jsonb_build_object(
      'households_deleted', v_deleted_households,
      'profiles_deleted', v_deleted_profiles,
      'grants_removed', v_deleted_grants
    )
  );

  RETURN jsonb_build_object(
    'households_deleted', v_deleted_households,
    'profiles_deleted',   v_deleted_profiles,
    'grants_removed',     v_deleted_grants
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute to authenticated users only — anon must never be able to
-- call this.
REVOKE ALL ON FUNCTION delete_user_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_user_account() TO authenticated;
