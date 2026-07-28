import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProjectRepository,
  createTaskDependencyRepository,
  createTaskRepository,
} from '@/repositories';
import { createDependencyService, type DependencyService } from '@/services/dependency.service';
import type { Task, TaskDependency } from '@/types';
import { makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

/**
 * The service is exercised against real SQLite so the database constraints and
 * the in-memory graph checks are both in play — a rule passing here has not been
 * mocked into passing.
 */

let db: TestDb;
let service: DependencyService;

async function seedTask(overrides: Partial<Task> = {}): Promise<Task> {
  const task = makeTask(overrides);
  await createTaskRepository(db.executor).insert(task);
  return task;
}

function link(predecessorId: string, successorId: string): Promise<TaskDependency> {
  return service.createDependency({ predecessor_id: predecessorId, successor_id: successorId });
}

beforeEach(async () => {
  db = createTestDb();
  service = createDependencyService({
    tasks: createTaskRepository(db.executor),
    dependencies: createTaskDependencyRepository(db.executor),
  });
  const projects = createProjectRepository(db.executor);
  await projects.insert(makeProject({ id: 'p1' }));
  await projects.insert(makeProject({ id: 'p2', name: '另一个项目' }));
});

afterEach(() => {
  db.close();
});

describe('createDependency', () => {
  it('creates a finish-to-start edge inside one project', async () => {
    await seedTask({ id: 'a', title: '设计' });
    await seedTask({ id: 'b', title: '开发' });

    const dependency = await service.createDependency({
      predecessor_id: 'a',
      successor_id: 'b',
    });

    expect(dependency.predecessor_id).toBe('a');
    expect(dependency.successor_id).toBe('b');
    expect(dependency.dep_type).toBe('FS');
    expect(dependency.lag_days).toBe(0);
    expect(dependency.id).not.toBe('');

    const stored = await createTaskDependencyRepository(db.executor).findByProject('p1');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(dependency.id);
  });

  it('never rewrites either task status', async () => {
    await seedTask({ id: 'a', status: 'blocked' });
    await seedTask({ id: 'b', status: 'todo' });

    await link('a', 'b');

    const successor = await createTaskRepository(db.executor).findById('b');
    expect(successor?.status).toBe('todo');
  });

  it('rejects a missing predecessor or successor id', async () => {
    await expect(
      service.createDependency({ predecessor_id: '', successor_id: 'b' }),
    ).rejects.toThrow('请选择前驱任务');
    await expect(
      service.createDependency({ predecessor_id: 'a', successor_id: '' }),
    ).rejects.toThrow('请选择后继任务');
  });

  it('rejects a self dependency', async () => {
    await seedTask({ id: 'a' });

    await expect(link('a', 'a')).rejects.toThrow('任务不能依赖自己');
  });

  it('rejects a duplicate dependency', async () => {
    await seedTask({ id: 'a' });
    await seedTask({ id: 'b' });
    await link('a', 'b');

    await expect(link('a', 'b')).rejects.toThrow('这两个任务之间已存在依赖');
  });

  it('rejects a cross-project dependency', async () => {
    await seedTask({ id: 'a', project_id: 'p1' });
    await seedTask({ id: 'far', project_id: 'p2' });

    await expect(link('a', 'far')).rejects.toThrow('只能在同一项目内创建任务依赖');
    await expect(link('far', 'a')).rejects.toThrow('只能在同一项目内创建任务依赖');
  });

  it('reports a task that does not exist', async () => {
    await seedTask({ id: 'a' });

    await expect(link('a', 'ghost')).rejects.toThrow('任务不存在或已被删除');
    await expect(link('ghost', 'a')).rejects.toThrow('任务不存在或已被删除');
  });

  it('refuses to attach a dependency to an archived task', async () => {
    await seedTask({ id: 'a' });
    await seedTask({ id: 'gone', archived_at: '2026-07-01T00:00:00Z' });

    await expect(link('a', 'gone')).rejects.toThrow('已归档的任务不能新建依赖；请先恢复该任务');
    await expect(link('gone', 'a')).rejects.toThrow('已归档的任务不能新建依赖；请先恢复该任务');
  });

  it('allows a dependency on a done task — history stays representable', async () => {
    await seedTask({ id: 'a', status: 'done', progress: 100 });
    await seedTask({ id: 'b' });

    await expect(link('a', 'b')).resolves.toMatchObject({ predecessor_id: 'a' });
  });

  it('rejects the direct reverse of an existing edge', async () => {
    await seedTask({ id: 'a', title: '甲' });
    await seedTask({ id: 'b', title: '乙' });
    await link('a', 'b');

    await expect(link('b', 'a')).rejects.toThrow('会形成循环依赖');
  });

  it('rejects C -> A after A -> B -> C, naming both tasks', async () => {
    await seedTask({ id: 'a', title: '需求' });
    await seedTask({ id: 'b', title: '设计' });
    await seedTask({ id: 'c', title: '开发' });
    await link('a', 'b');
    await link('b', 'c');

    await expect(link('c', 'a')).rejects.toThrow(
      '会形成循环依赖：「需求」已经是「开发」的前置任务',
    );
  });

  it('rejects a cycle that closes through a fork and a join', async () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      await seedTask({ id, title: id.toUpperCase() });
    }
    await link('a', 'b');
    await link('a', 'c');
    await link('b', 'd');
    await link('c', 'd');

    await expect(link('d', 'a')).rejects.toThrow('会形成循环依赖');
    await expect(link('d', 'c')).rejects.toThrow('会形成循环依赖');
  });

  it('rejects a cycle across a long chain', async () => {
    const ids = Array.from({ length: 8 }, (_, index) => `n${String(index)}`);
    for (const id of ids) {
      await seedTask({ id, title: id });
    }
    for (let index = 1; index < ids.length; index += 1) {
      await link(ids[index - 1] as string, ids[index] as string);
    }

    await expect(link('n7', 'n0')).rejects.toThrow('会形成循环依赖');
    await expect(link('n7', 'n3')).rejects.toThrow('会形成循环依赖');
  });

  it('allows a shortcut edge that adds no cycle', async () => {
    await seedTask({ id: 'a' });
    await seedTask({ id: 'b' });
    await seedTask({ id: 'c' });
    await link('a', 'b');
    await link('b', 'c');

    await expect(link('a', 'c')).resolves.toMatchObject({ successor_id: 'c' });
  });

  it('supports multiple predecessors and multiple successors', async () => {
    for (const id of ['a', 'b', 'hub', 'x', 'y']) {
      await seedTask({ id });
    }
    await link('a', 'hub');
    await link('b', 'hub');
    await link('hub', 'x');
    await link('hub', 'y');

    const analysis = await service.analyzeProject('p1');
    expect(analysis.dependencies).toHaveLength(4);
    // Sorted because edges created in the same millisecond tie-break on their
    // generated id, so the stored order is reproducible but not creation order.
    expect([...(analysis.graph.predecessors.get('hub') ?? [])].sort()).toEqual(['a', 'b']);
    expect([...(analysis.graph.successors.get('hub') ?? [])].sort()).toEqual(['x', 'y']);
  });
});

describe('deleteDependency', () => {
  it('removes the edge and leaves both tasks untouched', async () => {
    await seedTask({ id: 'a', status: 'blocked' });
    await seedTask({ id: 'b', status: 'in_progress' });
    const dependency = await service.createDependency({
      predecessor_id: 'a',
      successor_id: 'b',
    });

    await service.deleteDependency(dependency.id);

    const analysis = await service.analyzeProject('p1');
    expect(analysis.dependencies).toEqual([]);
    expect(analysis.tasks.map((task) => task.status)).toEqual(['blocked', 'in_progress']);
  });

  it('reports a dependency that no longer exists', async () => {
    await expect(service.deleteDependency('ghost')).rejects.toThrow('该依赖不存在或已被删除');
  });

  it('lets the pair be re-created after deletion', async () => {
    await seedTask({ id: 'a' });
    await seedTask({ id: 'b' });
    const first = await service.createDependency({ predecessor_id: 'a', successor_id: 'b' });
    await service.deleteDependency(first.id);

    const second = await service.createDependency({ predecessor_id: 'a', successor_id: 'b' });
    expect(second.id).not.toBe(first.id);
  });
});

describe('analyzeProject', () => {
  it('returns empty derivations for a project with no tasks', async () => {
    const analysis = await service.analyzeProject('p1');

    expect(analysis.tasks).toEqual([]);
    expect(analysis.dependencies).toEqual([]);
    expect(analysis.conflicts).toEqual([]);
    expect(analysis.blockedRisks).toEqual([]);
    expect(analysis.cyclicTaskIds).toEqual([]);
  });

  it('ignores tasks and edges belonging to another project', async () => {
    await seedTask({ id: 'a' });
    await seedTask({ id: 'b' });
    await link('a', 'b');
    await seedTask({ id: 'other', project_id: 'p2' });

    const analysis = await service.analyzeProject('p1');
    expect(analysis.tasks.map((task) => task.id)).toEqual(['a', 'b']);
    expect(analysis.dependencies).toHaveLength(1);
  });

  it('derives blocked risk from a blocked predecessor and drops it on recovery', async () => {
    await seedTask({ id: 'a', status: 'blocked' });
    await seedTask({ id: 'b' });
    await seedTask({ id: 'c' });
    await link('a', 'b');
    await link('b', 'c');

    const blocked = await service.analyzeProject('p1');
    expect(blocked.blockedRisks).toEqual([
      { taskId: 'b', blockedBy: ['a'] },
      { taskId: 'c', blockedBy: ['a'] },
    ]);

    await createTaskRepository(db.executor).update(
      'a',
      { status: 'in_progress' },
      '2026-07-15T00:00:00Z',
    );

    const recovered = await service.analyzeProject('p1');
    expect(recovered.blockedRisks).toEqual([]);
  });

  it('does not carry risk into done, cancelled or archived successors', async () => {
    await seedTask({ id: 'a', status: 'blocked' });
    await seedTask({ id: 'done', status: 'done', progress: 100 });
    await seedTask({ id: 'cancelled', status: 'cancelled' });
    await seedTask({ id: 'archived', archived_at: '2026-07-01T00:00:00Z' });
    await seedTask({ id: 'open' });
    await link('a', 'done');
    await link('a', 'cancelled');
    await link('a', 'open');
    // The archived edge must be created before archiving, since new edges are refused.
    await createTaskDependencyRepository(db.executor).insert({
      id: 'd-archived',
      predecessor_id: 'a',
      successor_id: 'archived',
      dep_type: 'FS',
      lag_days: 0,
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:00:00Z',
    });

    const analysis = await service.analyzeProject('p1');
    expect(analysis.blockedRisks.map((risk) => risk.taskId)).toEqual(['open']);
  });

  it('reports a schedule conflict and clears it once the dates are fixed', async () => {
    await seedTask({ id: 'a', due_date: '2026-08-10' });
    await seedTask({ id: 'b', start_date: '2026-08-05' });
    await link('a', 'b');

    const conflicted = await service.analyzeProject('p1');
    expect(conflicted.conflicts).toHaveLength(1);
    expect(conflicted.conflicts[0]).toMatchObject({
      predecessorId: 'a',
      successorId: 'b',
      predecessorDueDate: '2026-08-10',
      successorStartDate: '2026-08-05',
    });

    await createTaskRepository(db.executor).update(
      'b',
      { start_date: '2026-08-11' },
      '2026-07-15T00:00:00Z',
    );

    const fixed = await service.analyzeProject('p1');
    expect(fixed.conflicts).toEqual([]);
  });

  it('reports no conflict when either date is missing', async () => {
    await seedTask({ id: 'a', due_date: '2026-08-10' });
    await seedTask({ id: 'b' });
    await link('a', 'b');

    const analysis = await service.analyzeProject('p1');
    expect(analysis.conflicts).toEqual([]);
  });

  it('surfaces stored cycles instead of hanging, if a row ever bypasses the service', async () => {
    for (const id of ['a', 'b', 'c']) {
      await seedTask({ id });
    }
    await link('a', 'b');
    await link('b', 'c');
    // Bypass the service the way only a manual DB edit could: the triggers stop
    // the two-node mirror, not a three-node ring.
    await createTaskDependencyRepository(db.executor).insert({
      id: 'd-cycle',
      predecessor_id: 'c',
      successor_id: 'a',
      dep_type: 'FS',
      lag_days: 0,
      created_at: '2026-07-14T00:00:00Z',
      updated_at: '2026-07-14T00:00:00Z',
    });

    const analysis = await service.analyzeProject('p1');
    expect(analysis.cyclicTaskIds).toEqual(['a', 'b', 'c']);
  });
});
