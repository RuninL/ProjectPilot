import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAppSettingRepository,
  createProjectRepository,
  createSampleDataRepository,
  createTaskRepository,
} from '@/repositories';
import {
  createSampleDataService,
  SAMPLE_SEEDED_KEY,
  type SampleDataService,
} from '@/services/sampleData.service';
import { makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;
let service: SampleDataService;

beforeEach(() => {
  db = createTestDb();
  service = createSampleDataService({
    projects: createProjectRepository(db.executor),
    tasks: createTaskRepository(db.executor),
    appSettings: createAppSettingRepository(db.executor),
    sample: createSampleDataRepository(db.executor),
    // Stands in for the Rust `execute_batch` command: one transaction, all-or-nothing.
    runBatch: (statements) => Promise.resolve(db.runBatch(statements)),
  });
});

afterEach(() => {
  db.close();
});

function countRows(table: string, where = '1 = 1'): number {
  const row = db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get();
  return (row as { n: number }).n;
}

async function insertUserProject(id: string): Promise<void> {
  await createProjectRepository(db.executor).insert(makeProject({ id, name: '用户项目' }));
}

async function insertUserTask(id: string, projectId: string): Promise<void> {
  await createTaskRepository(db.executor).insert(
    makeTask({ id, project_id: projectId, title: '用户任务' }),
  );
}

function insertRecurrenceRule(id: string, projectId: string, isSample: 0 | 1): void {
  db.raw
    .prepare(
      `INSERT INTO recurrence_rules
      (id, project_id, kind, title, byweekday, interval, start_date, end_date, time_of_day,
       duration_minutes, default_priority, note, is_active, is_sample, created_at, updated_at)
      VALUES (?, ?, 'task', '周期任务', 1, 1, '2026-07-01', NULL, NULL, NULL, 'medium', '', 1, ?, ?, ?)`,
    )
    .run(id, projectId, isSample, '2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z');
}

describe('seedSampleData', () => {
  it('creates one sample project with sample tasks, all flagged is_sample = 1', async () => {
    expect(await service.seedSampleData()).toBe(true);

    expect(countRows('projects', 'is_sample = 1')).toBe(1);
    expect(countRows('projects', 'is_sample = 0')).toBe(0);
    expect(countRows('tasks', 'is_sample = 1')).toBeGreaterThan(0);
    expect(countRows('tasks', 'is_sample = 0')).toBe(0);

    const project = await service.findSampleProject();
    expect(project?.name).toContain('示例');
  });

  it('records the seeded flag in app_settings', async () => {
    await service.seedSampleData();
    const flag = await createAppSettingRepository(db.executor).get(SAMPLE_SEEDED_KEY);
    expect(flag?.value).toBe('1');
  });

  it('is idempotent — a second call seeds nothing', async () => {
    await service.seedSampleData();
    const projectsAfterFirst = countRows('projects');
    const tasksAfterFirst = countRows('tasks');

    expect(await service.seedSampleData()).toBe(false);
    expect(countRows('projects')).toBe(projectsAfterFirst);
    expect(countRows('tasks')).toBe(tasksAfterFirst);
  });

  it('does not re-seed after the sample data was cleared', async () => {
    await service.seedSampleData();
    await service.clearSampleData();

    expect(await service.seedSampleData()).toBe(false);
    expect(countRows('projects')).toBe(0);
  });

  it('can mark a migration-recovery database as intentionally empty', async () => {
    expect(await service.skipSampleData()).toBe(true);

    expect(await service.hasSeeded()).toBe(true);
    expect(await service.seedSampleData()).toBe(false);
    expect(countRows('projects')).toBe(0);
    expect(countRows('tasks')).toBe(0);
  });

  it('seeds atomically — a failing batch leaves no partial rows', async () => {
    const failing = createSampleDataService({
      projects: createProjectRepository(db.executor),
      tasks: createTaskRepository(db.executor),
      appSettings: createAppSettingRepository(db.executor),
      sample: createSampleDataRepository(db.executor),
      runBatch: (statements) =>
        Promise.resolve(
          db.runBatch([
            ...statements,
            { sql: 'INSERT INTO tasks (id) VALUES (?)', params: ['bad'] },
          ]),
        ),
    });

    await expect(failing.seedSampleData()).rejects.toThrow();
    expect(countRows('projects')).toBe(0);
    expect(countRows('tasks')).toBe(0);
    expect(await service.hasSeeded()).toBe(false);
  });
});

describe('clearSampleData', () => {
  it('deletes only is_sample = 1 rows and leaves user data untouched', async () => {
    await service.seedSampleData();
    const sampleProject = await service.findSampleProject();
    if (sampleProject === null) {
      throw new Error('示例项目应存在');
    }
    await insertUserProject('user-p');
    await insertUserTask('user-t', 'user-p');
    insertRecurrenceRule('sample-rule', sampleProject.id, 1);
    insertRecurrenceRule('user-rule', 'user-p', 0);
    db.raw
      .prepare(
        `INSERT INTO recurrence_exceptions
         (id, rule_id, occurrence_date, action, materialized_id, created_at, updated_at)
         VALUES ('sample-exception', 'sample-rule', '2026-07-08', 'skip', NULL, ?, ?)`,
      )
      .run('2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z');

    await service.clearSampleData();

    expect(countRows('projects', 'is_sample = 1')).toBe(0);
    expect(countRows('tasks', 'is_sample = 1')).toBe(0);
    expect(countRows('recurrence_rules', 'is_sample = 1')).toBe(0);
    expect(countRows('recurrence_exceptions')).toBe(0);
    expect(countRows('projects', 'is_sample = 0')).toBe(1);
    expect(countRows('tasks', 'is_sample = 0')).toBe(1);
    expect(countRows('recurrence_rules', 'is_sample = 0')).toBe(1);
  });

  it('keeps the seeded flag so cleared data never reappears', async () => {
    await service.seedSampleData();
    await service.clearSampleData();

    expect(await service.hasSeeded()).toBe(true);
    expect(await service.hasSampleData()).toBe(false);
  });
});

describe('hasSampleData', () => {
  it('is false before seeding and true after', async () => {
    expect(await service.hasSampleData()).toBe(false);
    await service.seedSampleData();
    expect(await service.hasSampleData()).toBe(true);
  });
});
