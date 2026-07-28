import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW, createTestDb, type TestDb } from '../helpers/testDb';

/**
 * Migration 0003 verified against real SQLite, driven with raw SQL so the
 * assertions are about the database refusing the write rather than about the
 * service layer. The self-dependency, duplicate-pair and foreign-key rules come
 * from 0001 and are re-asserted here: 0003 must not have weakened them.
 */

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
  for (const [id, name] of [
    ['p1', '项目一'],
    ['p2', '项目二'],
  ]) {
    db.raw
      .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, name, NOW, NOW);
  }
});

afterEach(() => {
  db.close();
});

function insertTask(id: string, projectId = 'p1'): void {
  db.raw
    .prepare(
      'INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, projectId, `任务 ${id}`, NOW, NOW);
}

function insertDep(id: string, predecessorId: string, successorId: string): void {
  db.raw
    .prepare(
      `INSERT INTO task_dependencies
         (id, predecessor_id, successor_id, dep_type, lag_days, created_at, updated_at)
       VALUES (?, ?, ?, 'FS', 0, ?, ?)`,
    )
    .run(id, predecessorId, successorId, NOW, NOW);
}

function depCount(): number {
  const row = db.raw.prepare('SELECT COUNT(*) AS n FROM task_dependencies').get();
  return (row as { n: number }).n;
}

describe('migration 0003 — additive only', () => {
  it('keeps every task_dependencies column from 0001', () => {
    const columns = db.raw
      .prepare('PRAGMA table_info(task_dependencies)')
      .all()
      .map((row) => (row as { name: string }).name);

    expect(columns).toEqual([
      'id',
      'predecessor_id',
      'successor_id',
      'dep_type',
      'lag_days',
      'created_at',
      'updated_at',
    ]);
  });

  it('adds the four dependency guard triggers', () => {
    const triggers = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(triggers).toContain('trg_deps_same_project_insert');
    expect(triggers).toContain('trg_deps_same_project_update');
    expect(triggers).toContain('trg_deps_no_reverse_insert');
    expect(triggers).toContain('trg_deps_no_reverse_update');
    // The 0001 and 0002 task guards must survive untouched.
    expect(triggers).toContain('trg_tasks_max_two_levels_insert');
    expect(triggers).toContain('trg_tasks_same_project_parent_insert');
  });

  it('keeps the 0001 successor index', () => {
    const indexes = db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_dependencies'",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(indexes).toContain('idx_deps_successor');
  });
});

describe('migration 0003 — constraints inherited from 0001', () => {
  it('rejects a self dependency', () => {
    insertTask('a');

    expect(() => {
      insertDep('d1', 'a', 'a');
    }).toThrow(/CHECK constraint failed/);
    expect(depCount()).toBe(0);
  });

  it('rejects a duplicate dependency between the same pair', () => {
    insertTask('a');
    insertTask('b');
    insertDep('d1', 'a', 'b');

    expect(() => {
      insertDep('d2', 'a', 'b');
    }).toThrow(/UNIQUE constraint failed/);
    expect(depCount()).toBe(1);
  });

  it('rejects an edge pointing at a task that does not exist', () => {
    insertTask('a');

    expect(() => {
      insertDep('d1', 'a', 'ghost');
    }).toThrow(/FOREIGN KEY/);
    expect(() => {
      insertDep('d2', 'ghost', 'a');
    }).toThrow(/FOREIGN KEY/);
    expect(depCount()).toBe(0);
  });

  it('rejects a dep_type other than FS', () => {
    insertTask('a');
    insertTask('b');

    expect(() => {
      db.raw
        .prepare(
          `INSERT INTO task_dependencies
             (id, predecessor_id, successor_id, dep_type, lag_days, created_at, updated_at)
           VALUES (?, ?, ?, 'SS', 0, ?, ?)`,
        )
        .run('d1', 'a', 'b', NOW, NOW);
    }).toThrow(/CHECK constraint failed/);
  });

  it('deletes the edge when either endpoint task is deleted', () => {
    insertTask('a');
    insertTask('b');
    insertTask('c');
    insertDep('d1', 'a', 'b');
    insertDep('d2', 'b', 'c');

    db.raw.prepare('DELETE FROM tasks WHERE id = ?').run('b');

    expect(depCount()).toBe(0);
  });
});

describe('migration 0003 — cross-project edges are rejected by the database', () => {
  it('rejects an INSERT whose endpoints are in different projects', () => {
    insertTask('a', 'p1');
    insertTask('b', 'p2');

    expect(() => {
      insertDep('d1', 'a', 'b');
    }).toThrow(/CROSS_PROJECT_DEPENDENCY/);
    expect(depCount()).toBe(0);
  });

  it('rejects an UPDATE that repoints an edge across projects', () => {
    insertTask('a', 'p1');
    insertTask('b', 'p1');
    insertTask('far', 'p2');
    insertDep('d1', 'a', 'b');

    expect(() => {
      db.raw.prepare('UPDATE task_dependencies SET successor_id = ? WHERE id = ?').run('far', 'd1');
    }).toThrow(/CROSS_PROJECT_DEPENDENCY/);

    const row = db.raw.prepare('SELECT successor_id FROM task_dependencies WHERE id = ?').get('d1');
    expect(row).toEqual({ successor_id: 'b' });
  });

  it('allows an edge inside one project', () => {
    insertTask('a', 'p1');
    insertTask('b', 'p1');

    insertDep('d1', 'a', 'b');

    expect(depCount()).toBe(1);
  });
});

describe('migration 0003 — reversed edges are rejected by the database', () => {
  it('rejects B -> A once A -> B exists', () => {
    insertTask('a');
    insertTask('b');
    insertDep('d1', 'a', 'b');

    expect(() => {
      insertDep('d2', 'b', 'a');
    }).toThrow(/REVERSE_DEPENDENCY/);
    expect(depCount()).toBe(1);
  });

  it('rejects an UPDATE that swaps an edge into its own mirror', () => {
    insertTask('a');
    insertTask('b');
    insertTask('c');
    insertDep('d1', 'a', 'b');
    insertDep('d2', 'a', 'c');

    expect(() => {
      db.raw
        .prepare('UPDATE task_dependencies SET predecessor_id = ?, successor_id = ? WHERE id = ?')
        .run('b', 'a', 'd2');
    }).toThrow(/REVERSE_DEPENDENCY/);
  });

  it('lets a row be updated in place without tripping on itself', () => {
    insertTask('a');
    insertTask('b');
    insertDep('d1', 'a', 'b');

    db.raw
      .prepare('UPDATE task_dependencies SET lag_days = 0, updated_at = ? WHERE id = ?')
      .run(NOW, 'd1');

    expect(depCount()).toBe(1);
  });

  it('does not block two edges that merely share an endpoint', () => {
    insertTask('a');
    insertTask('b');
    insertTask('c');

    insertDep('d1', 'a', 'c');
    insertDep('d2', 'b', 'c');

    expect(depCount()).toBe(2);
  });

  it('cannot see cycles of length three — that is the service layer job', () => {
    insertTask('a');
    insertTask('b');
    insertTask('c');
    insertDep('d1', 'a', 'b');
    insertDep('d2', 'b', 'c');

    // Documented limitation: the database accepts this closing edge.
    insertDep('d3', 'c', 'a');

    expect(depCount()).toBe(3);
  });
});
