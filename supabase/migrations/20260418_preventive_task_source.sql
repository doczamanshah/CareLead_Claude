-- ══════════════════════════════════════════════════════════════════════
-- Migration: Allow 'preventive' as a task source_type
-- Needed for preventive intent sheet commit, which creates tasks linked
-- back to preventive_items via source_type='preventive' / source_ref=item_id.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_source_type_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_source_type_check
  CHECK (source_type IN ('manual', 'intent_sheet', 'appointment', 'medication', 'billing', 'preventive'));
