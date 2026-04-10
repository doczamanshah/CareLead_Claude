-- ============================================================================
-- 00007_visit_prep.sql
-- Adds structured Visit Prep data to appointments. Replaces the older
-- per-item plan checklist with a cohesive prep object covering purpose,
-- agenda, logistics, and packet content.
-- ============================================================================

ALTER TABLE apt_appointments
  ADD COLUMN prep_json JSONB;

COMMENT ON COLUMN apt_appointments.prep_json IS
  'Structured Visit Prep: purpose_summary, questions[], refills_needed[], concerns[], logistics{}, packet_generated, packet_content.';
