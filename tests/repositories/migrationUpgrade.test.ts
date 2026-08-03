import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import BetterSqlite3, { type Database } from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

const migrationDirectory = join(process.cwd(), 'src-tauri/migrations');
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();
const openDatabases: Database[] = [];

function checksum(sql: string): Buffer {
  return createHash('sha384').update(sql).digest();
}

function canonicalSql(version: number): string {
  return readFileSync(join(migrationDirectory, migrationFiles[version - 1]), 'utf8');
}

function v12Sql(version: number): string {
  return canonicalSql(version).replaceAll('\n', '\r\n');
}

function createDatabase(): Database {
  const database = new BetterSqlite3(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE _sqlx_migrations (
      version BIGINT PRIMARY KEY,
      description TEXT NOT NULL,
      installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      success BOOLEAN NOT NULL,
      checksum BLOB NOT NULL,
      execution_time BIGINT NOT NULL
    )
  `);
  openDatabases.push(database);
  return database;
}

function usesV12Lineage(database: Database): boolean {
  const row = database
    .prepare('SELECT checksum FROM _sqlx_migrations WHERE version = 1 AND success = 1')
    .get() as { checksum: Buffer } | undefined;
  return row?.checksum.equals(checksum(v12Sql(1))) ?? false;
}

function migrate(database: Database, through = migrationFiles.length): void {
  const v12Lineage = usesV12Lineage(database);
  for (let version = 1; version <= through; version += 1) {
    const sql = v12Lineage && version <= 11 ? v12Sql(version) : canonicalSql(version);
    const expectedChecksum = checksum(sql);
    const applied = database
      .prepare('SELECT checksum FROM _sqlx_migrations WHERE version = ?')
      .get(version) as { checksum: Buffer } | undefined;
    if (applied) {
      if (!applied.checksum.equals(expectedChecksum)) {
        throw new Error(
          `migration ${String(version)} was previously applied but has been modified`,
        );
      }
      continue;
    }
    database.transaction(() => {
      database.exec(sql);
      database
        .prepare(
          `INSERT INTO _sqlx_migrations
             (version, description, success, checksum, execution_time)
           VALUES (?, ?, 1, ?, 0)`,
        )
        .run(version, migrationFiles[version - 1], expectedChecksum);
    })();
  }
}

function seedV1Data(database: Database): void {
  const now = '2026-07-29T00:00:00Z';
  database.exec(`
    INSERT INTO projects
      (id, name, description, status, color, start_date, target_end_date,
       archived_at, is_sample, created_at, updated_at)
    VALUES
      ('project-main', '第一版项目', '保留换行
与中文', 'active', '#2563EB', '2026-07-01', '2026-12-31',
       NULL, 0, '${now}', '${now}'),
      ('project-nullable', '边界项目', '', 'completed', '#abcdef', NULL, NULL,
       NULL, 0, '${now}', '${now}');

    INSERT INTO tasks
      (id, project_id, parent_task_id, title, description, status, priority,
       start_date, due_date, progress, estimated_hours, actual_hours, is_sample,
       created_at, updated_at, completed_at, archived_at, source_meeting_id)
    VALUES
      ('task-parent', 'project-main', NULL, '跨天父任务', '', 'in_progress', 'high',
       '2026-07-01', '2026-07-10', 40, 8.5, NULL, 0, '${now}', '${now}',
       NULL, NULL, NULL),
      ('task-child', 'project-main', 'task-parent', '已完成子任务', '', 'done', 'medium',
       '2026-07-02', '2026-07-03', 100, NULL, 2, 0, '${now}', '${now}',
       '${now}', NULL, NULL),
      ('task-open', 'project-nullable', NULL, '无日期任务', '', 'todo', 'low',
       NULL, NULL, 0, NULL, NULL, 0, '${now}', '${now}', NULL, NULL, NULL);

    INSERT INTO meetings
      (id, project_id, topic, date, attendees, agenda, notes, decisions, risks,
       is_sample, created_at, updated_at, start_time)
    VALUES
      ('meeting-v1', 'project-main', '第一版会议', '2026-07-05', '["甲","乙"]',
       '议程', '纪要', '决定', '', 0, '${now}', '${now}', '09:30');

    INSERT INTO milestones
      (id, project_id, linked_task_id, name, description, date, status,
       achieved_at, is_sample, created_at, updated_at)
    VALUES
      ('milestone-v1', 'project-main', 'task-child', '第一版里程碑', '',
       '2026-07-03', 'achieved', '${now}', 0, '${now}', '${now}');

    INSERT INTO action_items
      (id, meeting_id, content, owner, due_date, status, converted_task_id,
       converted_at, created_at, updated_at)
    VALUES
      ('action-v1', 'meeting-v1', '跟进行动', '', NULL, 'open', NULL, NULL,
       '${now}', '${now}');

    INSERT INTO project_links
      (id, project_id, label, link_type, target, is_sample, created_at, updated_at,
       description)
    VALUES
      ('link-v1', 'project-main', '本地资料', 'file_path', 'C:\\\\ProjectPilot',
       0, '${now}', '${now}', '');

    INSERT INTO risks
      (id, project_id, title, description, category, likelihood, impact, level,
       status, owner, mitigation_plan, due_date, resolved_at, is_sample,
       created_at, updated_at)
    VALUES
      ('risk-v1', 'project-main', '进度风险', '', 'schedule', 'high', 'medium',
       'high', 'open', '', '', NULL, NULL, 0, '${now}', '${now}');

    INSERT INTO app_settings (key, value, created_at, updated_at)
    VALUES ('fixture.setting', '{"unicode":"边界","nullable":null}', '${now}', '${now}');
  `);
}

function seedV12Data(database: Database): void {
  const now = '2026-07-31T00:00:00Z';
  database.exec(`
    INSERT INTO people (id, name, email, role, note, created_at, updated_at)
    VALUES ('person-task', '任务参与人', NULL, NULL, NULL, '${now}', '${now}');
    INSERT INTO task_participants (task_id, person_id, assigned_at)
    VALUES ('task-parent', 'person-task', '${now}');

    INSERT INTO recurrence_rules
      (id, project_id, kind, title, byweekday, interval, start_date, end_date,
       time_of_day, duration_minutes, default_priority, note, is_active,
       is_sample, created_at, updated_at)
    VALUES
      ('rule-meeting', 'project-main', 'meeting', '每周会议', 3, 1,
       '2026-07-02', NULL, '10:00', 60, NULL, '', 1, 0, '${now}', '${now}');

    INSERT INTO meetings
      (id, project_id, topic, date, attendees, agenda, notes, decisions, risks,
       is_sample, created_at, updated_at, start_time, source_rule_id,
       source_occurrence_date)
    VALUES
      ('meeting-recurring', 'project-main', '重复会议实例', '2026-08-06', '[]',
       '', '', '', '', 0, '${now}', '${now}', '10:00', 'rule-meeting',
       '2026-08-06');

    INSERT INTO recurrence_exceptions
      (id, rule_id, occurrence_date, action, replacement_date, materialized_id,
       created_at, updated_at)
    VALUES
      ('exception-reschedule', 'rule-meeting', '2026-08-13', 'rescheduled',
       '2026-08-14', NULL, '${now}', '${now}');
  `);
}

function schemaSnapshot(database: Database): unknown[] {
  return database
    .prepare(
      `SELECT type, name, tbl_name,
              trim(replace(replace(replace(sql, char(13), ' '), char(10), ' '), char(9), ' ')) AS sql
       FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' AND name <> '_sqlx_migrations'
       ORDER BY type, name`,
    )
    .all()
    .map((row) => {
      const value = row as { sql: string | null };
      return { ...value, sql: value.sql?.replace(/\s+/g, ' ') ?? null };
    });
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

describe('released database migration upgrades', () => {
  it('upgrades v1.00 directly and preserves representative data', () => {
    const database = createDatabase();
    migrate(database, 6);
    seedV1Data(database);

    migrate(database);

    expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.prepare('SELECT count(*) AS count FROM projects').get()).toEqual({
      count: 2,
    });
    expect(database.prepare('SELECT count(*) AS count FROM tasks').get()).toEqual({
      count: 3,
    });
    expect(
      database.prepare('SELECT parent_task_id FROM tasks WHERE id = ?').get('task-child'),
    ).toEqual({ parent_task_id: 'task-parent' });
    expect(
      database.prepare('SELECT value FROM app_settings WHERE key = ?').get('fixture.setting'),
    ).toEqual({ value: '{"unicode":"边界","nullable":null}' });
    expect(
      database
        .prepare('SELECT contribution_percent FROM task_progress_updates WHERE task_id = ?')
        .get('task-parent'),
    ).toEqual({ contribution_percent: 40 });
  });

  it('upgrades v1.00 through v1.2.0 and then to latest', () => {
    const database = createDatabase();
    migrate(database, 6);
    seedV1Data(database);
    migrate(database, 11);
    seedV12Data(database);

    migrate(database);

    expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.prepare('SELECT count(*) AS count FROM recurrence_rules').get()).toEqual({
      count: 1,
    });
    expect(database.prepare('SELECT count(*) AS count FROM task_participants').get()).toEqual({
      count: 1,
    });
    expect(database.prepare('SELECT count(*) AS count FROM project_participants').get()).toEqual({
      count: 0,
    });
  });

  it('upgrades the official v1.2.0 CRLF lineage without changing checksums', () => {
    const database = createDatabase();
    const original = canonicalSql;
    for (let version = 1; version <= 11; version += 1) {
      const sql = v12Sql(version);
      database.transaction(() => {
        database.exec(sql);
        database
          .prepare(
            `INSERT INTO _sqlx_migrations
               (version, description, success, checksum, execution_time)
             VALUES (?, ?, 1, ?, 0)`,
          )
          .run(version, migrationFiles[version - 1], checksum(sql));
      })();
    }
    seedV1Data(database);
    seedV12Data(database);
    const before = database
      .prepare('SELECT checksum FROM _sqlx_migrations WHERE version = 1')
      .get() as { checksum: Buffer };

    migrate(database);

    const after = database
      .prepare('SELECT checksum FROM _sqlx_migrations WHERE version = 1')
      .get() as { checksum: Buffer };
    expect(after.checksum).toEqual(before.checksum);
    expect(after.checksum).toEqual(checksum(v12Sql(1)));
    expect(original(1)).not.toContain('\r');
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('produces the same latest schema from upgrades and clean installs', () => {
    const upgraded = createDatabase();
    migrate(upgraded, 6);
    seedV1Data(upgraded);
    migrate(upgraded);
    const fresh = createDatabase();
    migrate(fresh);

    expect(schemaSnapshot(upgraded)).toEqual(schemaSnapshot(fresh));
    expect(
      upgraded.prepare('SELECT version FROM _sqlx_migrations ORDER BY version').pluck().all(),
    ).toEqual(fresh.prepare('SELECT version FROM _sqlx_migrations ORDER BY version').pluck().all());
  });

  it('is idempotent at latest and leaves no success row on migration failure', () => {
    const database = createDatabase();
    migrate(database);
    const before = database
      .prepare('SELECT version, checksum FROM _sqlx_migrations ORDER BY version')
      .all();
    migrate(database);
    expect(
      database.prepare('SELECT version, checksum FROM _sqlx_migrations ORDER BY version').all(),
    ).toEqual(before);

    expect(() => {
      database.transaction(() => {
        database.exec('CREATE TABLE should_rollback (id TEXT); INVALID SQL;');
        database
          .prepare(
            `INSERT INTO _sqlx_migrations
               (version, description, success, checksum, execution_time)
             VALUES (17, 'failing fixture', 1, ?, 0)`,
          )
          .run(checksum('failing fixture'));
      })();
    }).toThrow();
    expect(
      database
        .prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'should_rollback'")
        .get(),
    ).toEqual({ count: 0 });
    expect(database.prepare('SELECT count(*) AS count FROM _sqlx_migrations').get()).toEqual({
      count: migrationFiles.length,
    });
  });
});
