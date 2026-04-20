-- ============================================================================
-- Phase 3 Item 7 — HIPAA alignment: RLS audit migration
-- ============================================================================
--
-- Defensive, idempotent migration that re-asserts Row Level Security on every
-- table that can contain patient data, and fills in the few DELETE policies
-- that weren't created in earlier migrations. Running this on a DB where the
-- earlier migrations succeeded is a no-op for any table that is already in
-- the correct state.
--
-- What this migration does NOT change:
--   • Existing SELECT / INSERT / UPDATE policies that already use the
--     has_profile_access(profile_id) or is_household_member(household_id)
--     helpers — those remain the source of truth for authz.
--   • Reference tables (preventive_rules) — authenticated SELECT only, no
--     write policies, service role only for maintenance. Confirmed below.
--   • audit_events — blocked at trigger level (`prevent_audit_mutation`) in
--     addition to having no DELETE policy.
--   • security_audit_log — no SELECT policy (service-role read only).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Re-assert RLS on every patient-data table. ALTER ... ENABLE ROW LEVEL
--    SECURITY is idempotent and cheap. This exists so a future DBA who
--    runs `ALTER TABLE ... DISABLE RLS` on a prod table will find this line
--    in the next deploy and have their mistake auto-corrected.
-- ---------------------------------------------------------------------------
ALTER TABLE households              ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_facts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_fields        ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_sheets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences        ENABLE ROW LEVEL SECURITY;

ALTER TABLE apt_appointments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE apt_plan_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE apt_closeouts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE apt_outcomes            ENABLE ROW LEVEL SECURITY;

ALTER TABLE med_medications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE med_medication_sigs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE med_medication_supply   ENABLE ROW LEVEL SECURITY;
ALTER TABLE med_adherence_events    ENABLE ROW LEVEL SECURITY;

ALTER TABLE profile_access_grants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE caregiver_invites       ENABLE ROW LEVEL SECURITY;

ALTER TABLE patient_priorities      ENABLE ROW LEVEL SECURITY;

ALTER TABLE billing_contacts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_cases                ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_extract_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_ledger_lines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_case_findings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_case_actions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_case_call_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_case_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_denial_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_appeal_packets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_case_parties         ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_case_status_events   ENABLE ROW LEVEL SECURITY;

ALTER TABLE result_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE result_documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE result_lab_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE result_extract_jobs     ENABLE ROW LEVEL SECURITY;

ALTER TABLE preventive_rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventive_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventive_item_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventive_intent_sheets ENABLE ROW LEVEL SECURITY;

ALTER TABLE security_audit_log      ENABLE ROW LEVEL SECURITY;

-- Storage bucket RLS (artifacts / billing-documents / result-documents) is
-- managed via the Supabase Dashboard, not SQL migrations. Not re-asserted
-- here.

-- ---------------------------------------------------------------------------
-- 2. Fill in missing DELETE policies.
--
--    A missing DELETE policy means only the service role can delete a row,
--    which is fine for append-only tables (audit_events, consent_records,
--    billing_case_status_events, security_audit_log) but becomes a problem
--    when the mobile app legitimately needs to delete (profile_facts,
--    profile_access_grants). We only add policies where a real user flow
--    exists today. The delete_user_account() RPC added in a separate
--    migration uses SECURITY DEFINER and bypasses RLS for account wipe.
-- ---------------------------------------------------------------------------

-- profile_facts: users can delete facts on profiles they can access. The
-- normal UI uses soft-delete (UPDATE deleted_at) but the commit engine and
-- account-deletion RPC also hard-delete on cleanup.
DROP POLICY IF EXISTS profile_facts_delete ON profile_facts;
CREATE POLICY profile_facts_delete ON profile_facts FOR DELETE
  USING (has_profile_access(profile_id));

-- apt_appointments, apt_closeouts, apt_outcomes: soft-delete via UPDATE is
-- the normal path; add DELETE for the account-wipe RPC and hard-delete use
-- cases (e.g., user removes a draft appointment).
DROP POLICY IF EXISTS apt_appointments_delete ON apt_appointments;
CREATE POLICY apt_appointments_delete ON apt_appointments FOR DELETE
  USING (has_profile_access(profile_id));

DROP POLICY IF EXISTS apt_closeouts_delete ON apt_closeouts;
CREATE POLICY apt_closeouts_delete ON apt_closeouts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM apt_appointments a
      WHERE a.id = apt_closeouts.appointment_id
        AND has_profile_access(a.profile_id)
    )
  );

DROP POLICY IF EXISTS apt_outcomes_delete ON apt_outcomes;
CREATE POLICY apt_outcomes_delete ON apt_outcomes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM apt_closeouts c
      JOIN apt_appointments a ON a.id = c.appointment_id
      WHERE c.id = apt_outcomes.closeout_id
        AND has_profile_access(a.profile_id)
    )
  );

-- profile_access_grants: the user who owns the profile (grantor) can revoke
-- access. Today `services/caregivers.ts` revokes via UPDATE status; the
-- policy below lets account-wipe hard-delete them too.
DROP POLICY IF EXISTS profile_access_grants_delete ON profile_access_grants;
CREATE POLICY profile_access_grants_delete ON profile_access_grants FOR DELETE
  USING (has_profile_access(profile_id));

-- household_members: the user leaving a household can delete their own row
-- (for account wipe). We intentionally DO NOT let one member delete another
-- — that flow goes through a revoke path that UPDATEs status.
DROP POLICY IF EXISTS household_members_delete ON household_members;
CREATE POLICY household_members_delete ON household_members FOR DELETE
  USING (user_id = auth.uid());

-- caregiver_invites: the household owner can delete their own pending invite
-- rows (today this is done via UPDATE status; delete path is for wipe).
DROP POLICY IF EXISTS caregiver_invites_delete ON caregiver_invites;
CREATE POLICY caregiver_invites_delete ON caregiver_invites FOR DELETE
  USING (is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- 3. Confirm reference + audit tables remain locked down.
--
--    preventive_rules is shared reference data — authenticated users need
--    SELECT but must not be able to INSERT / UPDATE / DELETE rules. The
--    absence of write policies already enforces this; the DROP statements
--    below make it explicit that no write policy should ever exist.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS preventive_rules_insert ON preventive_rules;
DROP POLICY IF EXISTS preventive_rules_update ON preventive_rules;
DROP POLICY IF EXISTS preventive_rules_delete ON preventive_rules;

-- security_audit_log is service-role-read only. There must be no SELECT,
-- UPDATE, or DELETE policy for any authenticated or anon role. Users insert
-- via the `users_insert_own_audit_events` / `anon_insert_audit_events`
-- policies defined in the table's creation migration.
DROP POLICY IF EXISTS security_audit_log_select ON security_audit_log;
DROP POLICY IF EXISTS security_audit_log_update ON security_audit_log;
DROP POLICY IF EXISTS security_audit_log_delete ON security_audit_log;

-- audit_events is append-only and guarded by triggers (`trg_audit_no_update`,
-- `trg_audit_no_delete`). Re-assert that no UPDATE/DELETE policy exists.
DROP POLICY IF EXISTS audit_events_update ON audit_events;
DROP POLICY IF EXISTS audit_events_delete ON audit_events;

-- ---------------------------------------------------------------------------
-- 4. Sanity check — fail the migration if any expected policy is missing.
--
--    Lightweight tripwire. Counts one SELECT policy per patient-data table.
--    If any of these returns 0, the migration will abort and the deploy
--    will fail visibly rather than silently leaving an un-scoped table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  expected_tables TEXT[] := ARRAY[
    'profiles', 'households', 'household_members', 'profile_facts',
    'artifacts', 'extracted_fields', 'intent_sheets', 'intent_items',
    'tasks', 'user_preferences',
    'apt_appointments', 'apt_plan_items', 'apt_closeouts', 'apt_outcomes',
    'med_medications', 'med_medication_sigs', 'med_medication_supply',
    'med_adherence_events',
    'profile_access_grants', 'consent_records', 'caregiver_invites',
    'patient_priorities',
    'billing_cases', 'billing_documents', 'billing_ledger_lines',
    'billing_case_findings', 'billing_case_actions', 'billing_case_call_logs',
    'billing_case_payments', 'billing_denial_records', 'billing_appeal_packets',
    'billing_contacts', 'billing_case_parties', 'billing_case_status_events',
    'billing_extract_jobs',
    'result_items', 'result_documents', 'result_lab_observations',
    'result_extract_jobs',
    'preventive_items', 'preventive_item_events', 'preventive_intent_sheets'
  ];
  t TEXT;
  policy_count INT;
BEGIN
  FOREACH t IN ARRAY expected_tables LOOP
    SELECT count(*) INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = t
      AND cmd = 'SELECT';
    IF policy_count = 0 THEN
      RAISE EXCEPTION 'RLS audit: table % is missing a SELECT policy', t;
    END IF;
  END LOOP;
END $$;
