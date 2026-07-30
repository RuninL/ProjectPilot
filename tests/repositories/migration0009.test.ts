import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { NOW } from '../helpers/testDb';

const migrationDir = join(process.cwd(), 'src-tauri/migrations');
const previous = [
  '0001_init.sql',
  '0002_task_lifecycle.sql',
  '0003_task_dependencies.sql',
  '0004_meetings_action_items.sql',
  '0005_dashboard_risks.sql',
  '0006_project_links_description.sql',
  '0007_people.sql',
  '0008_postponed_people_fields.sql',
];
const migration = readFileSync(join(migrationDir, '0009_recurrence_rules.sql'), 'utf8');
const existingTables = [
  'action_items',
  'app_settings',
  'meetings',
  'milestones',
  'people',
  'project_links',
  'project_participants',
  'projects',
  'risks',
  'task_dependencies',
  'task_participants',
  'tasks',
] as const;

type Column = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

function oldDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of previous) db.exec(readFileSync(join(migrationDir, file), 'utf8'));
  return db;
}

function columns(db: BetterSqlite3.Database, table: string): Column[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as Column[];
}

function indexNames(db: BetterSqlite3.Database, table: string): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name")
    .all(table)
    .map((row) => (row as { name: string }).name);
}

function insertProject(db: BetterSqlite3.Database, id = 'p'): void {
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    id,
    '项目',
    NOW,
    NOW,
  );
}

function insertTask(db: BetterSqlite3.Database, id: string, parentId: string | null = null): void {
  db.prepare(
    'INSERT INTO tasks (id, project_id, parent_task_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, 'p', parentId, id, NOW, NOW);
}

function insertRule(db: BetterSqlite3.Database, overrides: Record<string, unknown> = {}): void {
  const rule = {
    id: 'r',
    project_id: 'p',
    kind: 'task',
    title: '每周任务',
    byweekday: 0,
    interval: 1,
    start_date: '2026-01-01',
    end_date: null,
    time_of_day: null,
    duration_minutes: null,
    default_priority: null,
    note: '',
    is_active: 1,
    is_sample: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO recurrence_rules
      (id, project_id, kind, title, byweekday, interval, start_date, end_date, time_of_day,
       duration_minutes, default_priority, note, is_active, is_sample, created_at, updated_at)
     VALUES (@id, @project_id, @kind, @title, @byweekday, @interval, @start_date, @end_date,
       @time_of_day, @duration_minutes, @default_priority, @note, @is_active, @is_sample,
       @created_at, @updated_at)`,
  ).run(rule);
}

function seedOldDatabase(db: BetterSqlite3.Database): void {
  insertProject(db);
  insertTask(db, 't1');
  insertTask(db, 't2');
  db.prepare(
    'INSERT INTO task_dependencies (id, predecessor_id, successor_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('d', 't1', 't2', NOW, NOW);
  db.prepare(
    'INSERT INTO meetings (id, project_id, topic, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('m', 'p', '会议', '2026-01-01', NOW, NOW);
  db.prepare(
    'INSERT INTO action_items (id, meeting_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('a', 'm', '行动项', NOW, NOW);
  db.prepare(
    'INSERT INTO milestones (id, project_id, name, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('ms', 'p', '里程碑', '2026-01-01', NOW, NOW);
  db.prepare(
    'INSERT INTO project_links (id, project_id, label, link_type, target, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('l', 'p', '链接', 'url', 'https://example.com', NOW, NOW);
  db.prepare(
    'INSERT INTO app_settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run('theme', 'dark', NOW, NOW);
  db.prepare(
    `INSERT INTO risks (id, project_id, title, likelihood, impact, level, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('r', 'p', '风险', 'low', 'low', 'low', NOW, NOW);
  db.prepare('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    'person',
    '人员',
    NOW,
    NOW,
  );
  db.prepare(
    'INSERT INTO project_participants (project_id, person_id, joined_at) VALUES (?, ?, ?)',
  ).run('p', 'person', NOW);
  db.prepare(
    'INSERT INTO task_participants (task_id, person_id, assigned_at) VALUES (?, ?, ?)',
  ).run('t1', 'person', NOW);
}

describe('migration 0009', () => {
  it('preserves every old row and the full pre-existing column definitions', () => {
    const db = oldDb();
    seedOldDatabase(db);
    const oldColumns = Object.fromEntries(
      existingTables.map((table) => [table, columns(db, table).map((column) => column.name)]),
    );
    const oldRows = Object.fromEntries(
      existingTables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]),
    );
    const oldTaskColumns = columns(db, 'tasks');
    const oldMeetingColumns = columns(db, 'meetings');

    db.exec(migration);

    for (const table of existingTables) {
      expect(
        db.prepare(`SELECT ${oldColumns[table].join(', ')} FROM ${table} ORDER BY 1`).all(),
      ).toStrictEqual(oldRows[table]);
    }
    expect(columns(db, 'tasks').slice(0, oldTaskColumns.length)).toStrictEqual(oldTaskColumns);
    expect(columns(db, 'meetings').slice(0, oldMeetingColumns.length)).toStrictEqual(
      oldMeetingColumns,
    );
    expect(columns(db, 'tasks').slice(-2)).toStrictEqual([
      {
        cid: oldTaskColumns.length,
        name: 'source_rule_id',
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0,
      },
      {
        cid: oldTaskColumns.length + 1,
        name: 'source_occurrence_date',
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0,
      },
    ]);
    expect(columns(db, 'meetings').slice(-2)).toStrictEqual([
      {
        cid: oldMeetingColumns.length,
        name: 'source_rule_id',
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0,
      },
      {
        cid: oldMeetingColumns.length + 1,
        name: 'source_occurrence_date',
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0,
      },
    ]);
    db.close();
  });

  it('preserves tasks and meetings constraints, hierarchy triggers, foreign keys, and indexes', () => {
    const db = oldDb();
    db.exec(migration);
    insertProject(db);
    insertTask(db, 'root');
    insertTask(db, 'child', 'root');
    expect(() => {
      insertTask(db, 'grandchild', 'child');
    }).toThrow(/MAX_TWO_LEVELS/);
    expect(() =>
      db
        .prepare(
          'INSERT INTO tasks (id, project_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('bad-status', 'p', '坏状态', 'unknown', NOW, NOW),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare(
          'INSERT INTO tasks (id, project_id, title, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('bad-progress', 'p', '坏进度', 101, NOW, NOW),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare(
          'INSERT INTO tasks (id, project_id, title, start_date, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('bad-dates', 'p', '坏日期', '2026-02-01', '2026-01-01', NOW, NOW),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare(
          'INSERT INTO meetings (id, topic, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run('bad-meeting', ' ', 'invalid', NOW, NOW),
    ).toThrow(/CHECK/);
    expect(indexNames(db, 'tasks')).toEqual([
      'idx_tasks_archived',
      'idx_tasks_dashboard',
      'idx_tasks_due_status',
      'idx_tasks_parent',
      'idx_tasks_project_due',
      'idx_tasks_project_status',
      'idx_tasks_source_rule_id',
      'sqlite_autoindex_tasks_1',
    ]);
    expect(indexNames(db, 'meetings')).toEqual([
      'idx_meetings_date',
      'idx_meetings_project_date',
      'idx_meetings_source_rule_id',
      'sqlite_autoindex_meetings_1',
    ]);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_tasks_max_two_levels_insert'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_tasks_max_two_levels_update'",
        )
        .get(),
    ).toBeTruthy();
    db.prepare('DELETE FROM projects WHERE id = ?').run('p');
    expect(db.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toStrictEqual({ count: 0 });
    db.close();
  });

  it('enforces recurrence rule checks and indexes', () => {
    const db = oldDb();
    db.exec(migration);
    insertProject(db);
    for (const [field, value] of [
      ['kind', 'other'],
      ['byweekday', 7],
      ['interval', 0],
      ['end_date', '2025-12-31'],
    ] as const) {
      expect(() => {
        insertRule(db, { [field]: value });
      }).toThrow(/CHECK/);
    }
    insertRule(db);
    expect(indexNames(db, 'recurrence_rules')).toEqual([
      'idx_recurrence_rules_active',
      'idx_recurrence_rules_project',
      'sqlite_autoindex_recurrence_rules_1',
    ]);
    db.close();
  });

  it('enforces recurrence exception checks and unique occurrence dates', () => {
    const db = oldDb();
    db.exec(migration);
    insertProject(db);
    insertRule(db);
    const insertException = (id: string, action = 'skip') =>
      db
        .prepare(
          'INSERT INTO recurrence_exceptions (id, rule_id, occurrence_date, action, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, 'r', '2026-01-05', action, NOW, NOW);
    insertException('e');
    expect(() => {
      insertException('duplicate');
    }).toThrow(/UNIQUE/);
    expect(() => {
      insertException('bad-action', 'move');
    }).toThrow(/CHECK/);
    expect(indexNames(db, 'recurrence_exceptions')).toEqual([
      'idx_recurrence_exceptions_rule_date',
      'sqlite_autoindex_recurrence_exceptions_1',
      'sqlite_autoindex_recurrence_exceptions_2',
    ]);
    db.close();
  });

  it('cascades project deletion to rules and rule deletion to exceptions', () => {
    const db = oldDb();
    db.exec(migration);
    insertProject(db);
    insertRule(db);
    db.prepare(
      'INSERT INTO recurrence_exceptions (id, rule_id, occurrence_date, action, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('e', 'r', '2026-01-05', 'skip', NOW, NOW);
    db.prepare('DELETE FROM recurrence_rules WHERE id = ?').run('r');
    expect(db.prepare('SELECT COUNT(*) AS count FROM recurrence_exceptions').get()).toStrictEqual({
      count: 0,
    });
    insertRule(db);
    db.prepare('DELETE FROM projects WHERE id = ?').run('p');
    expect(db.prepare('SELECT COUNT(*) AS count FROM recurrence_rules').get()).toStrictEqual({
      count: 0,
    });
    db.close();
  });

  it('is registered once as version 9 in the Rust migration list', () => {
    const source = readFileSync(join(process.cwd(), 'src-tauri/src/migrations.rs'), 'utf8');
    expect(source.match(/version: 9,/g)).toHaveLength(1);
    expect(source).toContain('0009_recurrence_rules.sql');
  });
});
