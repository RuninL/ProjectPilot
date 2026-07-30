import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectRepository, createTaskRepository } from '@/repositories';
import { createTaskService, type TaskService } from '@/services/task.service';
import type { TaskInput } from '@/services/schemas';
import { makeProject, makeTask } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let db: TestDb;
let service: TaskService;

function buildService(current: TestDb): TaskService {
  return createTaskService({
    tasks: createTaskRepository(current.executor),
    projects: createProjectRepository(current.executor),
    // Stands in for the Rust `execute_batch` command: one transaction, all-or-nothing.
    runBatch: (statements) => Promise.resolve(current.runBatch(statements)),
  });
}

function input(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    project_id: 'p1',
    parent_task_id: null,
    title: '新任务',
    description: '',
    status: 'todo',
    priority: 'medium',
    start_date: null,
    due_date: null,
    progress: 0,
    estimated_hours: null,
    actual_hours: null,
    ...overrides,
  };
}

beforeEach(async () => {
  db = createTestDb();
  service = buildService(db);
  await createProjectRepository(db.executor).insert(makeProject({ id: 'p1' }));
});

afterEach(() => {
  db.close();
});

describe('createTask', () => {
  it('persists a task with the defaults from migration 0002 unset', async () => {
    const task = await service.createTask(input({ title: '  写文档  ' }));

    expect(task.title).toBe('写文档');
    expect(task.completed_at).toBeNull();
    expect(task.archived_at).toBeNull();
    expect(task.source_meeting_id).toBeNull();
    expect(task.is_sample).toBe(0);
  });

  it('rejects an empty title with a Chinese message', async () => {
    await expect(service.createTask(input({ title: '   ' }))).rejects.toThrow('任务标题不能为空');
  });

  it('rejects a due date earlier than the start date', async () => {
    await expect(
      service.createTask(input({ start_date: '2026-07-20', due_date: '2026-07-10' })),
    ).rejects.toThrow('截止日期不能早于开始日期');
  });

  it('refuses to create a task in an archived project', async () => {
    await createProjectRepository(db.executor).insert(
      makeProject({ id: 'archived', archived_at: '2026-07-01T00:00:00Z', status: 'archived' }),
    );

    await expect(service.createTask(input({ project_id: 'archived' }))).rejects.toThrow(
      '项目已归档，无法新建任务',
    );
  });

  it('reports a missing project instead of writing an orphan row', async () => {
    await expect(service.createTask(input({ project_id: 'ghost' }))).rejects.toThrow(
      '所属项目不存在',
    );
  });

  it('forces progress to 100 and stamps completed_at when created as done', async () => {
    const task = await service.createTask(input({ status: 'done', progress: 10 }));

    expect(task.progress).toBe(100);
    expect(task.completed_at).not.toBeNull();
  });
});

describe('task hierarchy rules', () => {
  it('allows one level of children', async () => {
    const parent = await service.createTask(input({ title: '父任务' }));
    const child = await service.createTask(input({ title: '子任务', parent_task_id: parent.id }));

    expect(child.parent_task_id).toBe(parent.id);
  });

  it('blocks a third level with a readable message', async () => {
    const parent = await service.createTask(input({ title: '父任务' }));
    const child = await service.createTask(input({ title: '子任务', parent_task_id: parent.id }));

    await expect(
      service.createTask(input({ title: '孙任务', parent_task_id: child.id })),
    ).rejects.toThrow('任务层级最多两层');
  });

  it('blocks a cross-project parent before the database has to', async () => {
    await createProjectRepository(db.executor).insert(makeProject({ id: 'p2' }));
    const foreign = await service.createTask(input({ project_id: 'p2', title: '别的项目的任务' }));

    await expect(service.createTask(input({ parent_task_id: foreign.id }))).rejects.toThrow(
      '父任务必须属于同一个项目',
    );
  });

  it('blocks pointing a task at itself', async () => {
    const task = await service.createTask(input());

    await expect(service.updateTask(task.id, input({ parent_task_id: task.id }))).rejects.toThrow(
      '任务不能将自己设为父任务',
    );
  });

  it('blocks giving a parent to a task that already has children', async () => {
    const parent = await service.createTask(input({ title: '父任务' }));
    await service.createTask(input({ title: '子任务', parent_task_id: parent.id }));
    const other = await service.createTask(input({ title: '另一个任务' }));

    await expect(
      service.updateTask(parent.id, input({ title: '父任务', parent_task_id: other.id })),
    ).rejects.toThrow('该任务已有子任务');
  });

  it('rejects a non-existent parent', async () => {
    await expect(service.createTask(input({ parent_task_id: 'ghost' }))).rejects.toThrow(
      '父任务不存在',
    );
  });
});

describe('updateTask status transitions', () => {
  it('allows postponed to and from every task status without transition validation', async () => {
    const statuses = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
    for (const status of statuses) {
      const task = await service.createTask(input({ title: status, status }));
      const postponed = await service.updateTask(
        task.id,
        input({ title: status, status: 'postponed', progress: task.progress }),
      );
      expect(postponed.status).toBe('postponed');
      const restored = await service.updateTask(
        task.id,
        input({ title: status, status, progress: postponed.progress }),
      );
      expect(restored.status).toBe(status);
    }
  });

  it('forces progress to 100 and records completed_at on entering done', async () => {
    const task = await service.createTask(input({ progress: 30 }));

    const updated = await service.updateTask(task.id, input({ status: 'done', progress: 30 }));

    expect(updated.progress).toBe(100);
    expect(updated.completed_at).not.toBeNull();
  });

  it('keeps the original completed_at when a done task is edited again', async () => {
    const task = await service.createTask(input({ status: 'done' }));
    const first = task.completed_at;

    const updated = await service.updateTask(
      task.id,
      input({ status: 'done', title: '改过的标题' }),
    );

    expect(updated.completed_at).toBe(first);
    expect(updated.title).toBe('改过的标题');
  });

  it('clears completed_at but keeps progress 100 when leaving done', async () => {
    const task = await service.createTask(input({ status: 'done' }));

    const reopened = await service.updateTask(
      task.id,
      input({ status: 'in_progress', progress: 100 }),
    );

    expect(reopened.completed_at).toBeNull();
    expect(reopened.progress).toBe(100);
    expect(reopened.status).toBe('in_progress');
  });

  it('leaves a reopened task fully editable', async () => {
    const task = await service.createTask(input({ status: 'done' }));
    await service.updateTask(task.id, input({ status: 'todo', progress: 100 }));

    const edited = await service.updateTask(
      task.id,
      input({ status: 'todo', progress: 20, title: '继续编辑' }),
    );

    expect(edited.progress).toBe(20);
    expect(edited.title).toBe('继续编辑');
  });

  it('refuses to move a task to another project', async () => {
    await createProjectRepository(db.executor).insert(makeProject({ id: 'p2' }));
    const task = await service.createTask(input());

    await expect(service.updateTask(task.id, input({ project_id: 'p2' }))).rejects.toThrow(
      '任务不能移动到其他项目',
    );
  });

  it('reports a missing task', async () => {
    await expect(service.updateTask('ghost', input())).rejects.toThrow('任务不存在');
  });
});

describe('deleteTask', () => {
  it('deletes a leaf task', async () => {
    const task = await service.createTask(input());

    await service.deleteTask(task.id);

    expect(await createTaskRepository(db.executor).findById(task.id)).toBeNull();
  });

  it('refuses to delete a parent and names the child count', async () => {
    const parent = await service.createTask(input({ title: '父任务' }));
    await service.createTask(input({ title: '子任务 1', parent_task_id: parent.id }));
    await service.createTask(input({ title: '子任务 2', parent_task_id: parent.id }));

    await expect(service.deleteTask(parent.id)).rejects.toThrow('还有 2 个子任务');
    expect(await createTaskRepository(db.executor).findById(parent.id)).not.toBeNull();
  });

  it('allows deleting the parent once its children are gone', async () => {
    const parent = await service.createTask(input({ title: '父任务' }));
    const child = await service.createTask(input({ title: '子任务', parent_task_id: parent.id }));

    await service.deleteTask(child.id);
    await service.deleteTask(parent.id);

    expect(await createTaskRepository(db.executor).findById(parent.id)).toBeNull();
  });
});

describe('bulkUpdateTasks', () => {
  it('allows bulk postponing without transition validation', async () => {
    const todo = await service.createTask(input({ title: '待办' }));
    const done = await service.createTask(input({ title: '完成', status: 'done' }));

    await service.bulkUpdateTasks([todo.id, done.id], { status: 'postponed' });

    const repo = createTaskRepository(db.executor);
    expect((await repo.findById(todo.id))?.status).toBe('postponed');
    expect((await repo.findById(done.id))?.status).toBe('postponed');
  });

  it('applies one patch to every selected task', async () => {
    const a = await service.createTask(input({ title: 'A' }));
    const b = await service.createTask(input({ title: 'B' }));

    await service.bulkUpdateTasks([a.id, b.id], { priority: 'urgent' });

    const repo = createTaskRepository(db.executor);
    expect((await repo.findById(a.id))?.priority).toBe('urgent');
    expect((await repo.findById(b.id))?.priority).toBe('urgent');
  });

  it('applies the done rules to each task in the batch', async () => {
    const a = await service.createTask(input({ title: 'A', progress: 10 }));
    const b = await service.createTask(input({ title: 'B', progress: 20 }));

    await service.bulkUpdateTasks([a.id, b.id], { status: 'done' });

    const repo = createTaskRepository(db.executor);
    for (const id of [a.id, b.id]) {
      const task = await repo.findById(id);
      expect(task?.progress).toBe(100);
      expect(task?.completed_at).not.toBeNull();
    }
  });

  it('clears completed_at for every task moved out of done', async () => {
    const a = await service.createTask(input({ title: 'A', status: 'done' }));
    const b = await service.createTask(input({ title: 'B', status: 'done' }));

    await service.bulkUpdateTasks([a.id, b.id], { status: 'todo' });

    const repo = createTaskRepository(db.executor);
    expect((await repo.findById(a.id))?.completed_at).toBeNull();
    expect((await repo.findById(b.id))?.completed_at).toBeNull();
  });

  it('rolls every row back when one statement in the batch fails', async () => {
    const a = await service.createTask(input({ title: 'A' }));
    const b = await service.createTask(input({ title: 'B' }));

    const failing = createTaskService({
      tasks: createTaskRepository(db.executor),
      projects: createProjectRepository(db.executor),
      runBatch: (statements) =>
        Promise.resolve(
          db.runBatch([...statements, { sql: 'UPDATE tasks SET progress = ?', params: [999] }]),
        ),
    });

    await expect(failing.bulkUpdateTasks([a.id, b.id], { priority: 'urgent' })).rejects.toThrow();

    const repo = createTaskRepository(db.executor);
    expect((await repo.findById(a.id))?.priority).toBe('medium');
    expect((await repo.findById(b.id))?.priority).toBe('medium');
  });

  it('rejects an empty selection', async () => {
    await expect(service.bulkUpdateTasks([], { priority: 'high' })).rejects.toThrow(
      '请先选择要修改的任务',
    );
  });

  it('rejects a patch that changes nothing', async () => {
    const a = await service.createTask(input());

    await expect(service.bulkUpdateTasks([a.id], {})).rejects.toThrow('请至少选择一项要修改的内容');
  });

  it('can clear the due date across a selection', async () => {
    const a = await service.createTask(input({ title: 'A', due_date: '2026-08-01' }));

    await service.bulkUpdateTasks([a.id], { due_date: null });

    expect((await createTaskRepository(db.executor).findById(a.id))?.due_date).toBeNull();
  });
});

describe('countChildren', () => {
  it('counts direct children only', async () => {
    const parent = await service.createTask(input({ title: '父任务' }));
    await service.createTask(input({ title: '子任务', parent_task_id: parent.id }));
    await createTaskRepository(db.executor).insert(makeTask({ id: 'unrelated', project_id: 'p1' }));

    expect(await service.countChildren(parent.id)).toBe(1);
  });
});
