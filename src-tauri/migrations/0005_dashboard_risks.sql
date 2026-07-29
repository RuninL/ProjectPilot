-- Migration 0005: structured project risks for the phase 5 dashboard.
-- Additive only: existing project, task, meeting, and milestone rows are untouched.
CREATE TABLE risks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('scope', 'schedule', 'resource', 'technical', 'external', 'other')),
  likelihood TEXT NOT NULL CHECK (likelihood IN ('low', 'medium', 'high')),
  impact TEXT NOT NULL CHECK (impact IN ('low', 'medium', 'high')),
  level TEXT NOT NULL CHECK (level IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'monitoring', 'mitigated', 'closed')),
  owner TEXT NOT NULL DEFAULT '',
  mitigation_plan TEXT NOT NULL DEFAULT '',
  due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '????-??-??'),
  resolved_at TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    level = CASE
      WHEN likelihood = 'high' AND impact = 'high' THEN 'critical'
      WHEN (likelihood = 'high' AND impact IN ('medium', 'high'))
        OR (impact = 'high' AND likelihood IN ('medium', 'high')) THEN 'high'
      WHEN likelihood = 'medium' AND impact = 'medium' THEN 'medium'
      ELSE 'low'
    END
  ),
  CHECK (
    (status IN ('mitigated', 'closed') AND resolved_at IS NOT NULL)
    OR (status IN ('open', 'monitoring') AND resolved_at IS NULL)
  )
);
CREATE INDEX idx_risks_project ON risks (project_id);
CREATE INDEX idx_risks_status_level_due ON risks (status, level, due_date);
CREATE INDEX idx_risks_project_status ON risks (project_id, status);
