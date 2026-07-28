-- Migration 0003: finish-to-start dependency guards.
--
-- Strictly additive: CREATE TRIGGER / CREATE INDEX only. Migration 0001 already
-- gives task_dependencies everything its own row needs —
--   PRIMARY KEY (id),
--   predecessor_id / successor_id NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
--   CHECK (predecessor_id <> successor_id)      -> self dependency impossible,
--   UNIQUE (predecessor_id, successor_id)       -> duplicate edge impossible,
--   CHECK (dep_type IN ('FS'))                  -> only finish-to-start exists,
-- so nothing about the table is rebuilt or altered here.
--
-- What 0001 cannot express are the two invariants that span *pairs* of rows:
-- an edge must stay inside one project, and two edges must not point at each
-- other. Both are added below as BEFORE INSERT/UPDATE triggers.
--
-- Edge direction is fixed application-wide: predecessor_id -> successor_id,
-- meaning the successor waits for the predecessor to finish.
--
-- Deliberately NOT attempted here: cycles longer than two edges. A recursive
-- SQLite trigger would need a CTE walk on every insert, and its abort message
-- could not name the offending path, so arbitrary-depth cycle detection lives in
-- the service (dependencyGraph.wouldCreateCycle, checked before every write) and
-- is covered by tests. This file guards the length-2 case only; see the report.

-- Both endpoints of an edge must belong to the same project. EXISTS keeps a
-- missing task out of scope so it still surfaces as a foreign key error rather
-- than being mislabelled as a cross-project dependency.
CREATE TRIGGER trg_deps_same_project_insert
BEFORE INSERT ON task_dependencies
WHEN EXISTS (
  SELECT 1 FROM tasks p JOIN tasks s ON s.id = NEW.successor_id
  WHERE p.id = NEW.predecessor_id AND p.project_id <> s.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'CROSS_PROJECT_DEPENDENCY');
END;

CREATE TRIGGER trg_deps_same_project_update
BEFORE UPDATE ON task_dependencies
WHEN EXISTS (
  SELECT 1 FROM tasks p JOIN tasks s ON s.id = NEW.successor_id
  WHERE p.id = NEW.predecessor_id AND p.project_id <> s.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'CROSS_PROJECT_DEPENDENCY');
END;

-- A -> B plus B -> A is a two-edge cycle. UNIQUE cannot see it because the
-- column pair differs; the reversed edge is a distinct row.
CREATE TRIGGER trg_deps_no_reverse_insert
BEFORE INSERT ON task_dependencies
WHEN EXISTS (
  SELECT 1 FROM task_dependencies
  WHERE predecessor_id = NEW.successor_id AND successor_id = NEW.predecessor_id
)
BEGIN
  SELECT RAISE(ABORT, 'REVERSE_DEPENDENCY');
END;

CREATE TRIGGER trg_deps_no_reverse_update
BEFORE UPDATE ON task_dependencies
WHEN EXISTS (
  SELECT 1 FROM task_dependencies
  WHERE predecessor_id = NEW.successor_id
    AND successor_id = NEW.predecessor_id
    AND id <> NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'REVERSE_DEPENDENCY');
END;

-- No index is added: 0001 already indexes successor_id, and predecessor lookups
-- are served by the leftmost column of the UNIQUE (predecessor_id, successor_id)
-- auto-index. Loading a project's edges joins back to tasks, which is covered by
-- the existing index on tasks (project_id). An index on dep_type would be dead
-- weight while 'FS' is the only permitted value.
