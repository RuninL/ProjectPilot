-- ProjectPilot migration 0008: postponed statuses and optional people fields.
-- SQLite cannot alter CHECK constraints in place, so projects and tasks are
-- rebuilt in one transaction. All existing columns, indexes, and triggers are
-- preserved; no status values are rewritten.

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

ALTER TABLE people ADD COLUMN email TEXT DEFAULT NULL;
ALTER TABLE people ADD COLUMN role TEXT DEFAULT NULL;
ALTER TABLE people ADD COLUMN note TEXT DEFAULT NULL;

CREATE TABLE projects_new (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'on_hold', 'postponed', 'completed', 'archived')),
  color           TEXT NOT NULL DEFAULT '#2563EB'
                    CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  start_date      TEXT CHECK (start_date IS NULL OR start_date GLOB '????-??-??'),
  target_end_date TEXT CHECK (target_end_date IS NULL OR target_end_date GLOB '????-??-??'),
  archived_at     TEXT,
  is_sample       INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (start_date IS NULL OR target_end_date IS NULL OR start_date <= target_end_date)
);
INSERT INTO projects_new
  (id, name, description, status, color, start_date, target_end_date,
   archived_at, is_sample, created_at, updated_at)
SELECT id, name, description, status, color, start_date, target_end_date,
       archived_at, is_sample, created_at, updated_at
  FROM projects;
DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;
CREATE INDEX idx_projects_status ON projects (status);
CREATE INDEX idx_projects_archived ON projects (archived_at);

-- These triggers belong to task_dependencies but reference tasks. SQLite
-- validates their bodies while the replacement table is renamed.
DROP TRIGGER trg_deps_same_project_insert;
DROP TRIGGER trg_deps_same_project_update;

CREATE TABLE tasks_new (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  parent_task_id    TEXT REFERENCES tasks_new (id) ON DELETE CASCADE,
  title             TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  description       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'todo'
                      CHECK (status IN ('todo', 'in_progress', 'blocked', 'postponed', 'done', 'cancelled')),
  priority          TEXT NOT NULL DEFAULT 'medium'
                      CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  start_date        TEXT CHECK (start_date IS NULL OR start_date GLOB '????-??-??'),
  due_date          TEXT CHECK (due_date IS NULL OR due_date GLOB '????-??-??'),
  progress          INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  estimated_hours   REAL CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  actual_hours      REAL CHECK (actual_hours IS NULL OR actual_hours >= 0),
  is_sample         INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  completed_at      TEXT DEFAULT NULL,
  archived_at       TEXT DEFAULT NULL,
  source_meeting_id TEXT DEFAULT NULL REFERENCES meetings (id) ON DELETE SET NULL,
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)
);
INSERT INTO tasks_new
  (id, project_id, parent_task_id, title, description, status, priority,
   start_date, due_date, progress, estimated_hours, actual_hours, is_sample,
   created_at, updated_at, completed_at, archived_at, source_meeting_id)
SELECT id, project_id, parent_task_id, title, description, status, priority,
       start_date, due_date, progress, estimated_hours, actual_hours, is_sample,
       created_at, updated_at, completed_at, archived_at, source_meeting_id
  FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX idx_tasks_project_status ON tasks (project_id, status);
CREATE INDEX idx_tasks_project_due ON tasks (project_id, due_date);
CREATE INDEX idx_tasks_parent ON tasks (parent_task_id);
CREATE INDEX idx_tasks_dashboard ON tasks (status, due_date, progress);
CREATE INDEX idx_tasks_archived ON tasks (archived_at);
CREATE INDEX idx_tasks_due_status ON tasks (due_date, status);

CREATE TRIGGER trg_tasks_max_two_levels_insert
BEFORE INSERT ON tasks
WHEN NEW.parent_task_id IS NOT NULL
  AND (SELECT parent_task_id FROM tasks WHERE id = NEW.parent_task_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'MAX_TWO_LEVELS');
END;

CREATE TRIGGER trg_tasks_max_two_levels_update
BEFORE UPDATE OF parent_task_id ON tasks
WHEN NEW.parent_task_id IS NOT NULL
  AND (SELECT parent_task_id FROM tasks WHERE id = NEW.parent_task_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'MAX_TWO_LEVELS');
END;

CREATE TRIGGER trg_tasks_no_parent_if_has_children
BEFORE UPDATE OF parent_task_id ON tasks
WHEN NEW.parent_task_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM tasks WHERE parent_task_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'MAX_TWO_LEVELS');
END;

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

CREATE TRIGGER trg_deps_same_project_insert
BEFORE INSERT ON task_dependencies
WHEN EXISTS (
  SELECT 1 FROM tasks p JOIN tasks s ON s.id = NEW.successor_id
  WHERE p.id = NEW.predecessor_id AND p.project_id <> s.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'CROSS_PROJECT_DEPENDENCY');
END;

CREATE TRIGGER trg_deps_same_project_update
BEFORE UPDATE ON task_dependencies
WHEN EXISTS (
  SELECT 1 FROM tasks p JOIN tasks s ON s.id = NEW.successor_id
  WHERE p.id = NEW.predecessor_id AND p.project_id <> s.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'CROSS_PROJECT_DEPENDENCY');
END;

COMMIT;
PRAGMA foreign_keys = ON;
