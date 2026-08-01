import type { BatchStatement } from '@/lib/commands';
import { executeBatch } from '@/lib/commands';
import { nowIso } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import { getRepositories, type TaskChecklistRepository, type TaskRepository } from '@/repositories';
import type { TaskChecklistItem } from '@/types';
import { taskChecklistItemInputSchema, type TaskChecklistItemInput } from './schemas';

export interface TaskChecklistServiceDeps {
  checklist: TaskChecklistRepository;
  tasks: TaskRepository;
  runBatch: (statements: BatchStatement[]) => Promise<number>;
}

export function createTaskChecklistService(deps: TaskChecklistServiceDeps) {
  async function requireTask(taskId: string): Promise<void> {
    if ((await deps.tasks.findById(taskId)) === null) {
      throw new AppError('not_found', '任务不存在或已被删除');
    }
  }

  async function requireItem(taskId: string, id: string): Promise<TaskChecklistItem> {
    const item = await deps.checklist.findById(id);
    if (item === null || item.task_id !== taskId) {
      throw new AppError('not_found', '任务待办不存在或不属于当前任务');
    }
    return item;
  }

  return {
    async list(taskId: string): Promise<TaskChecklistItem[]> {
      await requireTask(taskId);
      return deps.checklist.findByTask(taskId);
    },

    async create(taskId: string, input: TaskChecklistItemInput): Promise<TaskChecklistItem> {
      await requireTask(taskId);
      const parsed = taskChecklistItemInputSchema.parse(input);
      const now = nowIso();
      const item: TaskChecklistItem = {
        id: newId(),
        task_id: taskId,
        content: parsed.content,
        is_completed: 0,
        sort_order: await deps.checklist.nextSortOrder(taskId),
        completed_at: null,
        created_at: now,
        updated_at: now,
      };
      await deps.checklist.insert(item);
      return requireItem(taskId, item.id);
    },

    async update(
      taskId: string,
      id: string,
      input: TaskChecklistItemInput,
    ): Promise<TaskChecklistItem> {
      const existing = await requireItem(taskId, id);
      const parsed = taskChecklistItemInputSchema.parse(input);
      await deps.checklist.update(id, { ...existing, content: parsed.content }, nowIso());
      return requireItem(taskId, id);
    },

    async setCompleted(taskId: string, id: string, completed: boolean): Promise<TaskChecklistItem> {
      const existing = await requireItem(taskId, id);
      const now = nowIso();
      await deps.checklist.update(
        id,
        {
          content: existing.content,
          is_completed: completed ? 1 : 0,
          completed_at: completed ? now : null,
        },
        now,
      );
      return requireItem(taskId, id);
    },

    async reorder(taskId: string, orderedIds: readonly string[]): Promise<void> {
      const existing = await deps.checklist.findByTask(taskId);
      if (
        existing.length !== orderedIds.length ||
        new Set(orderedIds).size !== orderedIds.length ||
        existing.some((item) => !orderedIds.includes(item.id))
      ) {
        throw new AppError('validation', '待办顺序与当前列表不一致，请刷新后重试');
      }
      const now = nowIso();
      await deps.runBatch(
        orderedIds.map((id, index) => deps.checklist.buildReorder(id, taskId, index, now)),
      );
    },

    async delete(taskId: string, id: string): Promise<void> {
      await requireItem(taskId, id);
      await deps.checklist.deleteById(id);
    },
  };
}

export type TaskChecklistService = ReturnType<typeof createTaskChecklistService>;

export async function getTaskChecklistService(): Promise<TaskChecklistService> {
  const repositories = await getRepositories();
  return createTaskChecklistService({
    checklist: repositories.taskChecklist,
    tasks: repositories.tasks,
    runBatch: executeBatch,
  });
}
