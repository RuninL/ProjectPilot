-- Allow recurrence rules for standalone meetings without changing prior migrations.
-- Rebuild the child first so its rows survive the parent table replacement.
CREATE TABLE recurrence_exceptions_next (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES recurrence_rules_next(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL CHECK(occurrence_date GLOB '????-??-??'),
  action TEXT NOT NULL CHECK(action IN ('skip', 'materialized')),
  materialized_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(rule_id, occurrence_date)
);

CREATE TABLE recurrence_rules_next (
  id TEXT PRIMARY KEY,
  project_id TEXT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('task', 'meeting')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
  byweekday INTEGER NOT NULL CHECK(byweekday BETWEEN 0 AND 6),
  interval INTEGER NOT NULL DEFAULT 1 CHECK(interval >= 1),
  start_date TEXT NOT NULL CHECK(start_date GLOB '????-??-??'),
  end_date TEXT NULL CHECK(end_date IS NULL OR end_date GLOB '????-??-??'),
  time_of_day TEXT NULL,
  duration_minutes INTEGER NULL CHECK(duration_minutes IS NULL OR duration_minutes > 0),
  default_priority TEXT NULL CHECK(default_priority IS NULL OR default_priority IN ('low', 'medium', 'high', 'urgent')),
  note TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(end_date IS NULL OR start_date <= end_date)
);

INSERT INTO recurrence_exceptions_next
SELECT * FROM recurrence_exceptions;
INSERT INTO recurrence_rules_next
SELECT * FROM recurrence_rules;

DROP TABLE recurrence_exceptions;
DROP TABLE recurrence_rules;
ALTER TABLE recurrence_rules_next RENAME TO recurrence_rules;
ALTER TABLE recurrence_exceptions_next RENAME TO recurrence_exceptions;

CREATE INDEX idx_recurrence_rules_project ON recurrence_rules(project_id);
CREATE INDEX idx_recurrence_rules_active ON recurrence_rules(is_active);
CREATE INDEX idx_recurrence_exceptions_rule_date ON recurrence_exceptions(rule_id, occurrence_date);
