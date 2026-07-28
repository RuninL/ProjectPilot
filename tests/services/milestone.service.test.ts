import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMilestoneRepository,
  createProjectRepository,
  createTaskRepository,
} from '@/repositories';
import { createMilestoneService, type MilestoneService } from '@/services/milestone.service';
import type { MilestoneInput } from '@/services/schemas';
import { makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

const TODAY = '2026-07-14';

let db: TestDb;
let service: MilestoneService;

function buildService(current: TestDb): MilestoneService {
  return createMilestoneService({
    milestones: createMilestoneRepository(current.executor),
    tasks: createTaskRepository(current.executor),
    projects: createProjectRepository(current.executor),
  });
}

function input(overrides: Partial<Record<keyof MilestoneInput, unknown>> = {}): MilestoneInput {
  return {
    project_id: 'p1',
    linked_task_id: null,
    name: '第一阶段',
    description: '',
    date: '2026-08-01',
    status: 'upcoming',
    ...overrides,
  } as unknown as MilestoneInput;
}

beforeEach(async () => {
  db = createTestDb();
  service = buildService(db);
  await createProjectRepository(db.executor).insert(makeProject({ id: 'p1' }));
  await createTaskRepository(db.executor).insert(makeTask({ id: 't1' }));
});

afterEach(() => {
  db.close();
});

describe('createMilestone', () => {
  it('persists a milestone with a derived countdown', async () => {
    const milestone = await service.createMilestone(input({ name: '  第一阶段  ' }));

    expect(milestone.name).toBe('第一阶段');
    expect(milestone.status).toBe('upcoming');
    expect(milestone.achieved_at).toBeNull();

    const detail = await service.getMilestone(milestone.id, TODAY);
    expect(detail.view.daysRemaining).toBe(18);
    expect(detail.view.label).toBe('剩余 18 天');
    expect(detail.linkedTask).toBeNull();
    expect(detail.promptAchieved).toBe(false);
  });

  it('rejects an empty name, an empty date and an impossible date', async () => {
    await expect(service.createMilestone(input({ name: '  ' }))).rejects.toThrow(
      '里程碑名称不能为空',
    );
    await expect(service.createMilestone(input({ date: '' }))).rejects.toThrow('日期不能为空');
    await expect(service.createMilestone(input({ date: '2026-02-30' }))).rejects.toThrow(
      '日期必须为有效的 YYYY-MM-DD',
    );
  });

  it('rejects an unknown project and requires one', async () => {
    await expect(service.createMilestone(input({ project_id: 'ghost' }))).rejects.toThrow(
      '所属项目不存在或已被删除',
    );
    await expect(service.createMilestone(input({ project_id: '' }))).rejects.toThrow(
      '必须选择所属项目',
    );
  });

  it('rejects a linked task from another project', async () => {
    await createProjectRepository(db.executor).insert(makeProject({ id: 'p2' }));
    await createTaskRepository(db.executor).insert(makeTask({ id: 't-far', project_id: 'p2' }));

    await expect(service.createMilestone(input({ linked_task_id: 't-far' }))).rejects.toThrow(
      '关联任务必须属于同一个项目',
    );
    await expect(service.createMilestone(input({ linked_task_id: 'ghost' }))).rejects.toThrow(
      '关联任务不存在或已被删除',
    );
  });

  it('stamps achieved_at when created straight into achieved', async () => {
    const milestone = await service.createMilestone(input({ status: 'achieved' }));
    expect(milestone.achieved_at).not.toBeNull();
  });
});

describe('updateMilestone', () => {
  it('edits fields and keeps the milestone in its project', async () => {
    const created = await service.createMilestone(input());

    const updated = await service.updateMilestone(
      created.id,
      input({ name: '改名', date: '2026-09-01', linked_task_id: 't1', description: '说明' }),
    );

    expect(updated.name).toBe('改名');
    expect(updated.date).toBe('2026-09-01');
    expect(updated.linked_task_id).toBe('t1');
    expect(updated.description).toBe('说明');
  });

  it('refuses to move a milestone to another project', async () => {
    await createProjectRepository(db.executor).insert(makeProject({ id: 'p2' }));
    const created = await service.createMilestone(input());

    await expect(service.updateMilestone(created.id, input({ project_id: 'p2' }))).rejects.toThrow(
      '里程碑不能移动到其他项目',
    );
  });

  it('rejects an unknown milestone', async () => {
    await expect(service.updateMilestone('ghost', input())).rejects.toThrow(
      '里程碑不存在或已被删除',
    );
  });
});

describe('a completed linked task only ever produces a prompt', () => {
  it('does not change the status when the linked task reaches done', async () => {
    const milestone = await service.createMilestone(input({ linked_task_id: 't1' }));

    await createTaskRepository(db.executor).update(
      't1',
      { status: 'done', progress: 100, completed_at: '2026-07-14T00:00:00Z' },
      '2026-07-14T00:00:00Z',
    );

    const detail = await service.getMilestone(milestone.id, TODAY);
    expect(detail.promptAchieved).toBe(true);
    // The row itself is untouched: the prompt is a question, not a write.
    expect(detail.milestone.status).toBe('upcoming');
    expect(detail.milestone.achieved_at).toBeNull();
  });

  it('keeps the status unchanged when the user answers 否 (no call is made)', async () => {
    const milestone = await service.createMilestone(input({ linked_task_id: 't1' }));
    await createTaskRepository(db.executor).update('t1', { status: 'done' }, TODAY);

    // Answering "否" means the UI simply never calls setStatus. Re-reading proves
    // nothing drifted in the meantime.
    const before = await service.getMilestone(milestone.id, TODAY);
    const after = await service.getMilestone(milestone.id, TODAY);

    expect(after.milestone).toStrictEqual(before.milestone);
    expect(after.milestone.status).toBe('upcoming');
    expect(after.promptAchieved).toBe(true);
  });

  it('marks it achieved only through the explicit setStatus call (是)', async () => {
    const milestone = await service.createMilestone(input({ linked_task_id: 't1' }));
    await createTaskRepository(db.executor).update('t1', { status: 'done' }, TODAY);

    const updated = await service.setStatus(milestone.id, 'achieved');

    expect(updated.status).toBe('achieved');
    expect(updated.achieved_at).not.toBeNull();
    const detail = await service.getMilestone(milestone.id, TODAY);
    expect(detail.promptAchieved).toBe(false);
    expect(detail.view.label).toBe('已达成');
  });

  it('never prompts for an overdue milestone whose task is unfinished', async () => {
    const milestone = await service.createMilestone(
      input({ date: '2026-07-01', linked_task_id: 't1' }),
    );

    const detail = await service.getMilestone(milestone.id, TODAY);
    expect(detail.promptAchieved).toBe(false);
    expect(detail.view.needsAttention).toBe(true);
    expect(detail.view.label).toBe('已逾期 13 天');
    expect(detail.milestone.status).toBe('upcoming');
  });
});

describe('setStatus', () => {
  it('clears achieved_at on the way back out of achieved', async () => {
    const milestone = await service.createMilestone(input({ status: 'achieved' }));
    expect(milestone.achieved_at).not.toBeNull();

    const reopened = await service.setStatus(milestone.id, 'upcoming');
    expect(reopened.achieved_at).toBeNull();
  });

  it('keeps the original achieved_at when re-marking an achieved milestone', async () => {
    const milestone = await service.createMilestone(input({ status: 'achieved' }));

    const again = await service.setStatus(milestone.id, 'achieved');
    expect(again.achieved_at).toBe(milestone.achieved_at);
  });

  it('records missed and cancelled without stamping achieved_at', async () => {
    const milestone = await service.createMilestone(input({ date: '2026-07-01' }));

    expect((await service.setStatus(milestone.id, 'missed')).achieved_at).toBeNull();
    expect((await service.setStatus(milestone.id, 'cancelled')).achieved_at).toBeNull();
  });

  it('rejects an unknown milestone', async () => {
    await expect(service.setStatus('ghost', 'achieved')).rejects.toThrow('里程碑不存在或已被删除');
  });
});

describe('listing and deleting', () => {
  it('orders milestones by date and derives each countdown', async () => {
    await service.createMilestone(input({ name: '晚', date: '2026-09-01' }));
    await service.createMilestone(input({ name: '早', date: '2026-07-20' }));
    await service.createMilestone(input({ name: '今天', date: TODAY }));

    const details = await service.listByProject('p1', TODAY);

    expect(details.map((d) => d.milestone.name)).toEqual(['今天', '早', '晚']);
    expect(details.map((d) => d.view.daysRemaining)).toEqual([0, 6, 49]);
    expect(details[0]?.view.label).toBe('今天到期');
  });

  it('reports a null linked task once that task is deleted', async () => {
    const milestone = await service.createMilestone(input({ linked_task_id: 't1' }));

    await createTaskRepository(db.executor).deleteById('t1');

    const detail = await service.getMilestone(milestone.id, TODAY);
    expect(detail.milestone.linked_task_id).toBeNull();
    expect(detail.linkedTask).toBeNull();
    expect(detail.promptAchieved).toBe(false);
  });

  it('deletes a milestone and refuses a second delete', async () => {
    const milestone = await service.createMilestone(input());

    await service.deleteMilestone(milestone.id);

    expect(await service.listByProject('p1', TODAY)).toHaveLength(0);
    await expect(service.deleteMilestone(milestone.id)).rejects.toThrow('里程碑不存在或已被删除');
  });
});
