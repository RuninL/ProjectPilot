-- ProjectPilot migration 0001: initial schema (8 tables + indexes + triggers).
-- Business dates are TEXT 'YYYY-MM-DD' (Asia/Hong_Kong calendar day, date-only).
-- Audit timestamps (created_at/updated_at) are UTC ISO-8601 TEXT.
-- Primary keys are UUID v4 TEXT generated on the frontend.
--
-- NOTE: date shape is validated with GLOB '????-??-??'. The spec wrote
-- GLOB '____-__-__', but in SQLite GLOB the wildcards are '?' and '*'; '_' is
-- a literal (it is only a wildcard under LIKE). The underscore form never
-- matches a real date, so '?' is used here to preserve the intended check.

-- 2.1 projects -------------------------------------------------------------
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'on_hold', 'completed', 'archived')),
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
CREATE INDEX idx_projects_status ON projects (status);
CREATE INDEX idx_projects_archived ON projects (archived_at);

-- 2.2 tasks ----------------------------------------------------------------
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  parent_task_id  TEXT REFERENCES tasks (id) ON DELETE CASCADE,
  title           TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'todo'
                    CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  start_date      TEXT CHECK (start_date IS NULL OR start_date GLOB '????-??-??'),
  due_date        TEXT CHECK (due_date IS NULL OR due_date GLOB '????-??-??'),
  progress        INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  estimated_hours REAL CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  actual_hours    REAL CHECK (actual_hours IS NULL OR actual_hours >= 0),
  is_sample       INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)
);
CREATE INDEX idx_tasks_project_status ON tasks (project_id, status);
CREATE INDEX idx_tasks_project_due ON tasks (project_id, due_date);
CREATE INDEX idx_tasks_parent ON tasks (parent_task_id);
CREATE INDEX idx_tasks_dashboard ON tasks (status, due_date, progress);

-- Two-level parent/child limit: gate-keep on INSERT and on parent reassignment.
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

-- Forbid giving a parent to a task that already has children (would create a 3rd level).
CREATE TRIGGER trg_tasks_no_parent_if_has_children
BEFORE UPDATE OF parent_task_id ON tasks
WHEN NEW.parent_task_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM tasks WHERE parent_task_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'MAX_TWO_LEVELS');
END;

-- 2.3 task_dependencies (finish-to-start) ----------------------------------
CREATE TABLE task_dependencies (
  id             TEXT PRIMARY KEY,
  predecessor_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  successor_id   TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  dep_type       TEXT NOT NULL DEFAULT 'FS' CHECK (dep_type IN ('FS')),
  lag_days       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  CHECK (predecessor_id <> successor_id),
  UNIQUE (predecessor_id, successor_id)
);
CREATE INDEX idx_deps_successor ON task_dependencies (successor_id);

-- 2.4 milestones -----------------------------------------------------------
CREATE TABLE milestones (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  linked_task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL,
  name           TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description    TEXT NOT NULL DEFAULT '',
  date           TEXT NOT NULL CHECK (date GLOB '????-??-??'),
  status         TEXT NOT NULL DEFAULT 'upcoming'
                   CHECK (status IN ('upcoming', 'achieved', 'missed', 'cancelled')),
  achieved_at    TEXT,
  is_sample      INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_milestones_project_date ON milestones (project_id, date);
CREATE INDEX idx_milestones_status_date ON milestones (status, date);
CREATE INDEX idx_milestones_task ON milestones (linked_task_id);

-- 2.5 meetings -------------------------------------------------------------
CREATE TABLE meetings (
  id         TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects (id) ON DELETE CASCADE,
  topic      TEXT NOT NULL CHECK (length(trim(topic)) BETWEEN 1 AND 160),
  date       TEXT NOT NULL CHECK (date GLOB '????-??-??'),
  attendees  TEXT NOT NULL DEFAULT '[]',
  agenda     TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  decisions  TEXT NOT NULL DEFAULT '',
  risks      TEXT NOT NULL DEFAULT '',
  is_sample  INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_meetings_project_date ON meetings (project_id, date);
CREATE INDEX idx_meetings_date ON meetings (date);

-- 2.6 action_items ---------------------------------------------------------
CREATE TABLE action_items (
  id                TEXT PRIMARY KEY,
  meeting_id        TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  content           TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 300),
  owner             TEXT NOT NULL DEFAULT '',
  due_date          TEXT CHECK (due_date IS NULL OR due_date GLOB '????-??-??'),
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  converted_task_id TEXT UNIQUE REFERENCES tasks (id) ON DELETE SET NULL,
  converted_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_action_items_meeting ON action_items (meeting_id);

-- 2.7 project_links --------------------------------------------------------
CREATE TABLE project_links (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  label      TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 160),
  link_type  TEXT NOT NULL CHECK (link_type IN ('url', 'file_path')),
  target     TEXT NOT NULL CHECK (length(trim(target)) > 0),
  is_sample  INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_links_project ON project_links (project_id);

-- 2.8 app_settings (key/value) ---------------------------------------------
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
