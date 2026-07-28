-- Migration 0004: meetings, action items and milestones (phase 4)
--
-- STRICTLY ADDITIVE. One ADD COLUMN, one CREATE INDEX and five CREATE TRIGGER.
-- No DROP, no table rebuild, no data copied or deleted, and 0001/0002/0003 are
-- left untouched — applying this to a populated database cannot lose a row.
--
-- SQLite limits shape what can be expressed here: ALTER TABLE cannot append a
-- CHECK constraint, so every new invariant below is a trigger rather than a
-- table constraint (the same reason 0002 used triggers).

-- 1. Optional meeting start time (business requirement: date required, time optional).
--    Stored as 'HH:MM' local wall-clock text; it is a label on a calendar day, not
--    an instant, so it carries no timezone — consistent with the date-only policy.
ALTER TABLE meetings ADD COLUMN start_time TEXT DEFAULT NULL;

-- Format guard for the new column. GLOB alone would accept '29:00', so the hour
-- is range-checked too.
CREATE TRIGGER trg_meetings_start_time_insert
BEFORE INSERT ON meetings
FOR EACH ROW WHEN NEW.start_time IS NOT NULL
  AND (
    NEW.start_time NOT GLOB '[0-2][0-9]:[0-5][0-9]'
    OR CAST(substr(NEW.start_time, 1, 2) AS INTEGER) > 23
  )
BEGIN
  SELECT RAISE(ABORT, 'INVALID_MEETING_TIME');
END;

CREATE TRIGGER trg_meetings_start_time_update
BEFORE UPDATE ON meetings
FOR EACH ROW WHEN NEW.start_time IS NOT NULL
  AND (
    NEW.start_time NOT GLOB '[0-2][0-9]:[0-5][0-9]'
    OR CAST(substr(NEW.start_time, 1, 2) AS INTEGER) > 23
  )
BEGIN
  SELECT RAISE(ABORT, 'INVALID_MEETING_TIME');
END;

-- 2. Re-conversion guard.
--
-- 0001's UNIQUE(converted_task_id) only stops two action items from claiming the
-- SAME task. It does NOT stop one action item from being converted twice: two
-- concurrent conversions insert two DIFFERENT tasks, so the second UPDATE would
-- succeed and silently orphan the first task. This trigger closes that hole at
-- the row level.
--
-- `converted_at` is the authoritative "has been converted" marker because it
-- survives the foreign key's ON DELETE SET NULL. The null-safe `IS NOT`
-- comparison is deliberate and does three things at once:
--   * ON DELETE SET NULL (NEW.converted_task_id IS NULL) stays allowed;
--   * re-writing the same task id stays allowed (idempotent retry);
--   * pointing an already-converted item at a different task aborts — including
--     after its task was deleted, where converted_task_id is NULL again but
--     converted_at is not. That is what keeps "任务已删除" from re-opening
--     conversion.
CREATE TRIGGER trg_action_items_no_reconvert
BEFORE UPDATE ON action_items
FOR EACH ROW WHEN OLD.converted_at IS NOT NULL
  AND NEW.converted_task_id IS NOT NULL
  AND NEW.converted_task_id IS NOT OLD.converted_task_id
BEGIN
  SELECT RAISE(ABORT, 'ALREADY_CONVERTED');
END;

-- 3. The audit column and the link must be written together, on both paths.
--    Without this a row could hold a task id with no converted_at, and losing
--    that task would make it indistinguishable from "never converted".
CREATE TRIGGER trg_action_items_conversion_audit_insert
BEFORE INSERT ON action_items
FOR EACH ROW WHEN NEW.converted_task_id IS NOT NULL AND NEW.converted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'CONVERSION_AUDIT_REQUIRED');
END;

CREATE TRIGGER trg_action_items_conversion_audit_update
BEFORE UPDATE ON action_items
FOR EACH ROW WHEN NEW.converted_task_id IS NOT NULL AND NEW.converted_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'CONVERSION_AUDIT_REQUIRED');
END;

-- 4. The calendar reads one month across all projects. `tasks` and `meetings`
--    already have a date-leftmost index (idx_tasks_due_status, idx_meetings_date);
--    milestones did not — both existing indexes lead with project_id or status.
CREATE INDEX idx_milestones_date ON milestones (date);
