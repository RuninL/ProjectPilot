import { nowIso } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/uuid';
import type { TaskDependencyRepository, TaskRepository } from '@/repositories';
import { getRepositories } from '@/repositories';
import type { Task, TaskDependency } from '@/types';
import {
  buildDependencyGraph,
  deriveBlockedRisks,
  findScheduleConflicts,
  topologicalOrder,
  wouldCreateCycle,
  type BlockedRisk,
  type DependencyGraph,
  type ScheduleConflict,
} from './dependencyGraph';
import { dependencyInputSchema, type DependencyInput } from './schemas';

export interface DependencyServiceDeps {
  tasks: TaskRepository;
  dependencies: TaskDependencyRepository;
}

/** Everything the Gantt and the dependency panel need from one project load. */
export interface ProjectDependencyAnalysis {
  readonly tasks: readonly Task[];
  readonly dependencies: readonly TaskDependency[];
  readonly graph: DependencyGraph;
  readonly conflicts: readonly ScheduleConflict[];
  readonly blockedRisks: readonly BlockedRisk[];
  /** Nodes that could not be ordered. Non-empty only if stored data is cyclic. */
  readonly cyclicTaskIds: readonly string[];
}

export function createDependencyService(deps: DependencyServiceDeps) {
  async function requireTask(id: string): Promise<Task> {
    const task = await deps.tasks.findById(id);
    if (task === null) {
      throw new AppError('not_found', '任务不存在或已被删除');
    }
    return task;
  }

  /**
   * Load a project's tasks and edges, then derive everything read-only from
   * them. Derivation is deliberately recomputed per load rather than cached in
   * the database: blocked risk and schedule conflicts are projections of the
   * current rows, so a date edit or an un-blocked predecessor is reflected on
   * the next read with nothing to invalidate.
   */
  async function analyzeProject(projectId: string): Promise<ProjectDependencyAnalysis> {
    const [tasks, dependencies] = await Promise.all([
      deps.tasks.findByProject(projectId),
      deps.dependencies.findByProject(projectId),
    ]);
    const graph = buildDependencyGraph(tasks, dependencies);
    return {
      tasks,
      dependencies,
      graph,
      conflicts: findScheduleConflicts(graph),
      blockedRisks: deriveBlockedRisks(graph),
      cyclicTaskIds: topologicalOrder(graph).cyclic,
    };
  }

  return {
    analyzeProject,

    /**
     * Create one finish-to-start edge: the successor waits for the predecessor.
     *
     * Every rule is re-checked here even though the UI pre-filters its dropdown,
     * because the dropdown is a convenience and this is the boundary. The
     * database backs the first three (CHECK, UNIQUE, foreign keys) and migration
     * 0003 backs same-project and reversed edges; arbitrary-depth cycles can only
     * be caught here, against the in-memory graph, before the insert.
     */
    async createDependency(input: DependencyInput): Promise<TaskDependency> {
      const parsed = dependencyInputSchema.parse(input);
      if (parsed.predecessor_id === parsed.successor_id) {
        throw new AppError('validation', '任务不能依赖自己');
      }

      const [predecessor, successor] = await Promise.all([
        requireTask(parsed.predecessor_id),
        requireTask(parsed.successor_id),
      ]);

      if (predecessor.project_id !== successor.project_id) {
        throw new AppError('validation', '只能在同一项目内创建任务依赖');
      }
      if (predecessor.archived_at !== null || successor.archived_at !== null) {
        throw new AppError('conflict', '已归档的任务不能新建依赖；请先恢复该任务');
      }

      const existing = await deps.dependencies.findByProject(predecessor.project_id);
      if (
        existing.some(
          (dep) =>
            dep.predecessor_id === parsed.predecessor_id &&
            dep.successor_id === parsed.successor_id,
        )
      ) {
        throw new AppError('conflict', '这两个任务之间已存在依赖');
      }

      const projectTasks = await deps.tasks.findByProject(predecessor.project_id);
      const graph = buildDependencyGraph(projectTasks, existing);
      if (wouldCreateCycle(graph, parsed.predecessor_id, parsed.successor_id)) {
        throw new AppError(
          'validation',
          `会形成循环依赖：「${successor.title}」已经是「${predecessor.title}」的前置任务`,
        );
      }

      const now = nowIso();
      const dependency: TaskDependency = {
        id: newId(),
        predecessor_id: parsed.predecessor_id,
        successor_id: parsed.successor_id,
        dep_type: 'FS',
        lag_days: 0,
        created_at: now,
        updated_at: now,
      };
      await deps.dependencies.insert(dependency);
      return dependency;
    },

    /** Remove one edge. Deleting a dependency never touches either task's status. */
    async deleteDependency(id: string): Promise<void> {
      const existing = await deps.dependencies.findById(id);
      if (existing === null) {
        throw new AppError('not_found', '该依赖不存在或已被删除');
      }
      await deps.dependencies.deleteById(id);
    },
  };
}

export type DependencyService = ReturnType<typeof createDependencyService>;

/** The service bound to the live database. */
export async function getDependencyService(): Promise<DependencyService> {
  const repos = await getRepositories();
  return createDependencyService({
    tasks: repos.tasks,
    dependencies: repos.taskDependencies,
  });
}
