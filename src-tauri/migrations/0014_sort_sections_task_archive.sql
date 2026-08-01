-- v1.3 rework: sortable sub-orders per view and task archive provenance.
--
-- 1. tasks.archived_source records WHY a task is archived:
--      'manual'  — the user archived the task directly;
--      'project' — the task was auto-archived because its project was archived.
--    Restoring a project can then restore exactly the tasks it archived,
--    without touching tasks the user archived by hand.
--    Existing archived rows are backfilled as 'manual' (the safe choice: a
--    project restore never silently un-archives them).
--
-- 2. named_list_orders.ordered_ids_json is relaxed from "JSON array" to
--    "JSON array or object" so one named order can carry several sub-orders
--    (for example projects: active / archived / all). SQLite cannot alter a
--    CHECK in place, so the table is rebuilt with the 0013 copy-and-guard
--    pattern; no rows are dropped.
--
-- Runs inside the tauri-plugin-sql migration transaction with foreign keys ON;
-- no nested transactions, no PRAGMA foreign_keys toggling.

ALTER TABLE tasks ADD COLUMN archived_source TEXT NULL
  CHECK (archived_source IN ('manual', 'project'));

UPDATE tasks SET archived_source = 'manual'
 WHERE archived_at IS NOT NULL AND archived_source IS NULL;

CREATE TABLE migration_0014_counts (
  entity TEXT PRIMARY KEY,
  row_count INTEGER NOT NULL
);
INSERT INTO migration_0014_counts (entity, row_count)
VALUES ('named_list_orders', (SELECT COUNT(*) FROM named_list_orders));

CREATE TABLE named_list_orders_next (
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
                     CHECK (
                       json_valid(ordered_ids_json)
                       AND json_type(ordered_ids_json) IN ('array', 'object')
                     ),
  is_default       INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (context, context_id, name COLLATE NOCASE)
);

INSERT INTO named_list_orders_next (
  id, context, context_id, name, ordered_ids_json, is_default, created_at, updated_at
)
SELECT id, context, context_id, name, ordered_ids_json, is_default, created_at, updated_at
FROM named_list_orders;

DROP TABLE named_list_orders;
ALTER TABLE named_list_orders_next RENAME TO named_list_orders;

CREATE INDEX idx_named_list_orders_context
  ON named_list_orders (context, context_id, updated_at);
CREATE UNIQUE INDEX idx_named_list_orders_default
  ON named_list_orders (context, context_id)
  WHERE is_default = 1;

CREATE TABLE migration_0014_guard (
  result INTEGER NOT NULL CHECK (result = 0)
);
INSERT INTO migration_0014_guard (result)
SELECT
  (SELECT row_count FROM migration_0014_counts WHERE entity = 'named_list_orders')
  - (SELECT COUNT(*) FROM named_list_orders);
INSERT INTO migration_0014_guard (result)
SELECT COUNT(*) FROM pragma_foreign_key_check;
INSERT INTO migration_0014_guard (result)
SELECT COUNT(*) FROM pragma_integrity_check WHERE integrity_check <> 'ok';

DROP TABLE migration_0014_guard;
DROP TABLE migration_0014_counts;
