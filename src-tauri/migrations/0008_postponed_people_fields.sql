-- ProjectPilot migration 0008: postponed statuses and optional people fields.
--
-- tauri-plugin-sql/sqlx owns the transaction around this script and enables
-- foreign keys on its migration connection. Rebuilding a referenced parent
-- table therefore fires its configured cascades. Preserve every affected child
-- row in temporary tables, rebuild the two status tables, then restore the rows
-- in foreign-key order. This keeps the migration atomic without nesting a
-- transaction or trying to change PRAGMA foreign_keys inside one.

ALTER TABLE people ADD COLUMN email TEXT DEFAULT NULL;
ALTER TABLE people ADD COLUMN role TEXT DEFAULT NULL;
ALTER TABLE people ADD COLUMN note TEXT DEFAULT NULL;

CREATE TEMP TABLE migration_0008_tasks AS SELECT * FROM tasks;
CREATE TEMP TABLE migration_0008_task_dependencies AS SELECT * FROM task_dependencies;
CREATE TEMP TABLE migration_0008_milestones AS SELECT * FROM milestones;
CREATE TEMP TABLE migration_0008_meetings AS SELECT * FROM meetings;
CREATE TEMP TABLE migration_0008_action_items AS SELECT * FROM action_items;
CREATE TEMP TABLE migration_0008_project_links AS SELECT * FROM project_links;
CREATE TEMP TABLE migration_0008_risks AS SELECT * FROM risks;
CREATE TEMP TABLE migration_0008_project_participants AS SELECT * FROM project_participants;
CREATE TEMP TABLE migration_0008_task_participants AS SELECT * FROM task_participants;

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

-- Deleting the old parent rows cascades through the existing foreign keys.
-- All rows that can be affected were copied above and are restored below.
DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;
CREATE INDEX idx_projects_status ON projects (status);
CREATE INDEX idx_projects_archived ON projects (archived_at);

-- Project deletion emptied tasks and all project-owned tables. Recreate tasks
-- so its CHECK constraint accepts postponed, then restore parents before
-- children to satisfy the self-reference.
DROP TRIGGER trg_deps_same_project_insert;
DROP TRIGGER trg_deps_same_project_update;
DROP TABLE tasks;

CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  parent_task_id    TEXT REFERENCES tasks (id) ON DELETE CASCADE,
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

INSERT INTO meetings SELECT * FROM migration_0008_meetings;
INSERT INTO tasks
SELECT * FROM migration_0008_tasks WHERE parent_task_id IS NULL;
INSERT INTO tasks
SELECT * FROM migration_0008_tasks WHERE parent_task_id IS NOT NULL;

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

-- Restore the remaining cascaded or SET NULL rows only after both parent tables
-- are back. Task participation remains independent from project participation.
INSERT INTO milestones SELECT * FROM migration_0008_milestones;
INSERT INTO action_items SELECT * FROM migration_0008_action_items;
INSERT INTO project_links SELECT * FROM migration_0008_project_links;
INSERT INTO risks SELECT * FROM migration_0008_risks;
INSERT INTO project_participants SELECT * FROM migration_0008_project_participants;
INSERT INTO task_participants SELECT * FROM migration_0008_task_participants;
INSERT INTO task_dependencies SELECT * FROM migration_0008_task_dependencies;

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

DROP TABLE migration_0008_tasks;
DROP TABLE migration_0008_task_dependencies;
DROP TABLE migration_0008_milestones;
DROP TABLE migration_0008_meetings;
DROP TABLE migration_0008_action_items;
DROP TABLE migration_0008_project_links;
DROP TABLE migration_0008_risks;
DROP TABLE migration_0008_project_participants;
DROP TABLE migration_0008_task_participants;
