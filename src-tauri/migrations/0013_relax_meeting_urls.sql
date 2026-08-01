-- Remove the HTTPS-only meeting_url checks introduced by 0012.
-- Child rows are copied explicitly because foreign keys remain enabled while
-- tauri-plugin-sql runs this migration atomically.

CREATE TABLE migration_0013_counts (
  entity TEXT PRIMARY KEY,
  row_count INTEGER NOT NULL
);
INSERT INTO migration_0013_counts (entity, row_count)
VALUES
  ('meetings', (SELECT COUNT(*) FROM meetings)),
  ('action_items', (SELECT COUNT(*) FROM action_items)),
  ('recurrence_rules', (SELECT COUNT(*) FROM recurrence_rules)),
  ('recurrence_exceptions', (SELECT COUNT(*) FROM recurrence_exceptions));

CREATE TABLE migration_0013_action_items AS
SELECT
  id,
  meeting_id,
  content,
  owner,
  due_date,
  status,
  converted_task_id,
  converted_at,
  created_at,
  updated_at
FROM action_items;

CREATE TABLE migration_0013_task_meetings AS
SELECT id, source_meeting_id
FROM tasks
WHERE source_meeting_id IS NOT NULL;

CREATE TABLE meetings_next (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT REFERENCES projects (id) ON DELETE CASCADE,
  topic                  TEXT NOT NULL CHECK (length(trim(topic)) BETWEEN 1 AND 160),
  date                   TEXT NOT NULL CHECK (date GLOB '????-??-??'),
  attendees              TEXT NOT NULL DEFAULT '[]',
  agenda                 TEXT NOT NULL DEFAULT '',
  notes                  TEXT NOT NULL DEFAULT '',
  decisions              TEXT NOT NULL DEFAULT '',
  risks                  TEXT NOT NULL DEFAULT '',
  is_sample              INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  start_time             TEXT DEFAULT NULL,
  source_rule_id         TEXT NULL,
  source_occurrence_date TEXT NULL,
  meeting_url            TEXT
);

INSERT INTO meetings_next (
  id,
  project_id,
  topic,
  date,
  attendees,
  agenda,
  notes,
  decisions,
  risks,
  is_sample,
  created_at,
  updated_at,
  start_time,
  source_rule_id,
  source_occurrence_date,
  meeting_url
)
SELECT
  id,
  project_id,
  topic,
  date,
  attendees,
  agenda,
  notes,
  decisions,
  risks,
  is_sample,
  created_at,
  updated_at,
  start_time,
  source_rule_id,
  source_occurrence_date,
  meeting_url
FROM meetings;

DROP TABLE meetings;
ALTER TABLE meetings_next RENAME TO meetings;

CREATE INDEX idx_meetings_project_date ON meetings (project_id, date);
CREATE INDEX idx_meetings_date ON meetings (date);
CREATE INDEX idx_meetings_source_rule_id ON meetings (source_rule_id);

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

UPDATE tasks
SET source_meeting_id = (
  SELECT backup.source_meeting_id
  FROM migration_0013_task_meetings AS backup
  WHERE backup.id = tasks.id
)
WHERE id IN (SELECT id FROM migration_0013_task_meetings);

INSERT INTO action_items (
  id,
  meeting_id,
  content,
  owner,
  due_date,
  status,
  converted_task_id,
  converted_at,
  created_at,
  updated_at
)
SELECT
  id,
  meeting_id,
  content,
  owner,
  due_date,
  status,
  converted_task_id,
  converted_at,
  created_at,
  updated_at
FROM migration_0013_action_items;

DROP TABLE migration_0013_action_items;
DROP TABLE migration_0013_task_meetings;

CREATE TABLE migration_0013_recurrence_exceptions AS
SELECT
  id,
  rule_id,
  occurrence_date,
  action,
  replacement_date,
  materialized_id,
  created_at,
  updated_at
FROM recurrence_exceptions;

CREATE TABLE recurrence_rules_next (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL CHECK(kind IN ('task', 'meeting')),
  title                TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
  byweekday            INTEGER NOT NULL CHECK(byweekday BETWEEN 0 AND 6),
  interval             INTEGER NOT NULL DEFAULT 1 CHECK(interval >= 1),
  start_date           TEXT NOT NULL CHECK(start_date GLOB '????-??-??'),
  end_date             TEXT NULL CHECK(end_date IS NULL OR end_date GLOB '????-??-??'),
  time_of_day          TEXT NULL,
  duration_minutes     INTEGER NULL CHECK(duration_minutes IS NULL OR duration_minutes > 0),
  default_priority     TEXT NULL CHECK(
                         default_priority IS NULL
                         OR default_priority IN ('low', 'medium', 'high', 'urgent')
                       ),
  note                 TEXT NOT NULL DEFAULT '',
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  is_sample            INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0, 1)),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  meeting_url          TEXT,
  CHECK(end_date IS NULL OR start_date <= end_date)
);

INSERT INTO recurrence_rules_next (
  id,
  project_id,
  kind,
  title,
  byweekday,
  interval,
  start_date,
  end_date,
  time_of_day,
  duration_minutes,
  default_priority,
  note,
  is_active,
  is_sample,
  created_at,
  updated_at,
  meeting_url
)
SELECT
  id,
  project_id,
  kind,
  title,
  byweekday,
  interval,
  start_date,
  end_date,
  time_of_day,
  duration_minutes,
  default_priority,
  note,
  is_active,
  is_sample,
  created_at,
  updated_at,
  meeting_url
FROM recurrence_rules;

DROP TABLE recurrence_rules;
ALTER TABLE recurrence_rules_next RENAME TO recurrence_rules;

CREATE INDEX idx_recurrence_rules_project ON recurrence_rules(project_id);
CREATE INDEX idx_recurrence_rules_active ON recurrence_rules(is_active);

INSERT INTO recurrence_exceptions (
  id,
  rule_id,
  occurrence_date,
  action,
  replacement_date,
  materialized_id,
  created_at,
  updated_at
)
SELECT
  id,
  rule_id,
  occurrence_date,
  action,
  replacement_date,
  materialized_id,
  created_at,
  updated_at
FROM migration_0013_recurrence_exceptions;

DROP TABLE migration_0013_recurrence_exceptions;

CREATE TABLE migration_0013_guard (
  result INTEGER NOT NULL CHECK (result = 0)
);
INSERT INTO migration_0013_guard (result)
SELECT
  (SELECT row_count FROM migration_0013_counts WHERE entity = 'meetings')
  - (SELECT COUNT(*) FROM meetings);
INSERT INTO migration_0013_guard (result)
SELECT
  (SELECT row_count FROM migration_0013_counts WHERE entity = 'action_items')
  - (SELECT COUNT(*) FROM action_items);
INSERT INTO migration_0013_guard (result)
SELECT
  (SELECT row_count FROM migration_0013_counts WHERE entity = 'recurrence_rules')
  - (SELECT COUNT(*) FROM recurrence_rules);
INSERT INTO migration_0013_guard (result)
SELECT
  (SELECT row_count FROM migration_0013_counts WHERE entity = 'recurrence_exceptions')
  - (SELECT COUNT(*) FROM recurrence_exceptions);
INSERT INTO migration_0013_guard (result)
SELECT COUNT(*) FROM pragma_foreign_key_check;
INSERT INTO migration_0013_guard (result)
SELECT COUNT(*) FROM pragma_integrity_check WHERE integrity_check <> 'ok';

DROP TABLE migration_0013_guard;
DROP TABLE migration_0013_counts;
