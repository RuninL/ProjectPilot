import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectRepository, createTaskRepository } from '@/repositories';
import { makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;

async function ids(query: Parameters<ReturnType<typeof createTaskRepository>['findByQuery']>[0]) {
  const rows = await createTaskRepository(db.executor).findByQuery(query);
  return rows.map((row) => row.id);
}

beforeEach(async () => {
  db = createTestDb();
  const projects = createProjectRepository(db.executor);
  const tasks = createTaskRepository(db.executor);

  await projects.insert(makeProject({ id: 'p1', name: '项目一', color: '#111111' }));
  await projects.insert(makeProject({ id: 'p2', name: '项目二', color: '#222222' }));

  await tasks.insert(
    makeTask({
      id: 'early',
      project_id: 'p1',
      title: '早的任务',
      due_date: '2026-08-01',
      priority: 'low',
      created_at: '2026-07-01T00:00:00Z',
    }),
  );
  await tasks.insert(
    makeTask({
      id: 'late',
      project_id: 'p1',
      title: '晚的任务',
      due_date: '2026-09-01',
      priority: 'urgent',
      status: 'in_progress',
      created_at: '2026-07-02T00:00:00Z',
    }),
  );
  await tasks.insert(
    makeTask({
      id: 'undated',
      project_id: 'p2',
      title: '没有日期的任务',
      description: '关键词',
      priority: 'high',
      created_at: '2026-07-03T00:00:00Z',
    }),
  );
  await tasks.insert(
    makeTask({
      id: 'archived',
      project_id: 'p1',
      title: '已归档任务',
      due_date: '2026-07-01',
      archived_at: '2026-07-05T00:00:00Z',
    }),
  );
});

afterEach(() => {
  db.close();
});

describe('task ordering', () => {
  it('puts tasks with no due date last, not first', async () => {
    expect(await ids({ sort: 'due_date' })).toEqual(['early', 'late', 'undated']);
  });

  it('sorts by priority urgent → low, then by due date', async () => {
    expect(await ids({ sort: 'priority' })).toEqual(['late', 'undated', 'early']);
  });

  it('sorts by newest first when sorting by creation time', async () => {
    expect(await ids({ sort: 'created_at' })).toEqual(['undated', 'late', 'early']);
  });
});

describe('task filtering', () => {
  it('hides archived tasks by default', async () => {
    expect(await ids({})).not.toContain('archived');
  });

  it('includes archived tasks only when asked', async () => {
    expect(await ids({ includeArchived: true })).toContain('archived');
  });

  it('filters by project', async () => {
    expect(await ids({ projectIds: ['p2'] })).toEqual(['undated']);
  });

  it('filters by several statuses at once', async () => {
    expect(await ids({ statuses: ['in_progress'] })).toEqual(['late']);
    expect(await ids({ statuses: ['todo', 'in_progress'] })).toHaveLength(3);
  });

  it('filters by priority', async () => {
    expect(await ids({ priorities: ['urgent', 'high'] })).toEqual(['late', 'undated']);
  });

  it('filters by a due date range and excludes undated tasks from it', async () => {
    expect(await ids({ dueFrom: '2026-08-15' })).toEqual(['late']);
    expect(await ids({ dueTo: '2026-08-15' })).toEqual(['early']);
    expect(await ids({ dueFrom: '2026-07-01', dueTo: '2026-12-31' })).toEqual(['early', 'late']);
  });

  it('searches the title and the description', async () => {
    expect(await ids({ search: '晚的' })).toEqual(['late']);
    expect(await ids({ search: '关键词' })).toEqual(['undated']);
  });

  it('treats LIKE wildcards in the search term literally', async () => {
    expect(await ids({ search: '%' })).toEqual([]);
    expect(await ids({ search: '_' })).toEqual([]);
  });

  it('combines filters', async () => {
    expect(await ids({ projectIds: ['p1'], statuses: ['todo'] })).toEqual(['early']);
  });

  it('returns an empty list rather than everything when nothing matches', async () => {
    expect(await ids({ search: '不存在的词' })).toEqual([]);
  });
});

describe('joined project fields', () => {
  it('carries the project name and colour for display', async () => {
    const rows = await createTaskRepository(db.executor).findByQuery({ projectIds: ['p2'] });

    expect(rows[0]).toMatchObject({
      id: 'undated',
      project_name: '项目二',
      project_color: '#222222',
      project_status: 'active',
    });
  });
});

describe('counts', () => {
  it('countByProject includes archived tasks, since a delete would remove them too', async () => {
    expect(await createTaskRepository(db.executor).countByProject('p1')).toBe(3);
  });

  it('findActiveByProject excludes archived tasks', async () => {
    const rows = await createTaskRepository(db.executor).findActiveByProject('p1');

    expect(rows.map((row) => row.id)).toEqual(['early', 'late']);
  });

  it('countChildren counts direct children', async () => {
    const tasks = createTaskRepository(db.executor);
    await tasks.insert(makeTask({ id: 'child', project_id: 'p1', parent_task_id: 'early' }));

    expect(await tasks.countChildren('early')).toBe(1);
    expect(await tasks.countChildren('late')).toBe(0);
  });
});
