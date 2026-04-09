-- 00004_task_enhancements.sql
-- Enhances the tasks table with context, chains, dependencies, assignment, recurrence, and triggers.

-- ── 1. Add new columns to tasks ──────────────────────────────────────────────

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS context_json        JSONB           DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS parent_task_id      UUID            DEFAULT NULL REFERENCES tasks(id),
  ADD COLUMN IF NOT EXISTS chain_order         INTEGER         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS depends_on_task_id  UUID            DEFAULT NULL REFERENCES tasks(id),
  ADD COLUMN IF NOT EXISTS dependency_status   TEXT            DEFAULT NULL
    CHECK (dependency_status IN ('blocked', 'ready')),
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID            DEFAULT NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS recurrence_rule     TEXT            DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS next_recurrence_at  TIMESTAMPTZ     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trigger_type        TEXT            DEFAULT NULL
    CHECK (trigger_type IN ('manual', 'extraction', 'proactive', 'time_based', 'chain')),
  ADD COLUMN IF NOT EXISTS trigger_source      TEXT            DEFAULT NULL;

-- ── 2. Indexes for common access patterns ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id
  ON tasks(parent_task_id)
  WHERE parent_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_depends_on_task_id
  ON tasks(depends_on_task_id)
  WHERE depends_on_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_user_id
  ON tasks(assigned_to_user_id)
  WHERE assigned_to_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_dependency_status
  ON tasks(dependency_status)
  WHERE dependency_status = 'blocked';

CREATE INDEX IF NOT EXISTS idx_tasks_recurrence
  ON tasks(next_recurrence_at)
  WHERE recurrence_rule IS NOT NULL AND next_recurrence_at IS NOT NULL;

-- ── 3. Backfill existing tasks with trigger_type ─────────────────────────────

UPDATE tasks
  SET trigger_type = CASE
    WHEN source_type = 'manual' THEN 'manual'
    WHEN source_type = 'intent_sheet' THEN 'extraction'
    ELSE 'manual'
  END
  WHERE trigger_type IS NULL;
