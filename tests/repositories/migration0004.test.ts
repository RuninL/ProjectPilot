import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW, createTestDb, type TestDb } from '../helpers/testDb';

/**
 * Migration 0004 verified against real SQLite with raw SQL, so every assertion is
 * about the database refusing (or accepting) a write — not about the service
 * layer. The last describe block is the honest counterpart: the rules SQLite
 * cannot express here, asserted as accepted, so the service-layer backstops are
 * never mistaken for database guarantees.
 */

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
  db.raw
    .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('p1', '项目一', NOW, NOW);
});

afterEach(() => {
  db.close();
});

function insertTask(id: string): void {
  db.raw
    .prepare(
      'INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, 'p1', `任务 ${id}`, NOW, NOW);
}

function insertMeeting(id: string, startTime: string | null = null, projectId = 'p1'): void {
  db.raw
    .prepare(
      `INSERT INTO meetings (id, project_id, topic, date, start_time, created_at, updated_at)
       VALUES (?, ?, ?, '2026-07-14', ?, ?, ?)`,
    )
    .run(id, projectId, `会议 ${id}`, startTime, NOW, NOW);
}

function insertItem(
  id: string,
  meetingId = 'm1',
  convertedTaskId: string | null = null,
  convertedAt: string | null = null,
): void {
  db.raw
    .prepare(
      `INSERT INTO action_items
         (id, meeting_id, content, converted_task_id, converted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, meetingId, `行动项 ${id}`, convertedTaskId, convertedAt, NOW, NOW);
}

function readItem(id: string): { converted_task_id: string | null; converted_at: string | null } {
  return db.raw
    .prepare('SELECT converted_task_id, converted_at FROM action_items WHERE id = ?')
    .get(id) as { converted_task_id: string | null; converted_at: string | null };
}

function itemCount(): number {
  const row = db.raw.prepare('SELECT COUNT(*) AS n FROM action_items').get();
  return (row as { n: number }).n;
}

function taskCount(): number {
  const row = db.raw.prepare('SELECT COUNT(*) AS n FROM tasks').get();
  return (row as { n: number }).n;
}

describe('migration 0004 — additive only', () => {
  it('adds start_time to meetings and keeps every earlier column', () => {
    const columns = db.raw
      .prepare('PRAGMA table_info(meetings)')
      .all()
      .map((row) => (row as { name: string }).name);

    expect(columns).toEqual([
      'id',
      'project_id',
      'topic',
      'date',
      'attendees',
      'agenda',
      'notes',
      'decisions',
      'risks',
      'is_sample',
      'created_at',
      'updated_at',
      'start_time',
      'source_rule_id',
      'source_occurrence_date',
      'meeting_url',
    ]);
  });

  it('leaves action_items and milestones columns untouched', () => {
    const actionItemColumns = db.raw
      .prepare('PRAGMA table_info(action_items)')
      .all()
      .map((row) => (row as { name: string }).name);
    expect(actionItemColumns).toEqual([
      'id',
      'meeting_id',
      'content',
      'owner',
      'due_date',
      'status',
      'converted_task_id',
      'converted_at',
      'created_at',
      'updated_at',
    ]);

    const milestoneColumns = db.raw
      .prepare('PRAGMA table_info(milestones)')
      .all()
      .map((row) => (row as { name: string }).name);
    expect(milestoneColumns).toEqual([
      'id',
      'project_id',
      'linked_task_id',
      'name',
      'description',
      'date',
      'status',
      'achieved_at',
      'is_sample',
      'created_at',
      'updated_at',
    ]);
  });

  it('adds the five guard triggers without dropping the earlier ones', () => {
    const triggers = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(triggers).toContain('trg_meetings_start_time_insert');
    expect(triggers).toContain('trg_meetings_start_time_update');
    expect(triggers).toContain('trg_action_items_no_reconvert');
    expect(triggers).toContain('trg_action_items_conversion_audit_insert');
    expect(triggers).toContain('trg_action_items_conversion_audit_update');
    // 0001/0002/0003 guards must survive.
    expect(triggers).toContain('trg_tasks_max_two_levels_insert');
    expect(triggers).toContain('trg_deps_same_project_insert');
  });

  it('adds the milestone date index and keeps the existing ones', () => {
    const indexes = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'milestones'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(indexes).toContain('idx_milestones_date');
    expect(indexes).toContain('idx_milestones_project_date');
    expect(indexes).toContain('idx_milestones_status_date');
    expect(indexes).toContain('idx_milestones_task');
  });

  it('is registered as version 4 in the Rust migration list', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src-tauri/src/migrations.rs', 'utf8'),
    );
    expect(source).toContain('version: 4');
    expect(source).toContain('0004_meetings_action_items.sql');
  });
});

describe('migration 0004 — meeting start_time format guard', () => {
  it('accepts a null time (the column stays optional)', () => {
    insertMeeting('m1', null);
    expect(db.raw.prepare('SELECT start_time FROM meetings WHERE id = ?').get('m1')).toStrictEqual({
      start_time: null,
    });
  });

  it('accepts a valid 24-hour time', () => {
    insertMeeting('m1', '09:30');
    insertMeeting('m2', '23:59');
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM meetings').get()).toStrictEqual({ n: 2 });
  });

  it('rejects a malformed time on INSERT', () => {
    expect(() => {
      insertMeeting('m1', '9:30');
    }).toThrow(/INVALID_MEETING_TIME/);
    expect(() => {
      insertMeeting('m2', '晚上八点');
    }).toThrow(/INVALID_MEETING_TIME/);
  });

  it('rejects an out-of-range hour that GLOB alone would accept', () => {
    expect(() => {
      insertMeeting('m1', '29:00');
    }).toThrow(/INVALID_MEETING_TIME/);
  });

  it('rejects a malformed time on UPDATE and leaves the row unchanged', () => {
    insertMeeting('m1', '09:30');

    expect(() => {
      db.raw.prepare('UPDATE meetings SET start_time = ? WHERE id = ?').run('99:99', 'm1');
    }).toThrow(/INVALID_MEETING_TIME/);
    expect(db.raw.prepare('SELECT start_time FROM meetings WHERE id = ?').get('m1')).toStrictEqual({
      start_time: '09:30',
    });
  });

  it('allows clearing the time back to null', () => {
    insertMeeting('m1', '09:30');
    db.raw.prepare('UPDATE meetings SET start_time = NULL WHERE id = ?').run('m1');
    expect(db.raw.prepare('SELECT start_time FROM meetings WHERE id = ?').get('m1')).toStrictEqual({
      start_time: null,
    });
  });
});

describe('migration 0004 — conversion audit pair', () => {
  beforeEach(() => {
    insertMeeting('m1');
    insertTask('t1');
  });

  it('rejects an INSERT that sets a task id without converted_at', () => {
    expect(() => {
      insertItem('a1', 'm1', 't1', null);
    }).toThrow(/CONVERSION_AUDIT_REQUIRED/);
    expect(itemCount()).toBe(0);
  });

  it('rejects an UPDATE that sets a task id without converted_at', () => {
    insertItem('a1');

    expect(() => {
      db.raw.prepare('UPDATE action_items SET converted_task_id = ? WHERE id = ?').run('t1', 'a1');
    }).toThrow(/CONVERSION_AUDIT_REQUIRED/);
    expect(readItem('a1')).toStrictEqual({ converted_task_id: null, converted_at: null });
  });

  it('accepts the pair written together', () => {
    insertItem('a1');
    db.raw
      .prepare('UPDATE action_items SET converted_task_id = ?, converted_at = ? WHERE id = ?')
      .run('t1', NOW, 'a1');

    expect(readItem('a1')).toStrictEqual({ converted_task_id: 't1', converted_at: NOW });
  });
});

describe('migration 0004 — re-conversion guard', () => {
  beforeEach(() => {
    insertMeeting('m1');
    insertTask('t1');
    insertTask('t2');
  });

  it('aborts repointing a converted item at a different task', () => {
    insertItem('a1', 'm1', 't1', NOW);

    expect(() => {
      db.raw
        .prepare('UPDATE action_items SET converted_task_id = ?, converted_at = ? WHERE id = ?')
        .run('t2', NOW, 'a1');
    }).toThrow(/ALREADY_CONVERTED/);
    expect(readItem('a1')).toStrictEqual({ converted_task_id: 't1', converted_at: NOW });
  });

  it('still allows rewriting the same task id (idempotent retry)', () => {
    insertItem('a1', 'm1', 't1', NOW);

    db.raw
      .prepare('UPDATE action_items SET converted_task_id = ?, converted_at = ? WHERE id = ?')
      .run('t1', NOW, 'a1');

    expect(readItem('a1')).toStrictEqual({ converted_task_id: 't1', converted_at: NOW });
  });

  it('does not block ON DELETE SET NULL, which writes a NULL task id', () => {
    insertItem('a1', 'm1', 't1', NOW);

    db.raw.prepare('DELETE FROM tasks WHERE id = ?').run('t1');

    expect(readItem('a1')).toStrictEqual({ converted_task_id: null, converted_at: NOW });
  });

  it('aborts re-conversion after the task was deleted ("任务已删除" is terminal)', () => {
    insertItem('a1', 'm1', 't1', NOW);
    db.raw.prepare('DELETE FROM tasks WHERE id = ?').run('t1');

    expect(() => {
      db.raw
        .prepare('UPDATE action_items SET converted_task_id = ?, converted_at = ? WHERE id = ?')
        .run('t2', NOW, 'a1');
    }).toThrow(/ALREADY_CONVERTED/);
    expect(readItem('a1')).toStrictEqual({ converted_task_id: null, converted_at: NOW });
  });

  it('leaves an unconverted item free to convert', () => {
    insertItem('a1');

    db.raw
      .prepare('UPDATE action_items SET converted_task_id = ?, converted_at = ? WHERE id = ?')
      .run('t1', NOW, 'a1');

    expect(readItem('a1')).toStrictEqual({ converted_task_id: 't1', converted_at: NOW });
  });

  it('keeps UNIQUE(converted_task_id) from 0001 — one task backs one item', () => {
    insertItem('a1', 'm1', 't1', NOW);

    expect(() => {
      insertItem('a2', 'm1', 't1', NOW);
    }).toThrow(/UNIQUE constraint failed/);
  });
});

describe('migration 0004 — meeting cascade is unchanged', () => {
  it('deletes a meeting action items and nothing else', () => {
    insertMeeting('m1');
    insertMeeting('m2');
    insertItem('a1', 'm1');
    insertItem('a2', 'm1');
    insertItem('b1', 'm2');

    db.raw.prepare('DELETE FROM meetings WHERE id = ?').run('m1');

    const remaining = db.raw
      .prepare('SELECT id FROM action_items ORDER BY id')
      .all()
      .map((row) => (row as { id: string }).id);
    expect(remaining).toEqual(['b1']);
  });

  it('keeps a converted task alive and nulls tasks.source_meeting_id', () => {
    insertMeeting('m1');
    insertTask('t1');
    db.raw.prepare('UPDATE tasks SET source_meeting_id = ? WHERE id = ?').run('m1', 't1');
    insertItem('a1', 'm1', 't1', NOW);

    db.raw.prepare('DELETE FROM meetings WHERE id = ?').run('m1');

    expect(itemCount()).toBe(0);
    expect(taskCount()).toBe(1);
    expect(
      db.raw.prepare('SELECT source_meeting_id FROM tasks WHERE id = ?').get('t1'),
    ).toStrictEqual({ source_meeting_id: null });
  });

  it('accepts a meeting with no project (standalone meetings are legal)', () => {
    db.raw
      .prepare(
        `INSERT INTO meetings (id, project_id, topic, date, created_at, updated_at)
         VALUES (?, NULL, ?, '2026-07-14', ?, ?)`,
      )
      .run('m1', '一对一', NOW, NOW);

    expect(db.raw.prepare('SELECT project_id FROM meetings WHERE id = ?').get('m1')).toStrictEqual({
      project_id: null,
    });
  });
});

describe('migration 0004 — the atomic conversion pair, driven as one transaction', () => {
  beforeEach(() => {
    insertMeeting('m1');
    insertItem('a1');
  });

  const insertForConversion = `INSERT INTO tasks (id, project_id, title, status, priority, progress, source_meeting_id, is_sample, created_at, updated_at)
     SELECT ?, ?, ?, 'todo', 'medium', 0, ?, 0, ?, ?
      WHERE EXISTS (SELECT 1 FROM action_items WHERE id = ? AND converted_at IS NULL)`;
  const convert = `UPDATE action_items SET converted_task_id = ?, converted_at = ?, updated_at = ?
      WHERE id = ? AND converted_at IS NULL AND converted_task_id IS NULL`;

  function convertBatch(taskId: string): number {
    return db.runBatch([
      { sql: insertForConversion, params: [taskId, 'p1', '跟进事项', 'm1', NOW, NOW, 'a1'] },
      { sql: convert, params: [taskId, NOW, NOW, 'a1'] },
    ]);
  }

  it('commits both rows on the first conversion', () => {
    expect(convertBatch('t-new')).toBe(2);
    expect(readItem('a1')).toStrictEqual({ converted_task_id: 't-new', converted_at: NOW });
    expect(taskCount()).toBe(1);
  });

  it('a second conversion writes zero rows and creates no orphan task', () => {
    convertBatch('t-first');

    // The guard on the INSERT is what prevents the orphan: it is evaluated in the
    // same transaction, so the task is never inserted at all.
    expect(convertBatch('t-second')).toBe(0);
    expect(taskCount()).toBe(1);
    expect(readItem('a1')).toStrictEqual({ converted_task_id: 't-first', converted_at: NOW });
  });

  it('rolls the task insert back when the linking update fails', () => {
    // A foreign key violation on the update half must take the insert with it.
    expect(() =>
      db.runBatch([
        { sql: insertForConversion, params: ['t-x', 'p1', '跟进事项', 'm1', NOW, NOW, 'a1'] },
        {
          sql: 'UPDATE action_items SET converted_task_id = ?, converted_at = ? WHERE id = ?',
          params: ['ghost-task', NOW, 'a1'],
        },
      ]),
    ).toThrow(/FOREIGN KEY/);

    expect(taskCount()).toBe(0);
    expect(readItem('a1')).toStrictEqual({ converted_task_id: null, converted_at: null });
  });
});

describe('migration 0004 — what SQLite does NOT guarantee (service-layer backstops)', () => {
  beforeEach(() => {
    insertMeeting('m1');
    insertTask('t1');
  });

  it('accepts a task created from an action item under an ARCHIVED project', () => {
    db.raw.prepare('UPDATE projects SET archived_at = ? WHERE id = ?').run(NOW, 'p1');

    // Documented limitation: nothing in the schema ties task creation to the
    // project's archive state. `actionItem.service.convertToTask` refuses this,
    // and its test proves it — the database itself will happily accept the row.
    insertTask('t-archived');

    expect(taskCount()).toBe(2);
  });

  it('accepts an action item whose converted_at exists with no task id ever set', () => {
    // The "任务已删除" shape is also reachable directly. It is indistinguishable
    // from a real post-delete row, which is exactly why the service — not the
    // schema — decides that this state does not re-open conversion.
    insertItem('a1', 'm1', null, NOW);

    expect(readItem('a1')).toStrictEqual({ converted_task_id: null, converted_at: NOW });
  });

  it('accepts a milestone status change with no user confirmation', () => {
    db.raw
      .prepare(
        `INSERT INTO milestones (id, project_id, linked_task_id, name, date, status, created_at, updated_at)
         VALUES (?, 'p1', ?, ?, '2026-08-01', 'upcoming', ?, ?)`,
      )
      .run('ms1', 't1', '里程碑', NOW, NOW);
    db.raw.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('done', 't1');

    // No trigger flips the milestone, and none should: the product rule is that a
    // milestone's status is only ever the user's own statement. The database
    // simply has no opinion, so the guarantee lives in the service and the UI.
    expect(db.raw.prepare('SELECT status FROM milestones WHERE id = ?').get('ms1')).toStrictEqual({
      status: 'upcoming',
    });
  });
});
