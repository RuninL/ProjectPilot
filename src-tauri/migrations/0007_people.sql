-- ProjectPilot migration 0007: people and independent participation links.
-- Assigning a person to a task does not implicitly add them to its project.

CREATE TABLE people (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_people_name ON people (name);

CREATE TABLE project_participants (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT ''
               CHECK (length(trim(role)) <= 120),
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, person_id)
);
CREATE INDEX idx_project_participants_project
  ON project_participants (project_id);
CREATE INDEX idx_project_participants_person
  ON project_participants (person_id);

CREATE TABLE task_participants (
  task_id     TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (task_id, person_id)
);
CREATE INDEX idx_task_participants_task
  ON task_participants (task_id);
CREATE INDEX idx_task_participants_person
  ON task_participants (person_id);
