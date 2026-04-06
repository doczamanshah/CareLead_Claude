-- ============================================================================
-- CareLead Foundation Migration
-- Creates core tables: households, profiles, members, profile_facts,
-- artifacts, extraction pipeline, intent sheets, tasks, and audit trail.
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- UTILITY: auto-update updated_at trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. HOUSEHOLDS
-- ============================================================================
CREATE TABLE households (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_households_updated_at
  BEFORE UPDATE ON households
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 2. PROFILES
-- ============================================================================
CREATE TABLE profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name  TEXT NOT NULL,
  date_of_birth DATE,
  gender        TEXT,
  relationship  TEXT NOT NULL DEFAULT 'self'
                CHECK (relationship IN ('self', 'dependent')),
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_profiles_household_id ON profiles(household_id);
CREATE INDEX idx_profiles_user_id ON profiles(user_id);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 3. HOUSEHOLD_MEMBERS
-- ============================================================================
CREATE TABLE household_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('owner', 'admin', 'caregiver', 'viewer')),
  status        TEXT NOT NULL DEFAULT 'invited'
                CHECK (status IN ('active', 'invited', 'removed')),
  invited_email TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_household_members_household_id ON household_members(household_id);
CREATE INDEX idx_household_members_user_id ON household_members(user_id);

CREATE TRIGGER trg_household_members_updated_at
  BEFORE UPDATE ON household_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 4. PROFILE_FACTS
-- ============================================================================
CREATE TABLE profile_facts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category            TEXT NOT NULL
                      CHECK (category IN (
                        'condition', 'allergy', 'medication', 'surgery',
                        'family_history', 'insurance', 'care_team', 'pharmacy',
                        'emergency_contact', 'goal', 'measurement'
                      )),
  field_key           TEXT NOT NULL,
  value_json          JSONB NOT NULL,
  source_type         TEXT NOT NULL DEFAULT 'manual'
                      CHECK (source_type IN ('manual', 'voice', 'photo', 'document', 'import')),
  source_ref          TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
                      CHECK (verification_status IN ('unverified', 'verified', 'needs_review')),
  verified_at         TIMESTAMPTZ,
  verified_by         UUID REFERENCES auth.users(id),
  actor_id            UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_profile_facts_profile_id ON profile_facts(profile_id);
CREATE INDEX idx_profile_facts_category ON profile_facts(profile_id, category);

CREATE TRIGGER trg_profile_facts_updated_at
  BEFORE UPDATE ON profile_facts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 5. ARTIFACTS
-- ============================================================================
CREATE TABLE artifacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  artifact_type     TEXT NOT NULL
                    CHECK (artifact_type IN ('document', 'note', 'photo', 'scan')),
  file_path         TEXT,
  file_name         TEXT,
  file_size         BIGINT,
  mime_type         TEXT,
  source_channel    TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source_channel IN ('upload', 'camera', 'scan', 'voice', 'email', 'manual')),
  processing_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  classification    TEXT,
  ocr_text          TEXT,
  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_artifacts_profile_id ON artifacts(profile_id);
CREATE INDEX idx_artifacts_processing_status ON artifacts(processing_status);

CREATE TRIGGER trg_artifacts_updated_at
  BEFORE UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 6. EXTRACTED_FIELDS
-- ============================================================================
CREATE TABLE extracted_fields (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id   UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  field_key     TEXT NOT NULL,
  value_json    JSONB NOT NULL,
  confidence    NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_json JSONB,
  status        TEXT NOT NULL DEFAULT 'unreviewed'
                CHECK (status IN ('unreviewed', 'accepted', 'rejected', 'superseded')),
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_extracted_fields_artifact_id ON extracted_fields(artifact_id);
CREATE INDEX idx_extracted_fields_profile_id ON extracted_fields(profile_id);

-- ============================================================================
-- 7. INTENT_SHEETS
-- ============================================================================
CREATE TABLE intent_sheets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  artifact_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL DEFAULT 'extraction'
              CHECK (source_type IN ('extraction', 'manual', 'voice', 'reconciliation')),
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'pending_review', 'partially_committed', 'committed', 'dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_intent_sheets_profile_id ON intent_sheets(profile_id);
CREATE INDEX idx_intent_sheets_artifact_id ON intent_sheets(artifact_id);

CREATE TRIGGER trg_intent_sheets_updated_at
  BEFORE UPDATE ON intent_sheets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 8. INTENT_ITEMS
-- ============================================================================
CREATE TABLE intent_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_sheet_id UUID NOT NULL REFERENCES intent_sheets(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_type       TEXT NOT NULL
                  CHECK (item_type IN ('profile_fact', 'task', 'reminder', 'medication', 'appointment')),
  field_key       TEXT,
  proposed_value  JSONB NOT NULL,
  current_value   JSONB,
  confidence      NUMERIC(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence_json   JSONB,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'edited', 'rejected')),
  edited_value    JSONB,
  committed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_intent_items_intent_sheet_id ON intent_items(intent_sheet_id);
CREATE INDEX idx_intent_items_profile_id ON intent_items(profile_id);

-- ============================================================================
-- 9. TASKS
-- ============================================================================
CREATE TABLE tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  due_date     TIMESTAMPTZ,
  priority     TEXT NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'in_progress', 'completed', 'dismissed')),
  source_type  TEXT NOT NULL DEFAULT 'manual'
               CHECK (source_type IN ('manual', 'intent_sheet', 'appointment', 'medication', 'billing')),
  source_ref   TEXT,
  assigned_to  UUID REFERENCES auth.users(id),
  reminder_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX idx_tasks_profile_id ON tasks(profile_id);
CREATE INDEX idx_tasks_status ON tasks(profile_id, status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 10. AUDIT_EVENTS (append-only)
-- ============================================================================
CREATE TABLE audit_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_id   UUID NOT NULL REFERENCES auth.users(id),
  event_type TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_profile_id ON audit_events(profile_id);
CREATE INDEX idx_audit_events_actor_id ON audit_events(actor_id);
CREATE INDEX idx_audit_events_event_type ON audit_events(event_type);

-- Prevent UPDATE and DELETE on audit_events
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % operations are not allowed', TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Helper: check if the current user is a member of the given household
CREATE OR REPLACE FUNCTION is_household_member(p_household_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM household_members
    WHERE household_id = p_household_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Helper: check if the current user has access to the given profile
CREATE OR REPLACE FUNCTION has_profile_access(p_profile_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles p
    JOIN household_members hm ON hm.household_id = p.household_id
    WHERE p.id = p_profile_id
      AND hm.user_id = auth.uid()
      AND hm.status = 'active'
      AND p.deleted_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- HOUSEHOLDS
ALTER TABLE households ENABLE ROW LEVEL SECURITY;

CREATE POLICY households_select ON households FOR SELECT
  USING (is_household_member(id));

CREATE POLICY households_insert ON households FOR INSERT
  WITH CHECK (true); -- anyone can create a household; membership is created separately

CREATE POLICY households_update ON households FOR UPDATE
  USING (is_household_member(id));

-- PROFILES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (is_household_member(household_id));

CREATE POLICY profiles_insert ON profiles FOR INSERT
  WITH CHECK (is_household_member(household_id));

CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (is_household_member(household_id));

-- HOUSEHOLD_MEMBERS
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY household_members_select ON household_members FOR SELECT
  USING (is_household_member(household_id));

CREATE POLICY household_members_insert ON household_members FOR INSERT
  WITH CHECK (is_household_member(household_id));

CREATE POLICY household_members_update ON household_members FOR UPDATE
  USING (is_household_member(household_id));

-- PROFILE_FACTS
ALTER TABLE profile_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY profile_facts_select ON profile_facts FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY profile_facts_insert ON profile_facts FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY profile_facts_update ON profile_facts FOR UPDATE
  USING (has_profile_access(profile_id));

-- ARTIFACTS
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY artifacts_select ON artifacts FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY artifacts_insert ON artifacts FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY artifacts_update ON artifacts FOR UPDATE
  USING (has_profile_access(profile_id));

-- EXTRACTED_FIELDS
ALTER TABLE extracted_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY extracted_fields_select ON extracted_fields FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY extracted_fields_insert ON extracted_fields FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY extracted_fields_update ON extracted_fields FOR UPDATE
  USING (has_profile_access(profile_id));

-- INTENT_SHEETS
ALTER TABLE intent_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY intent_sheets_select ON intent_sheets FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY intent_sheets_insert ON intent_sheets FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY intent_sheets_update ON intent_sheets FOR UPDATE
  USING (has_profile_access(profile_id));

-- INTENT_ITEMS
ALTER TABLE intent_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY intent_items_select ON intent_items FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY intent_items_insert ON intent_items FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY intent_items_update ON intent_items FOR UPDATE
  USING (has_profile_access(profile_id));

-- TASKS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_select ON tasks FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY tasks_insert ON tasks FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY tasks_update ON tasks FOR UPDATE
  USING (has_profile_access(profile_id));

-- AUDIT_EVENTS
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_events_select ON audit_events FOR SELECT
  USING (
    profile_id IS NULL AND actor_id = auth.uid()
    OR has_profile_access(profile_id)
  );

CREATE POLICY audit_events_insert ON audit_events FOR INSERT
  WITH CHECK (actor_id = auth.uid());
