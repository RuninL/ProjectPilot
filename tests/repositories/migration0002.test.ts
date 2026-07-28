import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW, createTestDb, type TestDb } from '../helpers/testDb';

/**
 * Migration 0002 verified against real SQLite. Every hierarchy check is driven
 * with raw SQL rather than the repositories, because the point is that the
 * database itself refuses the write even when the service layer is bypassed.
 */

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
  db.raw
    .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('p1', '项目一', NOW, NOW);
  db.raw
    .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('p2', '项目二', NOW, NOW);
});

afterEach(() => {
  db.close();
});

function insertTask(id: string, projectId: string, parentId: string | null = null): void {
  db.raw
    .prepare(
      `INSERT INTO tasks (id, project_id, parent_task_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, projectId, parentId, `任务 ${id}`, NOW, NOW);
}

describe('migration 0002 — schema additions', () => {
  it('adds completed_at, archived_at and source_meeting_id to tasks', () => {
    const columns = db.raw
      .prepare('PRAGMA table_info(tasks)')
      .all()
      .map((row) => (row as { name: string }).name);

    expect(columns).toContain('completed_at');
    expect(columns).toContain('archived_at');
    expect(columns).toContain('source_meeting_id');
  });

  it('keeps every pre-existing tasks column (the table was never rebuilt)', () => {
    const columns = db.raw
      .prepare('PRAGMA table_info(tasks)')
      .all()
      .map((row) => (row as { name: string }).name);

    for (const column of [
      'id',
      'project_id',
      'parent_task_id',
      'title',
      'description',
      'status',
      'priority',
      'start_date',
      'due_date',
      'progress',
      'estimated_hours',
      'actual_hours',
      'is_sample',
      'created_at',
      'updated_at',
    ]) {
      expect(columns).toContain(column);
    }
  });

  it('creates the archived and due/status indexes', () => {
    const indexes = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(indexes).toContain('idx_tasks_archived');
    expect(indexes).toContain('idx_tasks_due_status');
  });

  it('creates the four hierarchy triggers alongside the 0001 ones', () => {
    const triggers = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(triggers).toContain('trg_tasks_no_self_parent_insert');
    expect(triggers).toContain('trg_tasks_no_self_parent_update');
    expect(triggers).toContain('trg_tasks_same_project_parent_insert');
    expect(triggers).toContain('trg_tasks_same_project_parent_update');
    // 0001's two-level guards must survive.
    expect(triggers).toContain('trg_tasks_max_two_levels_insert');
    expect(triggers).toContain('trg_tasks_max_two_levels_update');
  });

  it('defaults the new columns to NULL for rows created without them', () => {
    insertTask('t1', 'p1');
    const row = db.raw.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');

    expect(row).toMatchObject({
      completed_at: null,
      archived_at: null,
      source_meeting_id: null,
    });
  });

  it('sets source_meeting_id to NULL when the source meeting is deleted', () => {
    db.raw
      .prepare(
        'INSERT INTO meetings (id, project_id, topic, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('m1', 'p1', '周会', '2026-07-14', NOW, NOW);
    insertTask('t1', 'p1');
    db.raw.prepare('UPDATE tasks SET source_meeting_id = ? WHERE id = ?').run('m1', 't1');

    db.raw.prepare('DELETE FROM meetings WHERE id = ?').run('m1');

    const row = db.raw.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');
    expect(row).toMatchObject({ id: 't1', source_meeting_id: null });
  });
});

describe('migration 0002 — self parent is rejected by the database', () => {
  it('rejects an INSERT whose parent_task_id equals its own id', () => {
    expect(() => {
      insertTask('t1', 'p1', 't1');
    }).toThrow(/SELF_PARENT/);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 0 });
  });

  it('rejects an UPDATE that points a task at itself', () => {
    insertTask('t1', 'p1');

    expect(() => {
      db.raw.prepare('UPDATE tasks SET parent_task_id = id WHERE id = ?').run('t1');
    }).toThrow(/SELF_PARENT/);

    const row = db.raw.prepare('SELECT parent_task_id FROM tasks WHERE id = ?').get('t1');
    expect(row).toEqual({ parent_task_id: null });
  });
});

describe('migration 0002 — cross-project parent is rejected by the database', () => {
  it('rejects an INSERT whose parent belongs to another project', () => {
    insertTask('parent', 'p2');

    expect(() => {
      insertTask('child', 'p1', 'parent');
    }).toThrow(/CROSS_PROJECT_PARENT/);
  });

  it('rejects an UPDATE that reassigns the parent across projects', () => {
    insertTask('other', 'p2');
    insertTask('t1', 'p1');

    expect(() => {
      db.raw.prepare('UPDATE tasks SET parent_task_id = ? WHERE id = ?').run('other', 't1');
    }).toThrow(/CROSS_PROJECT_PARENT/);
  });

  it('rejects moving a child into another project while keeping its parent', () => {
    insertTask('parent', 'p1');
    insertTask('child', 'p1', 'parent');

    expect(() => {
      db.raw.prepare('UPDATE tasks SET project_id = ? WHERE id = ?').run('p2', 'child');
    }).toThrow(/CROSS_PROJECT_PARENT/);
  });

  it('still reports a missing parent as a foreign key error, not a cross-project one', () => {
    expect(() => {
      insertTask('t1', 'p1', 'ghost');
    }).toThrow(/FOREIGN KEY/);
  });

  it('allows a parent in the same project', () => {
    insertTask('parent', 'p1');
    insertTask('child', 'p1', 'parent');

    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 2 });
  });

  it('leaves unrelated updates working', () => {
    insertTask('parent', 'p1');
    insertTask('child', 'p1', 'parent');

    db.raw.prepare('UPDATE tasks SET title = ? WHERE id = ?').run('改名', 'child');

    expect(db.raw.prepare('SELECT title FROM tasks WHERE id = ?').get('child')).toEqual({
      title: '改名',
    });
  });
});

describe('migration 0002 — the two-level limit from 0001 still holds', () => {
  it('rejects a third level on INSERT', () => {
    insertTask('a', 'p1');
    insertTask('b', 'p1', 'a');

    expect(() => {
      insertTask('c', 'p1', 'b');
    }).toThrow(/MAX_TWO_LEVELS/);
  });

  it('rejects a third level on UPDATE', () => {
    insertTask('a', 'p1');
    insertTask('b', 'p1', 'a');
    insertTask('c', 'p1');

    expect(() => {
      db.raw.prepare('UPDATE tasks SET parent_task_id = ? WHERE id = ?').run('b', 'c');
    }).toThrow(/MAX_TWO_LEVELS/);
  });

  it('rejects giving a parent to a task that already has children', () => {
    insertTask('a', 'p1');
    insertTask('b', 'p1', 'a');
    insertTask('c', 'p1');

    expect(() => {
      db.raw.prepare('UPDATE tasks SET parent_task_id = ? WHERE id = ?').run('c', 'a');
    }).toThrow(/MAX_TWO_LEVELS/);
  });
});
