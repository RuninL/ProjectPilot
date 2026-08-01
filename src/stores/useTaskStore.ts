import { create } from 'zustand';
import { toAppError } from '@/lib/errors';
import type { TaskQuery } from '@/repositories';
import type { BulkTaskUpdate, TaskInput } from '@/services/schemas';
import { getTaskService, type TaskService } from '@/services/task.service';
import type { Task, TaskWithProject } from '@/types';

interface TaskState {
  tasks: TaskWithProject[];
  loading: boolean;
  error: string | null;
  loadTasks: (query: TaskQuery) => Promise<void>;
  /** Read-only fetch of a project's tasks, for parent-task candidate lists. */
  listByProject: (projectId: string) => Promise<TaskWithProject[]>;
  /** Read-only child count, shown before a delete is attempted. */
  countChildren: (id: string) => Promise<number>;
  createTask: (input: TaskInput, query: TaskQuery) => Promise<Task>;
  updateTask: (id: string, input: TaskInput, query: TaskQuery) => Promise<Task>;
  deleteTask: (id: string, query: TaskQuery) => Promise<void>;
  bulkUpdateTasks: (
    ids: readonly string[],
    patch: BulkTaskUpdate,
    query: TaskQuery,
  ) => Promise<void>;
  /** Manual archive — recorded as archived_source = 'manual'. */
  archiveTask: (id: string, query: TaskQuery) => Promise<void>;
  restoreTask: (id: string, query: TaskQuery) => Promise<void>;
}

/**
 * Task list state. The active query is passed in by the caller rather than kept
 * here, so the same store serves the cross-project view and a single project's
 * task list without either one clobbering the other's filters.
 */
export const useTaskStore = create<TaskState>((set, get) => {
  async function mutate(
    query: TaskQuery,
    run: (service: TaskService) => Promise<unknown>,
  ): Promise<void> {
    const service = await getTaskService();
    await run(service);
    await get().loadTasks(query);
  }

  return {
    tasks: [],
    loading: false,
    error: null,

    loadTasks: async (query) => {
      set({ loading: true, error: null });
      try {
        const service = await getTaskService();
        set({ tasks: await service.listTasks(query), loading: false });
      } catch (caught) {
        set({ error: toAppError(caught).message, loading: false });
      }
    },

    listByProject: async (projectId) => {
      const service = await getTaskService();
      return service.listTasks({ projectIds: [projectId], sort: 'created_at' });
    },

    countChildren: async (id) => {
      const service = await getTaskService();
      return service.countChildren(id);
    },

    createTask: async (input, query) => {
      const service = await getTaskService();
      const task = await service.createTask(input);
      await get().loadTasks(query);
      return task;
    },

    updateTask: async (id, input, query) => {
      const service = await getTaskService();
      const task = await service.updateTask(id, input);
      await get().loadTasks(query);
      return task;
    },

    deleteTask: async (id, query) => {
      await mutate(query, (service) => service.deleteTask(id));
    },

    bulkUpdateTasks: async (ids, patch, query) => {
      await mutate(query, (service) => service.bulkUpdateTasks(ids, patch));
    },

    archiveTask: async (id, query) => {
      await mutate(query, (service) => service.archiveTask(id));
    },

    restoreTask: async (id, query) => {
      await mutate(query, (service) => service.restoreTask(id));
    },
  };
});
