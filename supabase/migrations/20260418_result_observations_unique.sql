-- ══════════════════════════════════════════════════════════════════════
-- Migration: UNIQUE constraint on result_lab_observations
-- Enables UPSERT on (result_id, analyte_name) during AI extraction so
-- re-running extraction updates rows instead of duplicating analytes.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE result_lab_observations
  ADD CONSTRAINT result_lab_observations_result_analyte_unique
  UNIQUE (result_id, analyte_name);
