-- ProjectPilot migration 0002: task lifecycle columns, indexes and hierarchy guards.
-- Strictly additive: ADD COLUMN / CREATE INDEX / CREATE TRIGGER only.
-- The tasks table is never rebuilt and no existing row is copied or deleted.
--
-- SQLite's ALTER TABLE cannot attach CHECK constraints, and a column carrying a
-- REFERENCES clause must be nullable with no non-null default. Every new
-- invariant is therefore expressed as a trigger rather than a table constraint.

-- 3.1 new tasks columns ----------------------------------------------------
-- completed_at / archived_at are UTC ISO-8601 audit timestamps, not business dates.
ALTER TABLE tasks ADD COLUMN completed_at TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN archived_at TEXT DEFAULT NULL;
-- Set when a task originates from a meeting action item (feature lands in a later phase).
ALTER TABLE tasks ADD COLUMN source_meeting_id TEXT DEFAULT NULL
  REFERENCES meetings (id) ON DELETE SET NULL;

-- 3.2 indexes --------------------------------------------------------------
-- Archived tasks are excluded from every list and from the completion rate.
CREATE INDEX idx_tasks_archived ON tasks (archived_at);
-- Cross-project "my tasks" view sorts by due date and filters by status.
CREATE INDEX idx_tasks_due_status ON tasks (due_date, status);

-- 3.3 hierarchy guards -----------------------------------------------------
-- 0001 limits the tree to two levels but leaves two holes that these triggers close:
--   * self parent — the 0001 BEFORE INSERT subquery looks the parent up in `tasks`,
--     where the row being inserted does not exist yet, so it yields NULL and passes.
--   * cross-project parent — 0001 has no constraint at all.
-- Both are enforced on INSERT and on UPDATE so raw SQL cannot bypass them.

CREATE TRIGGER trg_tasks_no_self_parent_insert
BEFORE INSERT ON tasks
WHEN NEW.parent_task_id IS NOT NULL AND NEW.parent_task_id = NEW.id
BEGIN
  SELECT RAISE(ABORT, 'SELF_PARENT');
END;

CREATE TRIGGER trg_tasks_no_self_parent_update
BEFORE UPDATE ON tasks
WHEN NEW.parent_task_id IS NOT NULL AND NEW.parent_task_id = NEW.id
BEGIN
  SELECT RAISE(ABORT, 'SELF_PARENT');
END;

-- EXISTS keeps a missing parent out of scope so it still surfaces as a foreign
-- key error instead of being mislabelled as a cross-project parent.
CREATE TRIGGER trg_tasks_same_project_parent_insert
BEFORE INSERT ON tasks
WHEN NEW.parent_task_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM tasks
    WHERE id = NEW.parent_task_id AND project_id <> NEW.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'CROSS_PROJECT_PARENT');
END;

-- Fires on every UPDATE, not only `OF parent_task_id`, because moving the child
-- to another project breaks the same invariant without touching the parent column.
CREATE TRIGGER trg_tasks_same_project_parent_update
BEFORE UPDATE ON tasks
WHEN NEW.parent_task_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM tasks
    WHERE id = NEW.parent_task_id AND project_id <> NEW.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'CROSS_PROJECT_PARENT');
END;
