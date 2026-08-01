import type { BatchStatement } from '@/lib/commands';
import { executeBatch } from '@/lib/commands';
import { nowIso } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import type { ProjectRepository, TaskQuery, TaskRepository } from '@/repositories';
import { getRepositories } from '@/repositories';
import type { Project, Task, TaskWithProject } from '@/types';
import {
  bulkTaskUpdateSchema,
  taskInputSchema,
  type BulkTaskUpdate,
  type TaskInput,
} from './schemas';

export interface TaskServiceDeps {
  tasks: TaskRepository;
  projects: ProjectRepository;
  runBatch: (statements: BatchStatement[]) => Promise<number>;
}

/**
 * Status/progress coupling, applied on every write so the two can never drift:
 *
 *  - entering `done` forces progress to 100 and stamps `completed_at` if empty;
 *  - leaving `done` clears `completed_at` but keeps progress, so a task reopened
 *    by mistake does not silently lose its recorded work and stays editable.
 */
function applyStatusRules(
  status: Task['status'],
  progress: number,
  previous: Task | null,
  now: string,
): { status: Task['status']; progress: number; completed_at: string | null } {
  if (status === 'done') {
    return { status, progress: 100, completed_at: previous?.completed_at ?? now };
  }
  return { status, progress, completed_at: null };
}

export function createTaskService(deps: TaskServiceDeps) {
  async function requireTask(id: string): Promise<Task> {
    const task = await deps.tasks.findById(id);
    if (task === null) {
      throw new AppError('not_found', '任务不存在或已被删除');
    }
    return task;
  }

  async function requireOpenProject(projectId: string): Promise<Project> {
    const project = await deps.projects.findById(projectId);
    if (project === null) {
      throw new AppError('not_found', '所属项目不存在或已被删除');
    }
    if (project.archived_at !== null) {
      throw new AppError('conflict', '项目已归档，无法新建任务；请先恢复该项目');
    }
    return project;
  }

  /**
   * Frontend half of the hierarchy rules. The migration 0002 triggers enforce
   * the same invariants at the database level; this layer exists to produce a
   * readable Chinese message instead of a raw `SELF_PARENT` abort.
   */
  async function validateParent(
    parentTaskId: string | null,
    projectId: string,
    selfId: string | null,
  ): Promise<void> {
    if (parentTaskId === null) {
      return;
    }
    if (parentTaskId === selfId) {
      throw new AppError('validation', '任务不能将自己设为父任务');
    }
    const parent = await deps.tasks.findById(parentTaskId);
    if (parent === null) {
      throw new AppError('validation', '父任务不存在');
    }
    if (parent.project_id !== projectId) {
      throw new AppError('validation', '父任务必须属于同一个项目');
    }
    if (parent.parent_task_id !== null) {
      throw new AppError('validation', '任务层级最多两层，不能在子任务下继续创建子任务');
    }
    if (selfId !== null && (await deps.tasks.countChildren(selfId)) > 0) {
      throw new AppError('validation', '该任务已有子任务，不能再成为其他任务的子任务');
    }
  }

  return {
    async listTasks(query: TaskQuery = {}): Promise<TaskWithProject[]> {
      return deps.tasks.findByQuery(query);
    },

    async getTask(id: string): Promise<Task> {
      return requireTask(id);
    },

    async createTask(input: TaskInput): Promise<Task> {
      const parsed = taskInputSchema.parse(input);
      await requireOpenProject(parsed.project_id);
      await validateParent(parsed.parent_task_id, parsed.project_id, null);

      const now = nowIso();
      const rules = applyStatusRules(parsed.status, parsed.progress, null, now);
      const task: Task = {
        id: newId(),
        project_id: parsed.project_id,
        parent_task_id: parsed.parent_task_id,
        title: parsed.title,
        description: parsed.description,
        status: rules.status,
        priority: parsed.priority,
        start_date: parsed.start_date,
        due_date: parsed.due_date,
        progress: rules.progress,
        estimated_hours: parsed.estimated_hours,
        actual_hours: parsed.actual_hours,
        completed_at: rules.completed_at,
        archived_at: null,
        archived_source: null,
        source_meeting_id: null,
        source_rule_id: null,
        source_occurrence_date: null,
        is_sample: 0,
        created_at: now,
        updated_at: now,
      };
      await deps.tasks.insert(task);
      return task;
    },

    async updateTask(id: string, input: TaskInput): Promise<Task> {
      const existing = await requireTask(id);
      const parsed = taskInputSchema.parse(input);
      if (parsed.project_id !== existing.project_id) {
        throw new AppError('validation', '任务不能移动到其他项目');
      }
      await validateParent(parsed.parent_task_id, parsed.project_id, id);

      const now = nowIso();
      const rules = applyStatusRules(parsed.status, parsed.progress, existing, now);
      await deps.tasks.update(
        id,
        {
          parent_task_id: parsed.parent_task_id,
          title: parsed.title,
          description: parsed.description,
          status: rules.status,
          priority: parsed.priority,
          start_date: parsed.start_date,
          due_date: parsed.due_date,
          progress: rules.progress,
          estimated_hours: parsed.estimated_hours,
          actual_hours: parsed.actual_hours,
          completed_at: rules.completed_at,
        },
        now,
      );
      return requireTask(id);
    },

    /** Direct children of a task; also what the delete guard counts. */
    async countChildren(id: string): Promise<number> {
      return deps.tasks.countChildren(id);
    },

    /** Manual archive; distinct from the automatic project-archive cascade. */
    async archiveTask(id: string): Promise<void> {
      const task = await requireTask(id);
      if (task.archived_at !== null) {
        return;
      }
      const now = nowIso();
      await deps.tasks.update(id, { archived_at: now, archived_source: 'manual' }, now);
    },

    /**
     * Explicit user restore. Clearing archived_source means a later
     * "restore project and tasks" can never override this user decision.
     */
    async restoreTask(id: string): Promise<void> {
      const task = await requireTask(id);
      if (task.archived_at === null) {
        return;
      }
      const project = await deps.projects.findById(task.project_id);
      if (project !== null && project.archived_at !== null) {
        throw new AppError('conflict', '所属项目已归档，请先恢复该项目');
      }
      await deps.tasks.update(id, { archived_at: null, archived_source: null }, nowIso());
    },

    /**
     * Deleting a parent is refused rather than silently cascading, so a whole
     * sub-tree can never disappear behind one click. The schema's ON DELETE
     * CASCADE remains only as a backstop for deletes that bypass this layer.
     */
    async deleteTask(id: string): Promise<void> {
      await requireTask(id);
      const children = await deps.tasks.countChildren(id);
      if (children > 0) {
        throw new AppError(
          'conflict',
          `该任务下还有 ${String(children)} 个子任务，请先删除或移出子任务后再删除`,
        );
      }
      await deps.tasks.deleteById(id);
    },

    /**
     * Apply the same patch to many tasks in ONE transaction via the Rust
     * `execute_batch` command. Never a per-row update loop: a failure halfway
     * through must roll every row back.
     */
    async bulkUpdateTasks(ids: readonly string[], patch: BulkTaskUpdate): Promise<number> {
      if (ids.length === 0) {
        throw new AppError('validation', '请先选择要修改的任务');
      }
      const parsed = bulkTaskUpdateSchema.parse(patch);
      const now = nowIso();

      const statements: BatchStatement[] = [];
      for (const id of ids) {
        const existing = await requireTask(id);
        const fields: Partial<Task> = {};
        if (parsed.priority !== undefined) {
          fields.priority = parsed.priority;
        }
        if (parsed.due_date !== undefined) {
          fields.due_date = parsed.due_date;
        }
        if (parsed.status !== undefined) {
          const rules = applyStatusRules(parsed.status, existing.progress, existing, now);
          fields.status = rules.status;
          fields.progress = rules.progress;
          fields.completed_at = rules.completed_at;
        }
        const statement = deps.tasks.buildUpdateStatement(id, fields, now);
        if (statement !== null) {
          statements.push(statement);
        }
      }
      if (statements.length === 0) {
        return 0;
      }
      return deps.runBatch(statements);
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;

export async function getTaskService(): Promise<TaskService> {
  const repos = await getRepositories();
  return createTaskService({
    tasks: repos.tasks,
    projects: repos.projects,
    runBatch: executeBatch,
  });
}
