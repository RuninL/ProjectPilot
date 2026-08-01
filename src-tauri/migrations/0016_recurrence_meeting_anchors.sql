-- One hidden meeting row is the stable association target for each recurring
-- meeting series. Occurrences remain virtual/materialized exactly as before.
INSERT INTO meetings (
  id, project_id, topic, date, start_time, attendees, agenda, notes, decisions, risks,
  source_rule_id, source_occurrence_date, is_sample, created_at, updated_at, meeting_url
)
SELECT
  'series-' || lower(hex(randomblob(16))),
  project_id,
  title,
  start_date,
  time_of_day,
  '[]',
  note,
  '',
  '',
  '',
  id,
  NULL,
  is_sample,
  created_at,
  updated_at,
  meeting_url
FROM recurrence_rules
WHERE kind = 'meeting'
  AND NOT EXISTS (
    SELECT 1
    FROM meetings
    WHERE meetings.source_rule_id = recurrence_rules.id
      AND meetings.source_occurrence_date IS NULL
  );

CREATE UNIQUE INDEX idx_meetings_series_anchor
  ON meetings (source_rule_id)
  WHERE source_rule_id IS NOT NULL AND source_occurrence_date IS NULL;

CREATE TRIGGER delete_recurrence_meeting_anchor
AFTER DELETE ON recurrence_rules
BEGIN
  DELETE FROM meetings
  WHERE source_rule_id = OLD.id AND source_occurrence_date IS NULL;
END;
