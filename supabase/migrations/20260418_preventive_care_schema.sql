-- ══════════════════════════════════════════════════════════════════════
-- Migration: Preventive Care Module (Phase 2)
-- Creates the rule library (preventive_rules), profile-scoped instances
-- (preventive_items), immutable audit trail (preventive_item_events),
-- and the review/commit gate (preventive_intent_sheets).
-- Also seeds the initial v1 ruleset (USPSTF/CDC-based).
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. preventive_rules ──────────────────────────────────────────────
-- System-defined rule library. Not user-editable.
-- eligibility_criteria is a structured JSON object the engine evaluates
-- against profile demographics and conditions.

CREATE TABLE preventive_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT NOT NULL UNIQUE,
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  category              TEXT NOT NULL
                        CHECK (category IN ('cancer_screening', 'immunization', 'cardiovascular', 'metabolic', 'bone_health', 'other')),
  eligibility_criteria  JSONB NOT NULL,
  cadence_months        INTEGER,
  guideline_source      TEXT NOT NULL,
  guideline_version     TEXT,
  guideline_url         TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_preventive_rules_code ON preventive_rules(code);
CREATE INDEX idx_preventive_rules_category ON preventive_rules(category);
CREATE INDEX idx_preventive_rules_is_active ON preventive_rules(is_active);

CREATE TRIGGER trg_preventive_rules_updated_at
  BEFORE UPDATE ON preventive_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ── 2. preventive_items ──────────────────────────────────────────────
-- Profile-scoped instances of rules. One row per (profile, rule).
-- Tracks current status, due dates, evidence of completion, and linkage
-- to tasks/appointments.

CREATE TABLE preventive_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id           UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  rule_id                UUID NOT NULL REFERENCES preventive_rules(id),
  status                 TEXT NOT NULL DEFAULT 'needs_review'
                         CHECK (status IN ('due', 'due_soon', 'scheduled', 'completed', 'up_to_date', 'needs_review', 'deferred', 'declined')),
  due_date               DATE,
  due_window_start       DATE,
  due_window_end         DATE,
  last_done_date         DATE,
  last_done_source       TEXT
                         CHECK (last_done_source IS NULL OR last_done_source IN ('user_reported', 'document_backed', 'extracted', 'imported')),
  last_done_evidence_id  UUID,
  next_due_date          DATE,
  rationale              TEXT,
  missing_data           JSONB NOT NULL DEFAULT '[]'::jsonb,
  deferred_until         DATE,
  declined_reason        TEXT,
  linked_task_id         UUID REFERENCES tasks(id) ON DELETE SET NULL,
  linked_appointment_id  UUID,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, rule_id)
);

CREATE INDEX idx_preventive_items_profile_id ON preventive_items(profile_id);
CREATE INDEX idx_preventive_items_household_id ON preventive_items(household_id);
CREATE INDEX idx_preventive_items_rule_id ON preventive_items(rule_id);
CREATE INDEX idx_preventive_items_status ON preventive_items(status);
CREATE INDEX idx_preventive_items_due_date ON preventive_items(due_date);

CREATE TRIGGER trg_preventive_items_updated_at
  BEFORE UPDATE ON preventive_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ── 3. preventive_item_events ────────────────────────────────────────
-- Immutable audit trail for every preventive_item state change.

CREATE TABLE preventive_item_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preventive_item_id   UUID NOT NULL REFERENCES preventive_items(id) ON DELETE CASCADE,
  profile_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id         UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  event_type           TEXT NOT NULL
                       CHECK (event_type IN ('created', 'recomputed', 'status_changed', 'intent_proposed', 'intent_confirmed', 'intent_committed', 'data_updated', 'deferred', 'declined', 'completed', 'reopened')),
  from_status          TEXT,
  to_status            TEXT,
  detail               JSONB,
  created_by           TEXT NOT NULL DEFAULT 'system'
                       CHECK (created_by IN ('system', 'user', 'extraction')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_preventive_item_events_preventive_item_id ON preventive_item_events(preventive_item_id);
CREATE INDEX idx_preventive_item_events_profile_id ON preventive_item_events(profile_id);
CREATE INDEX idx_preventive_item_events_event_type ON preventive_item_events(event_type);


-- ── 4. preventive_intent_sheets ──────────────────────────────────────
-- Review/commit gate. Follows the same accept/edit/reject pattern as
-- the main Intent Sheet — no data becomes verified without user review.

CREATE TABLE preventive_intent_sheets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  household_id      UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'review_ready', 'confirmed', 'committed', 'dismissed')),
  items_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_edits_json   JSONB,
  confirmed_at      TIMESTAMPTZ,
  committed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_preventive_intent_sheets_profile_id ON preventive_intent_sheets(profile_id);
CREATE INDEX idx_preventive_intent_sheets_status ON preventive_intent_sheets(status);

CREATE TRIGGER trg_preventive_intent_sheets_updated_at
  BEFORE UPDATE ON preventive_intent_sheets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════════════

-- preventive_rules — readable by any authenticated user. System-defined,
-- so no INSERT/UPDATE/DELETE policies for regular users (service role
-- bypasses RLS for seeding and rule management).
ALTER TABLE preventive_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY preventive_rules_select ON preventive_rules FOR SELECT
  TO authenticated
  USING (true);

-- preventive_items — gated through has_profile_access().
ALTER TABLE preventive_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY preventive_items_select ON preventive_items FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY preventive_items_insert ON preventive_items FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY preventive_items_update ON preventive_items FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY preventive_items_delete ON preventive_items FOR DELETE
  USING (has_profile_access(profile_id));

-- preventive_item_events — gated through has_profile_access().
ALTER TABLE preventive_item_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY preventive_item_events_select ON preventive_item_events FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY preventive_item_events_insert ON preventive_item_events FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY preventive_item_events_update ON preventive_item_events FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY preventive_item_events_delete ON preventive_item_events FOR DELETE
  USING (has_profile_access(profile_id));

-- preventive_intent_sheets — gated through has_profile_access().
ALTER TABLE preventive_intent_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY preventive_intent_sheets_select ON preventive_intent_sheets FOR SELECT
  USING (has_profile_access(profile_id));

CREATE POLICY preventive_intent_sheets_insert ON preventive_intent_sheets FOR INSERT
  WITH CHECK (has_profile_access(profile_id));

CREATE POLICY preventive_intent_sheets_update ON preventive_intent_sheets FOR UPDATE
  USING (has_profile_access(profile_id));

CREATE POLICY preventive_intent_sheets_delete ON preventive_intent_sheets FOR DELETE
  USING (has_profile_access(profile_id));


-- ══════════════════════════════════════════════════════════════════════
-- SEED DATA — Initial v1 Preventive Care Ruleset
-- Sources: USPSTF (U.S. Preventive Services Task Force) and CDC.
-- eligibility_criteria is a JSON shape the engine evaluates:
--   { min_age, max_age, sex, conditions? }
-- ══════════════════════════════════════════════════════════════════════

INSERT INTO preventive_rules (code, title, description, category, eligibility_criteria, cadence_months, guideline_source, guideline_version) VALUES
(
  'crc_screening',
  'Colorectal Cancer Screening',
  'Screening for colorectal cancer is recommended for adults starting at age 45. Options include colonoscopy every 10 years, or stool-based tests more frequently.',
  'cancer_screening',
  '{"min_age": 45, "max_age": 75, "sex": "any"}'::jsonb,
  120,
  'USPSTF',
  '2021'
),
(
  'breast_cancer_screening',
  'Breast Cancer Screening (Mammogram)',
  'Mammography screening is recommended for women starting at age 40, every 2 years.',
  'cancer_screening',
  '{"min_age": 40, "max_age": 74, "sex": "female"}'::jsonb,
  24,
  'USPSTF',
  '2024'
),
(
  'cervical_cancer_screening',
  'Cervical Cancer Screening (Pap/HPV)',
  'Cervical cancer screening is recommended for women ages 21-65. Pap smear every 3 years (21-29) or Pap + HPV co-testing every 5 years (30-65).',
  'cancer_screening',
  '{"min_age": 21, "max_age": 65, "sex": "female"}'::jsonb,
  36,
  'USPSTF',
  '2018'
),
(
  'flu_vaccine',
  'Annual Flu Vaccine',
  'Annual influenza vaccination is recommended for all adults.',
  'immunization',
  '{"min_age": 18, "max_age": null, "sex": "any"}'::jsonb,
  12,
  'CDC',
  '2025'
),
(
  'shingles_vaccine',
  'Shingles Vaccine (Shingrix)',
  'The shingles vaccine (Shingrix) is recommended for adults 50 and older, given as a two-dose series.',
  'immunization',
  '{"min_age": 50, "max_age": null, "sex": "any"}'::jsonb,
  NULL,
  'CDC',
  '2023'
),
(
  'pneumococcal_vaccine',
  'Pneumococcal Vaccine (PCV20 or PCV15+PPSV23)',
  'Pneumococcal vaccination is recommended for all adults 65 and older who have not previously received it.',
  'immunization',
  '{"min_age": 65, "max_age": null, "sex": "any"}'::jsonb,
  NULL,
  'CDC',
  '2023'
),
(
  'lipid_screening',
  'Cholesterol / Lipid Panel Screening',
  'Lipid screening is recommended for adults to assess cardiovascular risk. Frequency depends on risk factors, generally every 5 years for average risk.',
  'cardiovascular',
  '{"min_age": 20, "max_age": null, "sex": "any"}'::jsonb,
  60,
  'USPSTF',
  '2023'
),
(
  'bp_screening',
  'Blood Pressure Screening',
  'Regular blood pressure screening is recommended for all adults 18 and older.',
  'cardiovascular',
  '{"min_age": 18, "max_age": null, "sex": "any"}'::jsonb,
  12,
  'USPSTF',
  '2021'
),
(
  'diabetes_screening',
  'Diabetes Screening',
  'Screening for prediabetes and type 2 diabetes is recommended for adults aged 35-70 who are overweight or obese.',
  'metabolic',
  '{"min_age": 35, "max_age": 70, "sex": "any", "conditions": ["overweight", "obese"]}'::jsonb,
  36,
  'USPSTF',
  '2021'
),
(
  'bone_density_screening',
  'Bone Density Screening (DEXA Scan)',
  'Bone density screening is recommended for women 65 and older, and for younger postmenopausal women with risk factors.',
  'bone_health',
  '{"min_age": 65, "max_age": null, "sex": "female"}'::jsonb,
  24,
  'USPSTF',
  '2018'
);
