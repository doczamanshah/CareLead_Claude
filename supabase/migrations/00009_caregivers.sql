-- ══════════════════════════════════════════════════════════════════════
-- Migration 00009: Caregivers & Permissions
-- Phase 1 Step 9 — Invitation flow, permission system, consent recording
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Profile Access Grants ──────────────────────────────────────────
-- The authoritative record of who has access to which profile and what they can do.

CREATE TABLE IF NOT EXISTS profile_access_grants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  grantee_user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by_user_id  UUID NOT NULL REFERENCES auth.users(id),
  permission_template TEXT NOT NULL
                      CHECK (permission_template IN (
                        'full_helper',
                        'bills_insurance',
                        'medications',
                        'appointments_tasks',
                        'documents_only',
                        'view_only'
                      )),
  scopes              JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at          TIMESTAMPTZ,
  revoked_by          UUID REFERENCES auth.users(id),
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS idx_access_grants_profile ON profile_access_grants(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_access_grants_grantee ON profile_access_grants(grantee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_access_grants_status ON profile_access_grants(status);

-- Updated-at trigger
CREATE TRIGGER set_access_grants_updated_at
  BEFORE UPDATE ON profile_access_grants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE profile_access_grants ENABLE ROW LEVEL SECURITY;

-- Users can read grants for profiles in their household or grants where they are the grantee
CREATE POLICY "access_grants_select" ON profile_access_grants
  FOR SELECT USING (
    grantee_user_id = auth.uid()
    OR granted_by_user_id = auth.uid()
    OR profile_id IN (
      SELECT p.id FROM profiles p
      JOIN household_members hm ON hm.household_id = p.household_id
      WHERE hm.user_id = auth.uid() AND hm.status = 'active'
    )
  );

-- Only household members with owner/admin role can insert grants
CREATE POLICY "access_grants_insert" ON profile_access_grants
  FOR INSERT WITH CHECK (
    profile_id IN (
      SELECT p.id FROM profiles p
      JOIN household_members hm ON hm.household_id = p.household_id
      WHERE hm.user_id = auth.uid()
        AND hm.status = 'active'
        AND hm.role IN ('owner', 'admin')
    )
  );

-- Only household owners/admins or the granting user can update grants
CREATE POLICY "access_grants_update" ON profile_access_grants
  FOR UPDATE USING (
    granted_by_user_id = auth.uid()
    OR profile_id IN (
      SELECT p.id FROM profiles p
      JOIN household_members hm ON hm.household_id = p.household_id
      WHERE hm.user_id = auth.uid()
        AND hm.status = 'active'
        AND hm.role IN ('owner', 'admin')
    )
  );


-- ── 2. Consent Records ───────────────────────────────────────────────
-- Append-only audit-grade documentation of every permission change.

CREATE TABLE IF NOT EXISTS consent_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consenter_user_id   UUID NOT NULL REFERENCES auth.users(id),
  grantee_user_id     UUID NOT NULL REFERENCES auth.users(id),
  grant_id            UUID NOT NULL REFERENCES profile_access_grants(id) ON DELETE CASCADE,
  consent_type        TEXT NOT NULL
                      CHECK (consent_type IN ('access_granted', 'access_modified', 'access_revoked')),
  permission_template TEXT NOT NULL,
  scopes              JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No updated_at — this table is append-only
-- No DELETE policy — consent records are never deleted

CREATE INDEX IF NOT EXISTS idx_consent_records_profile ON consent_records(profile_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_grant ON consent_records(grant_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_grantee ON consent_records(grantee_user_id);

-- RLS
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

-- Users can read consent records for profiles in their household or where they are involved
CREATE POLICY "consent_records_select" ON consent_records
  FOR SELECT USING (
    consenter_user_id = auth.uid()
    OR grantee_user_id = auth.uid()
    OR profile_id IN (
      SELECT p.id FROM profiles p
      JOIN household_members hm ON hm.household_id = p.household_id
      WHERE hm.user_id = auth.uid() AND hm.status = 'active'
    )
  );

-- Only household owners/admins can insert consent records
CREATE POLICY "consent_records_insert" ON consent_records
  FOR INSERT WITH CHECK (
    consenter_user_id = auth.uid()
    AND profile_id IN (
      SELECT p.id FROM profiles p
      JOIN household_members hm ON hm.household_id = p.household_id
      WHERE hm.user_id = auth.uid()
        AND hm.status = 'active'
        AND hm.role IN ('owner', 'admin')
    )
  );

-- No UPDATE or DELETE policies — append-only


-- ── 3. Caregiver Invites ─────────────────────────────────────────────
-- Pending invitations that haven't been accepted yet.

CREATE TABLE IF NOT EXISTS caregiver_invites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  invited_by_user_id  UUID NOT NULL REFERENCES auth.users(id),
  invited_email       TEXT NOT NULL,
  invited_name        TEXT,
  profile_ids         UUID[] NOT NULL,
  permission_template TEXT NOT NULL
                      CHECK (permission_template IN (
                        'full_helper',
                        'bills_insurance',
                        'medications',
                        'appointments_tasks',
                        'documents_only',
                        'view_only'
                      )),
  token               TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at          TIMESTAMPTZ NOT NULL,
  accepted_at         TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caregiver_invites_household ON caregiver_invites(household_id, status);
CREATE INDEX IF NOT EXISTS idx_caregiver_invites_email ON caregiver_invites(invited_email, status);
CREATE INDEX IF NOT EXISTS idx_caregiver_invites_token ON caregiver_invites(token);

-- RLS
ALTER TABLE caregiver_invites ENABLE ROW LEVEL SECURITY;

-- Household members can see invites for their household
CREATE POLICY "caregiver_invites_select" ON caregiver_invites
  FOR SELECT USING (
    invited_by_user_id = auth.uid()
    OR household_id IN (
      SELECT hm.household_id FROM household_members hm
      WHERE hm.user_id = auth.uid() AND hm.status = 'active'
    )
  );

-- Only household owners/admins can create invites
CREATE POLICY "caregiver_invites_insert" ON caregiver_invites
  FOR INSERT WITH CHECK (
    household_id IN (
      SELECT hm.household_id FROM household_members hm
      WHERE hm.user_id = auth.uid()
        AND hm.status = 'active'
        AND hm.role IN ('owner', 'admin')
    )
  );

-- Invites can be updated by the creator or household owners/admins
CREATE POLICY "caregiver_invites_update" ON caregiver_invites
  FOR UPDATE USING (
    invited_by_user_id = auth.uid()
    OR household_id IN (
      SELECT hm.household_id FROM household_members hm
      WHERE hm.user_id = auth.uid()
        AND hm.status = 'active'
        AND hm.role IN ('owner', 'admin')
    )
  );
