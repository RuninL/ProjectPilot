import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createNamedListOrderRepository,
  createProjectRepository,
  createTaskChecklistRepository,
  createTaskProgressRepository,
  createTaskRepository,
} from '@/repositories';
import {
  applySavedOrder,
  createNamedListOrderService,
} from '@/services/namedListOrder.service';
import { createTaskChecklistService } from '@/services/taskChecklist.service';
import { createTaskProgressService } from '@/services/taskProgress.service';
import { makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

describe('v1.3 productivity services', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('saves, loads, updates and deletes isolated named orders', async () => {
    const repository = createNamedListOrderRepository(db.executor);
    const service = createNamedListOrderService({
      orders: repository,
      runBatch: (statements) => Promise.resolve(db.runBatch(statements)),
    });
    const created = await service.create({
      context: 'projects',
      context_id: '',
      name: '项目排序1',
      ordered_ids: ['p2', 'p1'],
      is_default: true,
    });
    expect(created.ordered_ids).toEqual(['p2', 'p1']);
    expect(created.is_default).toBe(1);
    await expect(
      service.create({
        context: 'projects',
        context_id: '',
        name: '项目排序1',
        ordered_ids: [],
        is_default: false,
      }),
    ).rejects.toThrow(/同名/);

    const renamed = await service.update(created.id, {
      context: 'projects',
      context_id: '',
      name: '重点项目',
      ordered_ids: ['p1'],
      is_default: false,
    });
    expect(renamed.name).toBe('重点项目');
    expect(applySavedOrder([{ id: 'new' }, { id: 'p1' }], renamed.ordered_ids)).toEqual([
      { id: 'p1' },
      { id: 'new' },
    ]);
    await service.delete(created.id);
    expect(await service.list('projects')).toEqual([]);
  });

  it('recalculates task progress and rejects totals above 100%', async () => {
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    await projects.insert(makeProject({ id: 'p' }));
    await tasks.insert(makeTask({ id: 't', project_id: 'p', progress: 0 }));
    const service = createTaskProgressService({
      progress: createTaskProgressRepository(db.executor),
      tasks,
    });

    const first = await service.create('t', {
      title: '需求分析',
      description: '完成拆分',
      occurred_at: '2026-08-01T10:30:00Z',
      contribution_percent: 20,
    });
    const second = await service.create('t', {
      title: '第一轮实现',
      description: '',
      occurred_at: '2026-08-02T10:30:00Z',
      contribution_percent: 25,
    });
    expect((await tasks.findById('t'))?.progress).toBe(45);
    await expect(
      service.create('t', {
        title: '过量',
        description: '',
        occurred_at: '2026-08-03T10:30:00Z',
        contribution_percent: 56,
      }),
    ).rejects.toThrow(/不能超过 100/);
    await service.update('t', second.id, {
      title: '第一轮实现',
      description: '调整贡献',
      occurred_at: second.occurred_at,
      contribution_percent: 30,
    });
    expect((await tasks.findById('t'))?.progress).toBe(50);
    await service.delete('t', first.id);
    expect((await tasks.findById('t'))?.progress).toBe(30);
  });

  it('creates, completes, reopens, reorders and deletes checklist items', async () => {
    const projects = createProjectRepository(db.executor);
    const tasks = createTaskRepository(db.executor);
    await projects.insert(makeProject({ id: 'p' }));
    await tasks.insert(makeTask({ id: 't', project_id: 'p' }));
    const service = createTaskChecklistService({
      checklist: createTaskChecklistRepository(db.executor),
      tasks,
      runBatch: (statements) => Promise.resolve(db.runBatch(statements)),
    });

    const first = await service.create('t', { content: '检查实现' });
    const second = await service.create('t', { content: '补充测试' });
    expect((await service.setCompleted('t', first.id, true)).completed_at).not.toBeNull();
    expect((await service.setCompleted('t', first.id, false)).completed_at).toBeNull();
    await service.reorder('t', [second.id, first.id]);
    expect((await service.list('t')).map((item) => item.id)).toEqual([second.id, first.id]);
    await expect(service.reorder('t', [first.id])).rejects.toThrow(/当前列表不一致/);
    await service.delete('t', second.id);
    expect((await service.list('t')).map((item) => item.id)).toEqual([first.id]);
  });
});
