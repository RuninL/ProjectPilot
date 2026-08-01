import { nowIso } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import {
  getRepositories,
  type TaskProgressRepository,
  type TaskRepository,
} from '@/repositories';
import type { TaskProgressUpdate } from '@/types';
import {
  taskProgressUpdateInputSchema,
  type TaskProgressUpdateInput,
} from './schemas';

export interface TaskProgressServiceDeps {
  progress: TaskProgressRepository;
  tasks: TaskRepository;
}

export function createTaskProgressService(deps: TaskProgressServiceDeps) {
  async function requireTask(taskId: string): Promise<void> {
    if ((await deps.tasks.findById(taskId)) === null) {
      throw new AppError('not_found', '任务不存在或已被删除');
    }
  }

  async function requireUpdate(id: string): Promise<TaskProgressUpdate> {
    const update = await deps.progress.findById(id);
    if (update === null) throw new AppError('not_found', '任务进展不存在或已被删除');
    return update;
  }

  async function validateTotal(
    taskId: string,
    contributionPercent: number,
    excludingId?: string,
  ): Promise<void> {
    const existing = await deps.progress.sumByTask(taskId, excludingId);
    if (existing + contributionPercent > 100) {
      throw new AppError(
        'validation',
        `本次贡献最多可填写 ${String(100 - existing)}%，总进度不能超过 100%`,
      );
    }
  }

  return {
    async list(taskId: string): Promise<TaskProgressUpdate[]> {
      await requireTask(taskId);
      return deps.progress.findByTask(taskId);
    },

    async create(
      taskId: string,
      input: TaskProgressUpdateInput,
    ): Promise<TaskProgressUpdate> {
      await requireTask(taskId);
      const parsed = taskProgressUpdateInputSchema.parse(input);
      await validateTotal(taskId, parsed.contribution_percent);
      const now = nowIso();
      const update: TaskProgressUpdate = {
        id: newId(),
        task_id: taskId,
        ...parsed,
        created_at: now,
        updated_at: now,
      };
      await deps.progress.insert(update);
      return requireUpdate(update.id);
    },

    async update(
      taskId: string,
      id: string,
      input: TaskProgressUpdateInput,
    ): Promise<TaskProgressUpdate> {
      const existing = await requireUpdate(id);
      if (existing.task_id !== taskId) throw new AppError('not_found', '任务进展不属于当前任务');
      const parsed = taskProgressUpdateInputSchema.parse(input);
      await validateTotal(taskId, parsed.contribution_percent, id);
      await deps.progress.update(id, parsed, nowIso());
      return requireUpdate(id);
    },

    async delete(taskId: string, id: string): Promise<void> {
      const existing = await requireUpdate(id);
      if (existing.task_id !== taskId) throw new AppError('not_found', '任务进展不属于当前任务');
      await deps.progress.deleteById(id);
    },
  };
}

export type TaskProgressService = ReturnType<typeof createTaskProgressService>;

export async function getTaskProgressService(): Promise<TaskProgressService> {
  const repositories = await getRepositories();
  return createTaskProgressService({
    progress: repositories.taskProgress,
    tasks: repositories.tasks,
  });
}
