-- ============================================================================
-- Migration 00008: Medications Module
-- Creates dedicated medication tables with sig (directions), supply (refill
-- tracking), and adherence event logging.
-- ============================================================================

-- ── 1. med_medications ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS med_medications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES profiles(id),
  drug_name       TEXT NOT NULL,
  strength        TEXT,
  form            TEXT CHECK (form IN (
                    'tablet','capsule','liquid','cream','injection',
                    'inhaler','patch','drops','other'
                  )),
  route           TEXT CHECK (route IN (
                    'oral','topical','injection','inhaled','sublingual','other'
                  )),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','stopped')),
  prn_flag        BOOLEAN NOT NULL DEFAULT false,
  notes           TEXT,
  source_type     TEXT,
  source_ref      TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE med_medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "med_medications_select" ON med_medications
  FOR SELECT USING (has_profile_access(profile_id));

CREATE POLICY "med_medications_insert" ON med_medications
  FOR INSERT WITH CHECK (has_profile_access(profile_id));

CREATE POLICY "med_medications_update" ON med_medications
  FOR UPDATE USING (has_profile_access(profile_id));

CREATE POLICY "med_medications_delete" ON med_medications
  FOR DELETE USING (has_profile_access(profile_id));

CREATE INDEX idx_med_medications_profile ON med_medications(profile_id);
CREATE INDEX idx_med_medications_status  ON med_medications(status);

-- ── 2. med_medication_sigs (directions) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS med_medication_sigs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id   UUID NOT NULL REFERENCES med_medications(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id),
  dose_text       TEXT,
  frequency_text  TEXT,
  timing_json     JSONB,
  instructions    TEXT,
  source_type     TEXT,
  source_ref      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE med_medication_sigs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "med_medication_sigs_select" ON med_medication_sigs
  FOR SELECT USING (has_profile_access(profile_id));

CREATE POLICY "med_medication_sigs_insert" ON med_medication_sigs
  FOR INSERT WITH CHECK (has_profile_access(profile_id));

CREATE POLICY "med_medication_sigs_update" ON med_medication_sigs
  FOR UPDATE USING (has_profile_access(profile_id));

CREATE POLICY "med_medication_sigs_delete" ON med_medication_sigs
  FOR DELETE USING (has_profile_access(profile_id));

CREATE INDEX idx_med_medication_sigs_medication ON med_medication_sigs(medication_id);
CREATE INDEX idx_med_medication_sigs_profile    ON med_medication_sigs(profile_id);

-- ── 3. med_medication_supply (refill tracking) ─────────────────────────────

CREATE TABLE IF NOT EXISTS med_medication_supply (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id     UUID NOT NULL REFERENCES med_medications(id) ON DELETE CASCADE,
  profile_id        UUID NOT NULL REFERENCES profiles(id),
  last_fill_date    DATE,
  days_supply       INTEGER,
  refills_remaining INTEGER,
  pharmacy_name     TEXT,
  pharmacy_phone    TEXT,
  prescriber_name   TEXT,
  prescriber_phone  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE med_medication_supply ENABLE ROW LEVEL SECURITY;

CREATE POLICY "med_medication_supply_select" ON med_medication_supply
  FOR SELECT USING (has_profile_access(profile_id));

CREATE POLICY "med_medication_supply_insert" ON med_medication_supply
  FOR INSERT WITH CHECK (has_profile_access(profile_id));

CREATE POLICY "med_medication_supply_update" ON med_medication_supply
  FOR UPDATE USING (has_profile_access(profile_id));

CREATE POLICY "med_medication_supply_delete" ON med_medication_supply
  FOR DELETE USING (has_profile_access(profile_id));

CREATE INDEX idx_med_medication_supply_medication ON med_medication_supply(medication_id);
CREATE INDEX idx_med_medication_supply_profile    ON med_medication_supply(profile_id);

-- ── 4. med_adherence_events ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS med_adherence_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id   UUID NOT NULL REFERENCES med_medications(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id),
  event_type      TEXT NOT NULL CHECK (event_type IN ('taken','skipped','snoozed')),
  scheduled_time  TIMESTAMPTZ,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE med_adherence_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "med_adherence_events_select" ON med_adherence_events
  FOR SELECT USING (has_profile_access(profile_id));

CREATE POLICY "med_adherence_events_insert" ON med_adherence_events
  FOR INSERT WITH CHECK (has_profile_access(profile_id));

CREATE POLICY "med_adherence_events_delete" ON med_adherence_events
  FOR DELETE USING (has_profile_access(profile_id));

CREATE INDEX idx_med_adherence_events_medication ON med_adherence_events(medication_id);
CREATE INDEX idx_med_adherence_events_profile    ON med_adherence_events(profile_id);
CREATE INDEX idx_med_adherence_events_recorded   ON med_adherence_events(recorded_at);

-- ── 5. updated_at triggers ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER set_med_medications_updated_at
  BEFORE UPDATE ON med_medications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_med_medication_sigs_updated_at
  BEFORE UPDATE ON med_medication_sigs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_med_medication_supply_updated_at
  BEFORE UPDATE ON med_medication_supply
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
