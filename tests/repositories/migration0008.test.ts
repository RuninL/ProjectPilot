import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW, createTestDb, type TestDb } from '../helpers/testDb';

const MIGRATION_DIR = join(process.cwd(), 'src-tauri/migrations');
const PREVIOUS_MIGRATIONS = [
  '0001_init.sql',
  '0002_task_lifecycle.sql',
  '0003_task_dependencies.sql',
  '0004_meetings_action_items.sql',
  '0005_dashboard_risks.sql',
  '0006_project_links_description.sql',
  '0007_people.sql',
] as const;

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

describe('migration 0008 schema', () => {
  it('registers version 8 and accepts only valid project and task statuses', () => {
    const source = readFileSync('src-tauri/src/migrations.rs', 'utf8');
    expect(source).toContain('version: 8');
    expect(source).toContain('0008_postponed_people_fields.sql');

    db.raw
      .prepare(
        "INSERT INTO projects (id, name, status, created_at, updated_at) VALUES ('p', '项目', 'postponed', ?, ?)",
      )
      .run(NOW, NOW);
    db.raw
      .prepare(
        "INSERT INTO tasks (id, project_id, title, status, created_at, updated_at) VALUES ('t', 'p', '任务', 'postponed', ?, ?)",
      )
      .run(NOW, NOW);

    expect(() =>
      db.raw
        .prepare(
          "INSERT INTO projects (id, name, status, created_at, updated_at) VALUES ('bad-p', '坏项目', 'invalid', ?, ?)",
        )
        .run(NOW, NOW),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.raw
        .prepare(
          "INSERT INTO tasks (id, project_id, title, status, created_at, updated_at) VALUES ('bad-t', 'p', '坏任务', 'invalid', ?, ?)",
        )
        .run(NOW, NOW),
    ).toThrow(/CHECK constraint failed/);
  });

  it('adds nullable people profile fields', () => {
    db.raw
      .prepare(
        `INSERT INTO people (id, name, email, role, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('person', '林然', 'lin@example.com', '产品经理', '离线办公', NOW, NOW);

    expect(
      db.raw.prepare('SELECT name, email, role, note FROM people WHERE id = ?').get('person'),
    ).toStrictEqual({
      name: '林然',
      email: 'lin@example.com',
      role: '产品经理',
      note: '离线办公',
    });
  });
});

describe('migration 0008 upgrade', () => {
  it('preserves old business rows, indexes, triggers, and relationships', () => {
    const raw = new BetterSqlite3(':memory:');
    raw.pragma('foreign_keys = ON');
    for (const file of PREVIOUS_MIGRATIONS) {
      raw.exec(readFileSync(join(MIGRATION_DIR, file), 'utf8'));
    }

    raw
      .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('project', '旧项目', NOW, NOW);
    raw
      .prepare(
        `INSERT INTO tasks
          (id, project_id, title, description, progress, source_meeting_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('task', 'project', '旧任务', '保留描述', 42, null, NOW, NOW);
    raw
      .prepare(
        `INSERT INTO meetings (id, project_id, topic, date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('meeting', 'project', '旧会议', '2026-07-01', NOW, NOW);
    raw.prepare('UPDATE tasks SET source_meeting_id = ? WHERE id = ?').run('meeting', 'task');
    raw
      .prepare(
        `INSERT INTO tasks
          (id, project_id, parent_task_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('child-task', 'project', 'task', '旧子任务', NOW, NOW);
    raw
      .prepare(
        `INSERT INTO task_dependencies
          (id, predecessor_id, successor_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('dependency', 'task', 'child-task', NOW, NOW);
    raw
      .prepare(
        `INSERT INTO milestones
          (id, project_id, linked_task_id, name, date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('milestone', 'project', 'child-task', '旧里程碑', '2026-08-01', NOW, NOW);
    raw
      .prepare(
        `INSERT INTO action_items
          (id, meeting_id, content, converted_task_id, converted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('action', 'meeting', '旧行动项', 'child-task', NOW, NOW, NOW);
    raw
      .prepare(
        `INSERT INTO project_links
          (id, project_id, label, link_type, target, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('link', 'project', '旧资料', 'url', 'https://example.com', NOW, NOW);
    raw
      .prepare(
        `INSERT INTO risks
          (id, project_id, title, likelihood, impact, level, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('risk', 'project', '旧风险', 'low', 'low', 'low', NOW, NOW);
    raw
      .prepare('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('person', '旧人员', NOW, NOW);
    raw
      .prepare(
        'INSERT INTO project_participants (project_id, person_id, role, joined_at) VALUES (?, ?, ?, ?)',
      )
      .run('project', 'person', '负责人', NOW);
    raw
      .prepare('INSERT INTO task_participants (task_id, person_id, assigned_at) VALUES (?, ?, ?)')
      .run('task', 'person', NOW);

    const before = {
      projects: raw.prepare('SELECT COUNT(*) AS count FROM projects').get(),
      tasks: raw.prepare('SELECT COUNT(*) AS count FROM tasks').get(),
      dependencies: raw.prepare('SELECT COUNT(*) AS count FROM task_dependencies').get(),
      milestones: raw.prepare('SELECT COUNT(*) AS count FROM milestones').get(),
      meetings: raw.prepare('SELECT COUNT(*) AS count FROM meetings').get(),
      actions: raw.prepare('SELECT COUNT(*) AS count FROM action_items').get(),
      links: raw.prepare('SELECT COUNT(*) AS count FROM project_links').get(),
      risks: raw.prepare('SELECT COUNT(*) AS count FROM risks').get(),
      people: raw.prepare('SELECT COUNT(*) AS count FROM people').get(),
      projectParticipants: raw.prepare('SELECT COUNT(*) AS count FROM project_participants').get(),
      taskParticipants: raw.prepare('SELECT COUNT(*) AS count FROM task_participants').get(),
    };

    raw.transaction(() => {
      raw.exec(readFileSync(join(MIGRATION_DIR, '0008_postponed_people_fields.sql'), 'utf8'));
    })();

    const after = {
      projects: raw.prepare('SELECT COUNT(*) AS count FROM projects').get(),
      tasks: raw.prepare('SELECT COUNT(*) AS count FROM tasks').get(),
      dependencies: raw.prepare('SELECT COUNT(*) AS count FROM task_dependencies').get(),
      milestones: raw.prepare('SELECT COUNT(*) AS count FROM milestones').get(),
      meetings: raw.prepare('SELECT COUNT(*) AS count FROM meetings').get(),
      actions: raw.prepare('SELECT COUNT(*) AS count FROM action_items').get(),
      links: raw.prepare('SELECT COUNT(*) AS count FROM project_links').get(),
      risks: raw.prepare('SELECT COUNT(*) AS count FROM risks').get(),
      people: raw.prepare('SELECT COUNT(*) AS count FROM people').get(),
      projectParticipants: raw.prepare('SELECT COUNT(*) AS count FROM project_participants').get(),
      taskParticipants: raw.prepare('SELECT COUNT(*) AS count FROM task_participants').get(),
    };
    expect(after).toStrictEqual(before);
    expect(
      raw
        .prepare(
          `SELECT t.parent_task_id, t.source_meeting_id, d.predecessor_id,
                  m.linked_task_id, a.converted_task_id
             FROM tasks t
             JOIN task_dependencies d ON d.successor_id = t.id
             JOIN milestones m ON m.linked_task_id = t.id
             JOIN action_items a ON a.converted_task_id = t.id
            WHERE t.id = ?`,
        )
        .get('child-task'),
    ).toStrictEqual({
      parent_task_id: 'task',
      source_meeting_id: null,
      predecessor_id: 'task',
      linked_task_id: 'child-task',
      converted_task_id: 'child-task',
    });
    expect(
      raw.prepare('SELECT source_meeting_id FROM tasks WHERE id = ?').get('task'),
    ).toStrictEqual({
      source_meeting_id: 'meeting',
    });
    expect(
      raw
        .prepare(
          `SELECT p.name, t.title, t.description, t.progress, pp.role
             FROM projects p
             JOIN tasks t ON t.project_id = p.id
             JOIN project_participants pp ON pp.project_id = p.id
            WHERE p.id = ?`,
        )
        .get('project'),
    ).toStrictEqual({
      name: '旧项目',
      title: '旧任务',
      description: '保留描述',
      progress: 42,
      role: '负责人',
    });

    const indexes = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('projects', 'tasks') AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toEqual([
      'idx_projects_archived',
      'idx_projects_status',
      'idx_tasks_archived',
      'idx_tasks_dashboard',
      'idx_tasks_due_status',
      'idx_tasks_parent',
      'idx_tasks_project_due',
      'idx_tasks_project_status',
    ]);

    const triggers = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'tasks' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(triggers).toEqual([
      'trg_tasks_max_two_levels_insert',
      'trg_tasks_max_two_levels_update',
      'trg_tasks_no_parent_if_has_children',
      'trg_tasks_no_self_parent_insert',
      'trg_tasks_no_self_parent_update',
      'trg_tasks_same_project_parent_insert',
      'trg_tasks_same_project_parent_update',
    ]);
    const dependencyTriggers = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'task_dependencies' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(dependencyTriggers).toEqual([
      'trg_deps_no_reverse_insert',
      'trg_deps_no_reverse_update',
      'trg_deps_same_project_insert',
      'trg_deps_same_project_update',
    ]);
    expect(raw.pragma('foreign_key_check')).toEqual([]);
    expect(raw.pragma('foreign_keys', { simple: true })).toBe(1);
    raw.close();
  });
});
