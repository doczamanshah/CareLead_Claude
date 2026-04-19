-- Phase 3 — Passive Enrichment Step 3
--
-- Track whether the user has completed the post-visit capture flow for an
-- appointment. The flag flips true when EITHER:
--   • the structured quick-capture flow finishes, OR
--   • the existing closeout wizard's finalize step runs.
--
-- Today's Briefing surfaces past appointments with this flag still false
-- (within a 48h window) as high-priority "How did it go?" prompts so the
-- detail-capture window doesn't slip away.

ALTER TABLE apt_appointments
  ADD COLUMN IF NOT EXISTS post_visit_captured BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any appointment that already has a finalized closeout counts as
-- captured so we don't suddenly start nagging users about historical visits.
UPDATE apt_appointments a
   SET post_visit_captured = true
  WHERE EXISTS (
    SELECT 1
      FROM apt_closeouts c
     WHERE c.appointment_id = a.id
       AND c.status = 'finalized'
  );

-- Index supports the briefing query that filters past + uncaptured + active.
CREATE INDEX IF NOT EXISTS idx_apt_appointments_captured_lookup
  ON apt_appointments (profile_id, post_visit_captured, start_time)
  WHERE deleted_at IS NULL;
