-- Migration 0006: optional notes for project file and link shortcuts.
-- Additive only: existing links receive an empty description.
ALTER TABLE project_links
  ADD COLUMN description TEXT NOT NULL DEFAULT '';
