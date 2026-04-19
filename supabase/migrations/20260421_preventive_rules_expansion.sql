-- ══════════════════════════════════════════════════════════════════════
-- Migration: Preventive Care Rules Expansion (Phase 3 Item 5, Part 1)
-- Adds fields that let a single rule express:
--   • multiple screening methods with per-method cadences (e.g. colonoscopy
--     vs cologuard vs FIT)
--   • HEDIS / Star measure alignment for reporting
--   • condition-triggered eligibility (e.g. diabetes bundle)
--   • seasonal windows (e.g. flu shot Sep–Nov)
--   • measure type tagging (screening / immunization / monitoring /
--     counseling / visit)
-- Also adds gap-tracking timestamps on preventive_items so we can measure
-- time-to-closure for care gaps.
-- ══════════════════════════════════════════════════════════════════════

-- ── preventive_rules: new columns ───────────────────────────────────────
--
-- screening_methods: [{ method_id, name, cadence_months, description }, ...]
--   When non-null, overrides cadence_months. The user selects which method
--   they completed; that method's cadence drives next_due.
-- hedis_measure_code: HEDIS/Star measure abbreviation (e.g. 'COL', 'BCS').
-- condition_triggers: conditions that make this rule applicable in addition
--   to (or instead of) age/sex criteria.
-- is_condition_dependent: when true, the rule only applies if a matching
--   condition exists (age/sex alone is not enough).
-- seasonal_window: { start_month, end_month, label } for seasonally-timed
--   screenings like the flu shot.
-- measure_type: 'screening' | 'immunization' | 'monitoring' | 'counseling'
--   | 'visit'. Defaults to 'screening' to keep existing rows valid.

ALTER TABLE preventive_rules
  ADD COLUMN screening_methods       JSONB,
  ADD COLUMN hedis_measure_code      TEXT,
  ADD COLUMN condition_triggers      JSONB,
  ADD COLUMN is_condition_dependent  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN seasonal_window         JSONB,
  ADD COLUMN measure_type            TEXT NOT NULL DEFAULT 'screening'
    CHECK (measure_type IN ('screening', 'immunization', 'monitoring', 'counseling', 'visit'));

CREATE INDEX idx_preventive_rules_hedis_measure_code
  ON preventive_rules(hedis_measure_code)
  WHERE hedis_measure_code IS NOT NULL;

CREATE INDEX idx_preventive_rules_measure_type ON preventive_rules(measure_type);


-- ── preventive_items: new columns ───────────────────────────────────────
--
-- selected_method: which screening method the user completed (e.g.
--   'colonoscopy', 'cologuard'). Null until chosen.
-- hedis_measure_code: denormalized from the rule for quick aggregation.
-- gap_identified_at / gap_closed_at: gap-closure telemetry. Identified on
--   first creation in a "due" or "needs_review" state; closed when the
--   item transitions into 'completed' or 'up_to_date'.

ALTER TABLE preventive_items
  ADD COLUMN selected_method       TEXT,
  ADD COLUMN hedis_measure_code    TEXT,
  ADD COLUMN gap_identified_at     TIMESTAMPTZ,
  ADD COLUMN gap_closed_at         TIMESTAMPTZ;

CREATE INDEX idx_preventive_items_hedis_measure_code
  ON preventive_items(hedis_measure_code)
  WHERE hedis_measure_code IS NOT NULL;

CREATE INDEX idx_preventive_items_gap_identified_at
  ON preventive_items(gap_identified_at)
  WHERE gap_identified_at IS NOT NULL AND gap_closed_at IS NULL;
