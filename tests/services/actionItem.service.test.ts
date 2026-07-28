import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BatchStatement } from '@/lib/commands';
import {
  createActionItemRepository,
  createMeetingRepository,
  createProjectRepository,
  createTaskRepository,
} from '@/repositories';
import { createActionItemService, type ActionItemService } from '@/services/actionItem.service';
import { canConvert, conversionLabel, conversionState } from '@/services/actionItemConversion';
import type { ActionItemInput } from '@/services/schemas';
import type { ActionItem } from '@/types';
import { makeActionItem, makeMeeting, makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, NOW, type TestDb } from '../helpers/testDb';

let db: TestDb;
let service: ActionItemService;

function buildService(
  current: TestDb,
  runBatch?: (statements: BatchStatement[]) => Promise<number>,
): ActionItemService {
  return createActionItemService({
    actionItems: createActionItemRepository(current.executor),
    meetings: createMeetingRepository(current.executor),
    tasks: createTaskRepository(current.executor),
    projects: createProjectRepository(current.executor),
    // Stands in for the Rust `execute_batch` command: one transaction, all-or-nothing.
    runBatch: runBatch ?? ((statements) => Promise.resolve(current.runBatch(statements))),
  });
}

function input(overrides: Partial<Record<keyof ActionItemInput, unknown>> = {}): ActionItemInput {
  return {
    content: '跟进预算',
    owner: '',
    due_date: null,
    status: 'open',
    ...overrides,
  } as unknown as ActionItemInput;
}

function taskCount(): number {
  const row = db.raw.prepare('SELECT COUNT(*) AS n FROM tasks').get();
  return (row as { n: number }).n;
}

async function reload(id: string): Promise<ActionItem> {
  const item = await createActionItemRepository(db.executor).findById(id);
  if (item === null) {
    throw new Error(`行动项 ${id} 已不存在`);
  }
  return item;
}

beforeEach(async () => {
  db = createTestDb();
  service = buildService(db);
  await createProjectRepository(db.executor).insert(makeProject({ id: 'p1' }));
  await createMeetingRepository(db.executor).insert(makeMeeting({ id: 'm1', project_id: 'p1' }));
});

afterEach(() => {
  db.close();
});

describe('action item CRUD', () => {
  it('creates an item that starts unconverted', async () => {
    const item = await service.createActionItem('m1', input({ content: '  跟进预算  ' }));

    expect(item.content).toBe('跟进预算');
    expect(item.meeting_id).toBe('m1');
    expect(item.status).toBe('open');
    expect(item.converted_task_id).toBeNull();
    expect(item.converted_at).toBeNull();
    expect(conversionState(item)).toBe('unconverted');
  });

  it('rejects empty content and an unknown meeting', async () => {
    await expect(service.createActionItem('m1', input({ content: '  ' }))).rejects.toThrow(
      '行动项内容不能为空',
    );
    await expect(service.createActionItem('ghost', input())).rejects.toThrow(
      '会议不存在或已被删除',
    );
  });

  it('updates the editable fields', async () => {
    const created = await service.createActionItem('m1', input());

    const updated = await service.updateActionItem(
      created.id,
      input({ content: '改了', owner: '张三', due_date: '2026-08-01', status: 'done' }),
    );

    expect(updated.content).toBe('改了');
    expect(updated.owner).toBe('张三');
    expect(updated.due_date).toBe('2026-08-01');
    expect(updated.status).toBe('done');
  });

  it('cannot fabricate a conversion through a plain edit', async () => {
    const created = await service.createActionItem('m1', input());
    await createTaskRepository(db.executor).insert(makeTask({ id: 'sneaky' }));

    // `converted_task_id` is not in the repository's UPDATABLE whitelist, so even
    // a caller that passes it cannot get it written.
    await createActionItemRepository(db.executor).update(
      created.id,
      { converted_task_id: 'sneaky', converted_at: NOW },
      NOW,
    );

    expect((await reload(created.id)).converted_task_id).toBeNull();
    expect((await reload(created.id)).converted_at).toBeNull();
  });

  it('deletes an item and leaves its meeting alone', async () => {
    const created = await service.createActionItem('m1', input());

    await service.deleteActionItem(created.id);

    expect(await service.listByMeeting('m1')).toHaveLength(0);
    expect(await createMeetingRepository(db.executor).findById('m1')).not.toBeNull();
    await expect(service.deleteActionItem(created.id)).rejects.toThrow('行动项不存在或已被删除');
  });
});

describe('convertToTask — success path', () => {
  it('creates the task and links it in one commit', async () => {
    const item = await service.createActionItem(
      'm1',
      input({ content: '跟进预算', owner: '张三', due_date: '2026-08-01' }),
    );

    const task = await service.convertToTask(item.id);

    expect(task.project_id).toBe('p1');
    expect(task.status).toBe('todo');
    expect(task.progress).toBe(0);
    expect(task.due_date).toBe('2026-08-01');
    expect(task.source_meeting_id).toBe('m1');
    expect(task.parent_task_id).toBeNull();

    const stored = await createTaskRepository(db.executor).findById(task.id);
    expect(stored).not.toBeNull();
    expect(stored?.title).toBe('跟进预算');
    // Owner has no column of its own, so it survives in the description.
    expect(stored?.description).toBe('负责人：张三\n跟进预算');

    const reloaded = await reload(item.id);
    expect(reloaded.converted_task_id).toBe(task.id);
    expect(reloaded.converted_at).not.toBeNull();
    expect(conversionState(reloaded)).toBe('converted');
  });

  it('truncates the title to 160 chars but keeps the full text in the description', async () => {
    const long = 'あ'.repeat(300);
    const item = await service.createActionItem('m1', input({ content: long }));

    const task = await service.convertToTask(item.id);
    const stored = await createTaskRepository(db.executor).findById(task.id);

    expect(stored?.title).toHaveLength(160);
    expect(stored?.description).toBe(long);
  });

  it('is reverse-lookupable from the task back to the action item', async () => {
    const item = await service.createActionItem('m1', input());
    const task = await service.convertToTask(item.id);

    const found = await createActionItemRepository(db.executor).findByConvertedTask(task.id);
    expect(found?.id).toBe(item.id);
  });
});

describe('convertToTask — project resolution', () => {
  it('uses the meeting project and ignores a conflicting choice', async () => {
    await createProjectRepository(db.executor).insert(makeProject({ id: 'p2' }));
    const item = await service.createActionItem('m1', input());

    const task = await service.convertToTask(item.id, { project_id: 'p2' });

    expect(task.project_id).toBe('p1');
  });

  it('requires an explicit project when the meeting has none', async () => {
    await createMeetingRepository(db.executor).insert(
      makeMeeting({ id: 'solo', project_id: null }),
    );
    const item = await service.createActionItem('solo', input());

    await expect(service.convertToTask(item.id)).rejects.toThrow(
      '该会议未关联项目，请选择任务要归属的项目',
    );
    expect(taskCount()).toBe(0);

    const task = await service.convertToTask(item.id, { project_id: 'p1' });
    expect(task.project_id).toBe('p1');
    expect(task.source_meeting_id).toBe('solo');
  });

  it('rejects a chosen project that does not exist', async () => {
    await createMeetingRepository(db.executor).insert(
      makeMeeting({ id: 'solo', project_id: null }),
    );
    const item = await service.createActionItem('solo', input());

    await expect(service.convertToTask(item.id, { project_id: 'ghost' })).rejects.toThrow(
      '所属项目不存在或已被删除',
    );
    expect(taskCount()).toBe(0);
  });

  it('refuses to create a task under an archived project (phase 2 rule)', async () => {
    await createProjectRepository(db.executor).insert(
      makeProject({ id: 'p-old', archived_at: '2026-07-01T00:00:00Z' }),
    );
    await createMeetingRepository(db.executor).insert(
      makeMeeting({ id: 'm-old', project_id: 'p-old' }),
    );
    const item = await service.createActionItem('m-old', input());

    await expect(service.convertToTask(item.id)).rejects.toThrow(
      '项目已归档，无法新建任务；请先恢复该项目',
    );
    expect(taskCount()).toBe(0);
    expect((await service.listByMeeting('m-old'))[0]?.converted_at).toBeNull();
  });
});

describe('convertToTask — idempotency and atomicity', () => {
  it('rejects a second conversion of the same item', async () => {
    const item = await service.createActionItem('m1', input());
    await service.convertToTask(item.id);

    await expect(service.convertToTask(item.id)).rejects.toThrow(
      '该行动项已转换为任务，请直接查看关联任务',
    );
    expect(taskCount()).toBe(1);
  });

  it('creates exactly one task when the button is clicked twice in a row', async () => {
    const item = await service.createActionItem('m1', input());

    const results = await Promise.allSettled([
      service.convertToTask(item.id),
      service.convertToTask(item.id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(taskCount()).toBe(1);
  });

  it('creates exactly one task across many simultaneous calls', async () => {
    const item = await service.createActionItem('m1', input());

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => service.convertToTask(item.id)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(taskCount()).toBe(1);
  });

  it('leaves no orphan task when the linking half of the batch fails', async () => {
    const item = await service.createActionItem('m1', input());
    // Corrupt only the second statement, so the task insert has already run when
    // the transaction dies. Nothing may survive.
    const broken = buildService(db, (statements) =>
      Promise.resolve(
        db.runBatch([
          statements[0] as BatchStatement,
          {
            sql: 'UPDATE action_items SET meeting_id = ? WHERE id = ?',
            params: ['ghost', item.id],
          },
        ]),
      ),
    );

    await expect(broken.convertToTask(item.id)).rejects.toThrow();

    expect(taskCount()).toBe(0);
    const reloaded = await reload(item.id);
    expect(reloaded.converted_task_id).toBeNull();
    expect(reloaded.converted_at).toBeNull();
    expect(canConvert(reloaded)).toBe(true);
  });

  it('reports a conflict rather than succeeding when the batch writes too few rows', async () => {
    const item = await service.createActionItem('m1', input());
    // Simulate the latch having already closed: the guarded insert writes nothing,
    // so the count comes back short and no task exists.
    const raced = buildService(db, (statements) => {
      db.raw
        .prepare('UPDATE action_items SET converted_task_id = ?, converted_at = ? WHERE id = ?')
        .run(null, NOW, item.id);
      return Promise.resolve(db.runBatch(statements));
    });

    await expect(raced.convertToTask(item.id)).rejects.toThrow('该行动项已转换为任务');
    expect(taskCount()).toBe(0);
  });
});

describe('convertToTask — after the task is deleted', () => {
  it('keeps the item marked as converted and refuses to convert again', async () => {
    const item = await service.createActionItem('m1', input());
    const task = await service.convertToTask(item.id);

    await createTaskRepository(db.executor).deleteById(task.id);

    const reloaded = await reload(item.id);
    expect(reloaded.converted_task_id).toBeNull();
    expect(reloaded.converted_at).not.toBeNull();
    expect(conversionState(reloaded)).toBe('task_deleted');
    expect(canConvert(reloaded)).toBe(false);

    await expect(service.convertToTask(item.id)).rejects.toThrow(
      '该行动项已转换过，但关联任务已被删除，无法再次转换',
    );
    expect(taskCount()).toBe(0);
  });

  it('shows "任务已删除" when only the task is gone, even for a standalone meeting', async () => {
    await createMeetingRepository(db.executor).insert(
      makeMeeting({ id: 'solo', project_id: null }),
    );
    const item = await service.createActionItem('solo', input());
    const task = await service.convertToTask(item.id, { project_id: 'p1' });

    // Deleting the project cascades the task away, but the standalone meeting and
    // its action item are untouched — so the sticky marker is what remains.
    await createProjectRepository(db.executor).deleteById('p1');

    const reloaded = await reload(item.id);
    expect(conversionState(reloaded)).toBe('task_deleted');
    expect(await createTaskRepository(db.executor).findById(task.id)).toBeNull();
  });
});

describe('conversionState labels', () => {
  it('maps each state to its Simplified-Chinese affordance', () => {
    const unconverted = makeActionItem();
    const converted = makeActionItem({ converted_task_id: 't1', converted_at: NOW });
    const deleted = makeActionItem({ converted_task_id: null, converted_at: NOW });

    expect(conversionLabel(unconverted)).toBe('转为任务');
    expect(conversionLabel(converted)).toBe('查看任务');
    expect(conversionLabel(deleted)).toBe('任务已删除');
    expect([canConvert(unconverted), canConvert(converted), canConvert(deleted)]).toEqual([
      true,
      false,
      false,
    ]);
  });
});
