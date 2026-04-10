-- ============================================================================
-- 00006_appointments.sql
-- Appointments module: appointments, plan items, closeouts, outcomes.
-- Treats appointments as care episode anchors, not calendar entries.
-- ============================================================================

-- ── 1. APT_APPOINTMENTS ─────────────────────────────────────────────────────
CREATE TABLE apt_appointments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  appointment_type      TEXT NOT NULL DEFAULT 'doctor'
                        CHECK (appointment_type IN ('doctor', 'labs', 'imaging', 'procedure', 'therapy', 'other')),
  provider_name         TEXT,
  facility_name         TEXT,
  location_text         TEXT,
  purpose               TEXT,
  notes                 TEXT,
  start_time            TIMESTAMPTZ NOT NULL,
  end_time              TIMESTAMPTZ,
  timezone              TEXT NOT NULL DEFAULT 'America/Chicago',
  status                TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('draft', 'scheduled', 'preparing', 'ready', 'completed', 'cancelled', 'rescheduled')),
  plan_status           TEXT NOT NULL DEFAULT 'none'
                        CHECK (plan_status IN ('none', 'draft', 'committed', 'needs_review')),
  linked_appointment_id UUID REFERENCES apt_appointments(id) ON DELETE SET NULL,
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX idx_apt_appointments_profile_id ON apt_appointments(profile_id);
CREATE INDEX idx_apt_appointments_status ON apt_appointments(profile_id, status);
CREATE INDEX idx_apt_appointments_start_time ON apt_appointments(start_time) WHERE deleted_at IS NULL;
CREATE INDEX idx_apt_appointments_linked ON apt_appointments(linked_appointment_id) WHERE linked_appointment_id IS NOT NULL;

CREATE TRIGGER trg_apt_appointments_updated_at
  BEFORE UPDATE ON apt_appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. APT_PLAN_ITEMS ───────────────────────────────────────────────────────
CREATE TABLE apt_plan_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  UUID NOT NULL REFERENCES apt_appointments(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_type       TEXT NOT NULL
                  CHECK (item_type IN ('task', 'logistics', 'prep', 'question')),
  title           TEXT NOT NULL,
  description     TEXT,
  priority        TEXT NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('low', 'medium', 'high')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed', 'accepted', 'rejected', 'completed')),
  assigned_to     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at          TIMESTAMPTZ,
  reminder_at     TIMESTAMPTZ,
  metadata_json   JSONB,
  source          TEXT NOT NULL DEFAULT 'template'
                  CHECK (source IN ('template', 'ai_generated', 'manual')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_apt_plan_items_appointment_id ON apt_plan_items(appointment_id);
CREATE INDEX idx_apt_plan_items_profile_id ON apt_plan_items(profile_id);
CREATE INDEX idx_apt_plan_items_status ON apt_plan_items(appointment_id, status);

CREATE TRIGGER trg_apt_plan_items_updated_at
  BEFORE UPDATE ON apt_plan_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 3. APT_CLOSEOUTS ────────────────────────────────────────────────────────
CREATE TABLE apt_closeouts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id       UUID NOT NULL REFERENCES apt_appointments(id) ON DELETE CASCADE,
  profile_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'needs_review', 'finalized')),
  visit_happened       BOOLEAN,
  quick_summary        TEXT,
  followup_timeframe   TEXT,
  attendees            TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_apt_closeouts_appointment_id ON apt_closeouts(appointment_id);
CREATE INDEX idx_apt_closeouts_profile_id ON apt_closeouts(profile_id);
CREATE INDEX idx_apt_closeouts_status ON apt_closeouts(profile_id, status);

CREATE TRIGGER trg_apt_closeouts_updated_at
  BEFORE UPDATE ON apt_closeouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 4. APT_OUTCOMES ─────────────────────────────────────────────────────────
CREATE TABLE apt_outcomes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closeout_id    UUID NOT NULL REFERENCES apt_closeouts(id) ON DELETE CASCADE,
  profile_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  outcome_type   TEXT NOT NULL
                 CHECK (outcome_type IN ('followup_action', 'medication_change', 'diagnosis_change', 'allergy_change', 'order', 'instruction')),
  description    TEXT NOT NULL,
  proposed_value JSONB,
  confidence     NUMERIC(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status         TEXT NOT NULL DEFAULT 'proposed'
                 CHECK (status IN ('proposed', 'accepted', 'edited', 'rejected')),
  edited_value   JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_apt_outcomes_closeout_id ON apt_outcomes(closeout_id);
CREATE INDEX idx_apt_outcomes_profile_id ON apt_outcomes(profile_id);
CREATE INDEX idx_apt_outcomes_status ON apt_outcomes(closeout_id, status);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE apt_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY apt_appointments_select ON apt_appointments FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY apt_appointments_insert ON apt_appointments FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY apt_appointments_update ON apt_appointments FOR UPDATE
  USING (has_profile_access(profile_id));

ALTER TABLE apt_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY apt_plan_items_select ON apt_plan_items FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY apt_plan_items_insert ON apt_plan_items FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY apt_plan_items_update ON apt_plan_items FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY apt_plan_items_delete ON apt_plan_items FOR DELETE
  USING (has_profile_access(profile_id));

ALTER TABLE apt_closeouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY apt_closeouts_select ON apt_closeouts FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY apt_closeouts_insert ON apt_closeouts FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY apt_closeouts_update ON apt_closeouts FOR UPDATE
  USING (has_profile_access(profile_id));

ALTER TABLE apt_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY apt_outcomes_select ON apt_outcomes FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY apt_outcomes_insert ON apt_outcomes FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY apt_outcomes_update ON apt_outcomes FOR UPDATE
  USING (has_profile_access(profile_id));
