-- ProjectPilot migration 0015: task <-> meeting association links.
--
-- STRICTLY ADDITIVE: one CREATE TABLE and two CREATE INDEX. No DROP, no table
-- rebuild, no data copied or deleted — applying this to a populated database
-- cannot lose a row.
--
-- Linking a task to a meeting is an independent association: it does not
-- change the task's project, the meeting's project, or any participant data.
-- Deleting either side removes the link only (ON DELETE CASCADE).

CREATE TABLE task_meetings (
  task_id    TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  linked_at  TEXT NOT NULL,
  PRIMARY KEY (task_id, meeting_id)
);
CREATE INDEX idx_task_meetings_task ON task_meetings (task_id);
CREATE INDEX idx_task_meetings_meeting ON task_meetings (meeting_id);
