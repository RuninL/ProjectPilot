import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOW, createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

function insertProject(id: string): void {
  db.raw
    .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, `项目 ${id}`, NOW, NOW);
}

function insertTask(id: string, projectId: string): void {
  db.raw
    .prepare(
      'INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, projectId, `任务 ${id}`, NOW, NOW);
}

function insertPerson(id: string): void {
  db.raw
    .prepare('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, `人员 ${id}`, NOW, NOW);
}

function count(table: 'people' | 'project_participants' | 'task_participants'): number {
  return (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('migration 0007 schema', () => {
  it('creates all three tables and registers version 7', () => {
    const tables = db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('people', 'project_participants', 'task_participants') ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual(['people', 'project_participants', 'task_participants']);
    const source = readFileSync('src-tauri/src/migrations.rs', 'utf8');
    expect(source).toContain('version: 7');
    expect(source).toContain('0007_people.sql');
  });

  it('indexes each project, task, and person lookup direction', () => {
    const indexes = db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%participants_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(indexes).toEqual([
      'idx_project_participants_person',
      'idx_project_participants_project',
      'idx_task_participants_person',
      'idx_task_participants_task',
    ]);
  });

  it('rejects blank or overlong names at the database boundary', () => {
    expect(() =>
      db.raw
        .prepare('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run('blank', '   ', NOW, NOW),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.raw
        .prepare('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run('long', 'x'.repeat(121), NOW, NOW),
    ).toThrow(/CHECK constraint failed/);
  });

  it('prevents duplicate project and task relationships', () => {
    insertProject('p1');
    insertTask('t1', 'p1');
    insertPerson('person-1');
    const projectInsert = db.raw.prepare(
      'INSERT INTO project_participants (project_id, person_id, joined_at) VALUES (?, ?, ?)',
    );
    const taskInsert = db.raw.prepare(
      'INSERT INTO task_participants (task_id, person_id, assigned_at) VALUES (?, ?, ?)',
    );

    projectInsert.run('p1', 'person-1', NOW);
    taskInsert.run('t1', 'person-1', NOW);

    expect(() => projectInsert.run('p1', 'person-1', NOW)).toThrow(/UNIQUE constraint failed/);
    expect(() => taskInsert.run('t1', 'person-1', NOW)).toThrow(/UNIQUE constraint failed/);
  });
});

describe('migration 0007 independent relationships and cascades', () => {
  beforeEach(() => {
    insertProject('p1');
    insertProject('p2');
    insertTask('t1', 'p1');
    insertTask('t2', 'p2');
    insertPerson('person-1');
    insertPerson('person-2');
  });

  it('does not infer project participation from task participation', () => {
    db.raw
      .prepare('INSERT INTO task_participants (task_id, person_id, assigned_at) VALUES (?, ?, ?)')
      .run('t1', 'person-1', NOW);

    expect(count('task_participants')).toBe(1);
    expect(count('project_participants')).toBe(0);
  });

  it('deleting a task removes only its task relationships', () => {
    db.raw
      .prepare(
        'INSERT INTO project_participants (project_id, person_id, role, joined_at) VALUES (?, ?, ?, ?)',
      )
      .run('p1', 'person-1', '开发', NOW);
    db.raw
      .prepare('INSERT INTO task_participants (task_id, person_id, assigned_at) VALUES (?, ?, ?)')
      .run('t1', 'person-1', NOW);

    db.raw.prepare('DELETE FROM tasks WHERE id = ?').run('t1');

    expect(count('task_participants')).toBe(0);
    expect(count('project_participants')).toBe(1);
    expect(count('people')).toBe(2);
  });

  it('deleting a project removes its links and task links without deleting people', () => {
    const addProject = db.raw.prepare(
      'INSERT INTO project_participants (project_id, person_id, joined_at) VALUES (?, ?, ?)',
    );
    const addTask = db.raw.prepare(
      'INSERT INTO task_participants (task_id, person_id, assigned_at) VALUES (?, ?, ?)',
    );
    addProject.run('p1', 'person-1', NOW);
    addProject.run('p2', 'person-2', NOW);
    addTask.run('t1', 'person-1', NOW);
    addTask.run('t2', 'person-2', NOW);

    db.raw.prepare('DELETE FROM projects WHERE id = ?').run('p1');

    expect(count('people')).toBe(2);
    expect(count('project_participants')).toBe(1);
    expect(count('task_participants')).toBe(1);
    expect(
      db.raw.prepare('SELECT person_id FROM project_participants').get(),
    ).toStrictEqual({ person_id: 'person-2' });
  });

  it('deleting a person removes both kinds of links without deleting core entities', () => {
    db.raw
      .prepare(
        'INSERT INTO project_participants (project_id, person_id, joined_at) VALUES (?, ?, ?)',
      )
      .run('p1', 'person-1', NOW);
    db.raw
      .prepare('INSERT INTO task_participants (task_id, person_id, assigned_at) VALUES (?, ?, ?)')
      .run('t1', 'person-1', NOW);

    db.raw.prepare('DELETE FROM people WHERE id = ?').run('person-1');

    expect(count('project_participants')).toBe(0);
    expect(count('task_participants')).toBe(0);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM projects').get()).toStrictEqual({ n: 2 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toStrictEqual({ n: 2 });
  });
});

describe('migration 0007 upgrade', () => {
  it('applies to an existing version-6 database without changing old data', () => {
    const raw = new BetterSqlite3(':memory:');
    raw.pragma('foreign_keys = ON');
    const migrationDir = join(process.cwd(), 'src-tauri/migrations');
    for (const file of [
      '0001_init.sql',
      '0002_task_lifecycle.sql',
      '0003_task_dependencies.sql',
      '0004_meetings_action_items.sql',
      '0005_dashboard_risks.sql',
      '0006_project_links_description.sql',
    ]) {
      raw.exec(readFileSync(join(migrationDir, file), 'utf8'));
    }
    raw
      .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('legacy-project', '旧项目', NOW, NOW);
    raw
      .prepare(
        'INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('legacy-task', 'legacy-project', '旧任务', NOW, NOW);

    raw.exec(readFileSync(join(migrationDir, '0007_people.sql'), 'utf8'));

    expect(raw.prepare('SELECT name FROM projects WHERE id = ?').get('legacy-project')).toStrictEqual(
      { name: '旧项目' },
    );
    expect(raw.prepare('SELECT title FROM tasks WHERE id = ?').get('legacy-task')).toStrictEqual({
      title: '旧任务',
    });
    expect(
      raw
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'people'")
        .get(),
    ).toStrictEqual({ n: 1 });
    raw.close();
  });
});
