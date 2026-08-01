-- ProjectPilot v1.3 productivity models.
-- Existing tables and data are preserved; task progress is normalized into updates.

ALTER TABLE meetings
  ADD COLUMN meeting_url TEXT
  CHECK (meeting_url IS NULL OR meeting_url GLOB 'https://*');

ALTER TABLE recurrence_rules
  ADD COLUMN meeting_url TEXT
  CHECK (meeting_url IS NULL OR meeting_url GLOB 'https://*');

ALTER TABLE project_links
  ADD COLUMN task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL;
CREATE INDEX idx_project_links_task ON project_links (task_id);

CREATE TABLE named_list_orders (
  id               TEXT PRIMARY KEY,
  context          TEXT NOT NULL CHECK (context IN (
                     'projects',
                     'tasks',
                     'meetings',
                     'people',
                     'risks',
                     'project_links',
                     'milestones',
                     'project_tasks',
                     'task_subtasks',
                     'task_progress',
                     'task_checklist',
                     'task_resources'
                   )),
  context_id       TEXT NOT NULL DEFAULT '',
  name             TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  ordered_ids_json TEXT NOT NULL
                     CHECK (json_valid(ordered_ids_json) AND json_type(ordered_ids_json) = 'array'),
  is_default       INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (context, context_id, name COLLATE NOCASE)
);
CREATE INDEX idx_named_list_orders_context
  ON named_list_orders (context, context_id, updated_at);
CREATE UNIQUE INDEX idx_named_list_orders_default
  ON named_list_orders (context, context_id)
  WHERE is_default = 1;

CREATE TABLE task_progress_updates (
  id                   TEXT PRIMARY KEY,
  task_id              TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  title                TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  description          TEXT NOT NULL DEFAULT '',
  occurred_at          TEXT NOT NULL CHECK (length(trim(occurred_at)) > 0),
  contribution_percent INTEGER NOT NULL CHECK (contribution_percent BETWEEN 0 AND 100),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_task_progress_task_time
  ON task_progress_updates (task_id, occurred_at DESC, created_at DESC);

INSERT INTO task_progress_updates (
  id,
  task_id,
  title,
  description,
  occurred_at,
  contribution_percent,
  created_at,
  updated_at
)
SELECT
  'legacy-progress-' || id,
  id,
  '已有进度',
  '',
  updated_at,
  progress,
  created_at,
  updated_at
FROM tasks
WHERE progress > 0;

CREATE TRIGGER trg_task_progress_total_insert
BEFORE INSERT ON task_progress_updates
WHEN (
  SELECT COALESCE(SUM(contribution_percent), 0)
  FROM task_progress_updates
  WHERE task_id = NEW.task_id
) + NEW.contribution_percent > 100
BEGIN
  SELECT RAISE(ABORT, 'TASK_PROGRESS_EXCEEDS_100');
END;

CREATE TRIGGER trg_task_progress_total_update
BEFORE UPDATE OF task_id, contribution_percent ON task_progress_updates
WHEN (
  SELECT COALESCE(SUM(contribution_percent), 0)
  FROM task_progress_updates
  WHERE task_id = NEW.task_id AND id <> OLD.id
) + NEW.contribution_percent > 100
BEGIN
  SELECT RAISE(ABORT, 'TASK_PROGRESS_EXCEEDS_100');
END;

CREATE TRIGGER trg_task_progress_sync_insert
AFTER INSERT ON task_progress_updates
BEGIN
  UPDATE tasks
  SET progress = (
        SELECT COALESCE(SUM(contribution_percent), 0)
        FROM task_progress_updates
        WHERE task_id = NEW.task_id
      )
  WHERE id = NEW.task_id;
END;

CREATE TRIGGER trg_task_progress_sync_update
AFTER UPDATE OF task_id, contribution_percent ON task_progress_updates
BEGIN
  UPDATE tasks
  SET progress = (
        SELECT COALESCE(SUM(contribution_percent), 0)
        FROM task_progress_updates
        WHERE task_id = OLD.task_id
      )
  WHERE id = OLD.task_id;
  UPDATE tasks
  SET progress = (
        SELECT COALESCE(SUM(contribution_percent), 0)
        FROM task_progress_updates
        WHERE task_id = NEW.task_id
      )
  WHERE id = NEW.task_id;
END;

CREATE TRIGGER trg_task_progress_sync_delete
AFTER DELETE ON task_progress_updates
BEGIN
  UPDATE tasks
  SET progress = (
        SELECT COALESCE(SUM(contribution_percent), 0)
        FROM task_progress_updates
        WHERE task_id = OLD.task_id
      )
  WHERE id = OLD.task_id;
END;

CREATE TABLE task_checklist_items (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  content      TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 300),
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
  sort_order   INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  completed_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (
    (is_completed = 0 AND completed_at IS NULL)
    OR (is_completed = 1 AND completed_at IS NOT NULL)
  )
);
CREATE INDEX idx_task_checklist_task_order
  ON task_checklist_items (task_id, sort_order, created_at);
