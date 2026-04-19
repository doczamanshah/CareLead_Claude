-- ══════════════════════════════════════════════════════════════════════
-- Migration: Task lifecycle enhancements
-- Adds auto-expiry, smart snooze, and personalized priority columns.
-- Extends the status enum with 'expired' so auto-archived tasks stay
-- distinct from user-dismissed ones.
-- ══════════════════════════════════════════════════════════════════════

-- 1. New columns
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS snoozed_count     INTEGER        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snoozed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_reason    TEXT,
  ADD COLUMN IF NOT EXISTS personal_priority NUMERIC(5,2);

-- 2. Extend the status CHECK constraint to include 'expired'.
-- Drop-and-recreate because Postgres doesn't support altering CHECK
-- constraints in place.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'dismissed', 'expired'));

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_expired_at
  ON tasks(expired_at)
  WHERE expired_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_snoozed_at
  ON tasks(snoozed_at)
  WHERE snoozed_at IS NOT NULL;
