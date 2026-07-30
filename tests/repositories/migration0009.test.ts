import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { NOW } from '../helpers/testDb';

const migrationDir = join(process.cwd(), 'src-tauri/migrations');
const previous = Array.from({ length: 8 }, (_, index) =>
  `${String(index + 1).padStart(4, '0')}_${[
    'init',
    'task_lifecycle',
    'task_dependencies',
    'meetings_action_items',
    'dashboard_risks',
    'project_links_description',
    'people',
    'postponed_people_fields',
  ][index]}.sql`,
);

describe('migration 0009', () => {
  it('upgrades a populated database without rebuilding existing tables', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    for (const file of previous) db.exec(readFileSync(join(migrationDir, file), 'utf8'));
    db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', '项目', NOW, NOW);
    db.prepare('INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('t', 'p', '原任务', NOW, NOW);
    const taskSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as { sql: string }).sql;
    db.exec(readFileSync(join(migrationDir, '0009_recurrence_rules.sql'), 'utf8'));

    expect(db.prepare('SELECT title FROM tasks WHERE id = ?').get('t')).toStrictEqual({ title: '原任务' });
    expect((db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as { sql: string }).sql).toContain(taskSql);
    expect(db.prepare('PRAGMA table_info(tasks)').all().map((row) => (row as { name: string }).name)).toContain('source_rule_id');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_source_rule_id'").get()).toBeTruthy();
    db.close();
  });
});
