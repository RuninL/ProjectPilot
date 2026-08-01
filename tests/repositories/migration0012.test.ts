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
  '0009_recurrence_rules.sql',
  '0010_recurrence_standalone_meetings.sql',
  '0011_recurrence_exceptions_reschedule.sql',
] as const;
const migration = readFileSync(join(migrationDir, '0012_v13_productivity.sql'), 'utf8');

function oldDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of previous) db.exec(readFileSync(join(migrationDir, file), 'utf8'));
  return db;
}

function seedOldData(db: BetterSqlite3.Database): void {
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    'p',
    '项目',
    NOW,
    NOW,
  );
  db.prepare(
    `INSERT INTO tasks
      (id, project_id, title, progress, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('t', 'p', '任务', 35, NOW, NOW);
  db.prepare(
    `INSERT INTO meetings
      (id, project_id, topic, date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('m', 'p', '会议', '2026-08-01', NOW, NOW);
  db.prepare(
    `INSERT INTO recurrence_rules
      (id, project_id, kind, title, byweekday, interval, start_date, end_date,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('rr', 'p', 'meeting', '周会', 6, 1, '2026-08-01', '2026-08-31', NOW, NOW);
  db.prepare(
    `INSERT INTO project_links
      (id, project_id, label, link_type, target, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('link', 'p', '资料', 'url', 'https://example.com', NOW, NOW);
}

describe('migration 0012', () => {
  it('upgrades release data without losing rows and normalizes existing task progress', () => {
    const db = oldDb();
    seedOldData(db);

    db.exec(migration);

    expect(db.prepare('SELECT id, progress FROM tasks').all()).toStrictEqual([
      { id: 't', progress: 35 },
    ]);
    expect(
      db
        .prepare(
          `SELECT task_id, title, contribution_percent
             FROM task_progress_updates`,
        )
        .all(),
    ).toStrictEqual([{ task_id: 't', title: '已有进度', contribution_percent: 35 }]);
    expect(db.prepare('SELECT id, meeting_url FROM meetings').all()).toStrictEqual([
      { id: 'm', meeting_url: null },
    ]);
    expect(db.prepare('SELECT id, meeting_url FROM recurrence_rules').all()).toStrictEqual([
      { id: 'rr', meeting_url: null },
    ]);
    expect(db.prepare('SELECT id, task_id FROM project_links').all()).toStrictEqual([
      { id: 'link', task_id: null },
    ]);
    db.close();
  });

  it('enforces HTTPS meeting links and safely clears task resource links', () => {
    const db = oldDb();
    seedOldData(db);
    db.exec(migration);

    expect(() =>
      db.prepare('UPDATE meetings SET meeting_url = ? WHERE id = ?').run('http://example.com', 'm'),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare('UPDATE recurrence_rules SET meeting_url = ? WHERE id = ?')
        .run('javascript:alert(1)', 'rr'),
    ).toThrow(/CHECK/);
    db.prepare('UPDATE meetings SET meeting_url = ? WHERE id = ?').run(
      'https://meet.example.com/room',
      'm',
    );
    db.prepare('UPDATE project_links SET task_id = ? WHERE id = ?').run('t', 'link');
    db.prepare('DELETE FROM tasks WHERE id = ?').run('t');
    expect(db.prepare('SELECT task_id FROM project_links WHERE id = ?').get('link')).toStrictEqual({
      task_id: null,
    });
    db.close();
  });

  it('validates named order contexts, JSON, names and one default per list', () => {
    const db = oldDb();
    db.exec(migration);
    const insert = db.prepare(
      `INSERT INTO named_list_orders
        (id, context, context_id, name, ordered_ids_json, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('o1', 'projects', '', '项目排序1', '["p1","p2"]', 1, NOW, NOW);
    expect(() =>
      insert.run('o2', 'unknown', '', '未知', '[]', 0, NOW, NOW),
    ).toThrow(/CHECK/);
    expect(() =>
      insert.run('o3', 'projects', '', '坏 JSON', '{"id":"p1"}', 0, NOW, NOW),
    ).toThrow(/CHECK/);
    expect(() =>
      insert.run('o4', 'projects', '', '项目排序1', '[]', 0, NOW, NOW),
    ).toThrow(/UNIQUE/);
    expect(() =>
      insert.run('o5', 'projects', '', '另一个默认', '[]', 1, NOW, NOW),
    ).toThrow(/UNIQUE/);
    db.close();
  });

  it('keeps task progress equal to contributions and rejects totals over 100', () => {
    const db = oldDb();
    seedOldData(db);
    db.exec(migration);
    const insert = db.prepare(
      `INSERT INTO task_progress_updates
        (id, task_id, title, occurred_at, contribution_percent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('u2', 't', '实现', '2026-08-02T10:00:00Z', 25, NOW, NOW);
    expect(db.prepare('SELECT progress FROM tasks WHERE id = ?').get('t')).toStrictEqual({
      progress: 60,
    });
    expect(() =>
      insert.run('too-much', 't', '过量', '2026-08-03T10:00:00Z', 41, NOW, NOW),
    ).toThrow(/TASK_PROGRESS_EXCEEDS_100/);
    db.prepare(
      'UPDATE task_progress_updates SET contribution_percent = ?, updated_at = ? WHERE id = ?',
    ).run(10, NOW, 'u2');
    expect(db.prepare('SELECT progress FROM tasks WHERE id = ?').get('t')).toStrictEqual({
      progress: 45,
    });
    db.prepare('DELETE FROM task_progress_updates WHERE id = ?').run('u2');
    expect(db.prepare('SELECT progress FROM tasks WHERE id = ?').get('t')).toStrictEqual({
      progress: 35,
    });
    db.close();
  });

  it('enforces checklist completion timestamps and task cascades', () => {
    const db = oldDb();
    seedOldData(db);
    db.exec(migration);
    const insert = db.prepare(
      `INSERT INTO task_checklist_items
        (id, task_id, content, is_completed, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    expect(() => insert.run('c0', 't', '待办', 1, null, NOW, NOW)).toThrow(/CHECK/);
    insert.run('c1', 't', '待办', 0, null, NOW, NOW);
    db.prepare('DELETE FROM tasks WHERE id = ?').run('t');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM task_checklist_items').get(),
    ).toStrictEqual({ count: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM task_progress_updates').get(),
    ).toStrictEqual({ count: 0 });
    db.close();
  });

  it('is registered once as version 12 in both Rust migration lists', () => {
    const migrations = readFileSync(join(process.cwd(), 'src-tauri/src/migrations.rs'), 'utf8');
    const repair = readFileSync(join(process.cwd(), 'src-tauri/src/migration_repair.rs'), 'utf8');
    expect(migrations.match(/version: 12,/g)).toHaveLength(1);
    expect(migrations).toContain('0012_v13_productivity.sql');
    expect(repair).toContain('CURRENT_MIGRATION_COUNT: i64 = 12');
    expect(repair).toContain('0012_v13_productivity.sql');
  });
});
