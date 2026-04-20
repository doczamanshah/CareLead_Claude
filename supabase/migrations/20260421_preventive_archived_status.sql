-- ══════════════════════════════════════════════════════════════════════
-- Migration: Preventive Items — 'archived' status (Phase 3 Item 5c)
-- Adds 'archived' as a valid status for preventive_items.
-- Used when a rule no longer applies to a profile (aged out, sex
-- mismatch, condition no longer present). Archiving preserves history
-- and audit trail while removing the item from the user-facing list.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE preventive_items
  DROP CONSTRAINT preventive_items_status_check;

ALTER TABLE preventive_items
  ADD CONSTRAINT preventive_items_status_check
  CHECK (status IN (
    'due',
    'due_soon',
    'scheduled',
    'completed',
    'up_to_date',
    'needs_review',
    'deferred',
    'declined',
    'archived'
  ));
