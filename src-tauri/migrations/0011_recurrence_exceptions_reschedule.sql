-- One-off recurrence changes remain virtual: no meeting row is created.
CREATE TABLE recurrence_exceptions_next (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES recurrence_rules(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL CHECK(occurrence_date GLOB '????-??-??'),
  action TEXT NOT NULL CHECK(action IN ('skip', 'rescheduled', 'materialized')),
  replacement_date TEXT NULL CHECK(replacement_date IS NULL OR replacement_date GLOB '????-??-??'),
  materialized_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(rule_id, occurrence_date),
  CHECK(
    (action = 'rescheduled' AND replacement_date IS NOT NULL AND materialized_id IS NULL)
    OR (action IN ('skip', 'materialized') AND replacement_date IS NULL)
  )
);

INSERT INTO recurrence_exceptions_next
  (id, rule_id, occurrence_date, action, replacement_date, materialized_id, created_at, updated_at)
SELECT id, rule_id, occurrence_date, action, NULL, materialized_id, created_at, updated_at
FROM recurrence_exceptions;

DROP TABLE recurrence_exceptions;
ALTER TABLE recurrence_exceptions_next RENAME TO recurrence_exceptions;
CREATE INDEX idx_recurrence_exceptions_rule_date ON recurrence_exceptions(rule_id, occurrence_date);
