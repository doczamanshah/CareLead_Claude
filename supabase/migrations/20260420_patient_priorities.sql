-- ══════════════════════════════════════════════════════════════════════
-- Migration: Patient Priorities ("What Matters to You")
-- Stores each profile's personal priorities, friction points, and
-- reminder preferences. One row per profile.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE patient_priorities (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  household_id           UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  raw_input              TEXT,
  health_priorities      JSONB NOT NULL DEFAULT '[]'::jsonb,
  friction_points        JSONB NOT NULL DEFAULT '[]'::jsonb,
  tracking_difficulties  JSONB NOT NULL DEFAULT '[]'::jsonb,
  support_context        JSONB,
  reminder_preferences   JSONB,
  conditions_of_focus    JSONB NOT NULL DEFAULT '[]'::jsonb,
  implicit_signals       JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_prompted_at       TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patient_priorities_profile_id ON patient_priorities(profile_id);
CREATE INDEX idx_patient_priorities_household_id ON patient_priorities(household_id);

CREATE TRIGGER trg_patient_priorities_updated_at
  BEFORE UPDATE ON patient_priorities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE patient_priorities ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_priorities_select ON patient_priorities FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY patient_priorities_insert ON patient_priorities FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY patient_priorities_update ON patient_priorities FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY patient_priorities_delete ON patient_priorities FOR DELETE
  USING (has_profile_access(profile_id));
