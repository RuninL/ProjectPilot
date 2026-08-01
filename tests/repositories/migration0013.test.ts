import { createHash } from 'node:crypto';
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
  '0012_v13_productivity.sql',
] as const;
const migrationPath = join(migrationDir, '0013_relax_meeting_urls.sql');
const migration = readFileSync(migrationPath, 'utf8');
const migration0012Hash = '791970d2fb4e3a652db6c85195bd039993709344e59482d6caf43212744a493b';

function dbAt0012(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of previous) {
    db.transaction(() => {
      db.exec(readFileSync(join(migrationDir, file), 'utf8'));
    })();
  }
  return db;
}

function seed(db: BetterSqlite3.Database): void {
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    'p',
    '项目',
    NOW,
    NOW,
  );
  db.prepare(
    `INSERT INTO meetings
      (id, project_id, topic, date, attendees, agenda, notes, decisions, risks, start_time,
       source_rule_id, source_occurrence_date, meeting_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'm',
    'p',
    '会议',
    '2026-08-01',
    '["甲"]',
    '议程',
    '纪要',
    '决议',
    '风险',
    '09:30',
    null,
    null,
    'https://meet.example.com/original',
    NOW,
    NOW,
  );
  db.prepare(
    `INSERT INTO tasks
      (id, project_id, title, source_meeting_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('t', 'p', '任务', 'm', NOW, NOW);
  db.prepare(
    `INSERT INTO action_items
      (id, meeting_id, content, owner, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('a', 'm', '行动项', '甲', NOW, NOW);
  db.prepare(
    `INSERT INTO recurrence_rules
      (id, project_id, kind, title, byweekday, interval, start_date, end_date, time_of_day,
       duration_minutes, note, meeting_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'rr',
    'p',
    'meeting',
    '周会',
    6,
    1,
    '2026-08-01',
    '2026-08-31',
    '10:00',
    45,
    '说明',
    'https://series.example.com/original',
    NOW,
    NOW,
  );
  db.prepare(
    `INSERT INTO recurrence_exceptions
      (id, rule_id, occurrence_date, action, replacement_date, materialized_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('ex', 'rr', '2026-08-08', 'rescheduled', '2026-08-09', null, NOW, NOW);
}

describe('migration 0013', () => {
  it('preserves meeting and recurrence data, relationships, indexes and triggers', () => {
    const db = dbAt0012();
    seed(db);
    const before = {
      meetings: db.prepare('SELECT * FROM meetings ORDER BY id').all(),
      tasks: db.prepare('SELECT * FROM tasks ORDER BY id').all(),
      actionItems: db.prepare('SELECT * FROM action_items ORDER BY id').all(),
      rules: db.prepare('SELECT * FROM recurrence_rules ORDER BY id').all(),
      exceptions: db.prepare('SELECT * FROM recurrence_exceptions ORDER BY id').all(),
    };

    db.transaction(() => {
      db.exec(migration);
    })();

    expect(db.prepare('SELECT * FROM meetings ORDER BY id').all()).toStrictEqual(before.meetings);
    expect(db.prepare('SELECT * FROM tasks ORDER BY id').all()).toStrictEqual(before.tasks);
    expect(db.prepare('SELECT * FROM action_items ORDER BY id').all()).toStrictEqual(
      before.actionItems,
    );
    expect(db.prepare('SELECT * FROM recurrence_rules ORDER BY id').all()).toStrictEqual(
      before.rules,
    );
    expect(db.prepare('SELECT * FROM recurrence_exceptions ORDER BY id').all()).toStrictEqual(
      before.exceptions,
    );
    expect(db.pragma('foreign_key_check')).toStrictEqual([]);
    expect(db.pragma('integrity_check')).toStrictEqual([{ integrity_check: 'ok' }]);
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index'
             AND name IN (
               'idx_meetings_project_date',
               'idx_meetings_date',
               'idx_meetings_source_rule_id',
               'idx_recurrence_rules_project',
               'idx_recurrence_rules_active'
             )
           ORDER BY name`,
        )
        .pluck()
        .all(),
    ).toHaveLength(5);
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'trigger' AND name LIKE 'trg_meetings_start_time_%'`,
        )
        .pluck()
        .all(),
    ).toHaveLength(2);
    expect(() =>
      db.prepare('UPDATE meetings SET start_time = ? WHERE id = ?').run('29:00', 'm'),
    ).toThrow(/INVALID_MEETING_TIME/);
    db.close();
  });

  it.each([
    'http://example.com',
    'https://example.com',
    'www.example.com/path',
    'example.com/path',
    'localhost:3000',
    '127.0.0.1:5173',
    '192.168.1.20:8080/dashboard',
  ])('allows original meeting URL text after upgrade: %s', (url) => {
    const db = dbAt0012();
    seed(db);
    db.transaction(() => {
      db.exec(migration);
    })();

    db.prepare('UPDATE meetings SET meeting_url = ? WHERE id = ?').run(url, 'm');
    db.prepare('UPDATE recurrence_rules SET meeting_url = ? WHERE id = ?').run(url, 'rr');
    expect(db.prepare('SELECT meeting_url FROM meetings WHERE id = ?').pluck().get('m')).toBe(url);
    expect(
      db.prepare('SELECT meeting_url FROM recurrence_rules WHERE id = ?').pluck().get('rr'),
    ).toBe(url);
    db.close();
  });

  it('rolls back the whole rebuild if a later migration statement fails', () => {
    const db = dbAt0012();
    seed(db);
    const failingMigration = migration.replace(
      'DROP TABLE migration_0013_guard;',
      'INSERT INTO migration_0013_guard (result) VALUES (1);',
    );

    expect(() =>
      db.transaction(() => {
        db.exec(failingMigration);
      })(),
    ).toThrow(/CHECK/);
    expect(db.prepare('SELECT meeting_url FROM meetings WHERE id = ?').pluck().get('m')).toBe(
      'https://meet.example.com/original',
    );
    expect(
      db.prepare('SELECT meeting_url FROM recurrence_rules WHERE id = ?').pluck().get('rr'),
    ).toBe('https://series.example.com/original');
    expect(
      db
        .prepare(
          `SELECT COUNT(*) FROM sqlite_master
           WHERE name LIKE 'migration_0013_%' OR name LIKE '%_next'`,
        )
        .pluck()
        .get(),
    ).toBe(0);
    expect(db.pragma('foreign_key_check')).toStrictEqual([]);
    db.close();
  });

  it('keeps 0012 byte-identical and registers 0013 once', () => {
    const migration0012 = readFileSync(join(migrationDir, '0012_v13_productivity.sql'));
    expect(createHash('sha256').update(migration0012).digest('hex')).toBe(migration0012Hash);
    const registrations = readFileSync(join(process.cwd(), 'src-tauri/src/migrations.rs'), 'utf8');
    expect(registrations.match(/version: 13,/g)).toHaveLength(1);
    expect(registrations).toContain('0013_relax_meeting_urls.sql');
  });
});
