import { taskDependencyRowSchema } from '@/db/schemas';
import type { SqlExecutor } from '@/lib/db';
import type { TaskDependency } from '@/types';
import { parseOptional, parseRows } from './_shared';

export function createTaskDependencyRepository(db: SqlExecutor) {
  return {
    /**
     * Edges with *both* endpoints inside the project. Joining only the successor
     * would leak an inbound cross-project edge into a project-scoped graph,
     * where the missing predecessor node makes traversal silently incomplete.
     * Ordered so graph building — and therefore topological tie-breaks — is
     * reproducible across reads.
     */
    async findByProject(projectId: string): Promise<TaskDependency[]> {
      const rows = await db.select(
        `SELECT d.* FROM task_dependencies d
         JOIN tasks p ON p.id = d.predecessor_id
         JOIN tasks s ON s.id = d.successor_id
         WHERE p.project_id = ? AND s.project_id = ?
         ORDER BY d.created_at ASC, d.id ASC`,
        [projectId, projectId],
      );
      return parseRows(taskDependencyRowSchema, rows);
    },

    /** All edges touching `taskId` in either direction, for the task's own panel. */
    async findByTask(taskId: string): Promise<TaskDependency[]> {
      const rows = await db.select(
        `SELECT * FROM task_dependencies
         WHERE predecessor_id = ? OR successor_id = ?
         ORDER BY created_at ASC, id ASC`,
        [taskId, taskId],
      );
      return parseRows(taskDependencyRowSchema, rows);
    },

    async findAll(): Promise<TaskDependency[]> {
      const rows = await db.select('SELECT * FROM task_dependencies');
      return parseRows(taskDependencyRowSchema, rows);
    },

    async findById(id: string): Promise<TaskDependency | null> {
      const rows = await db.select('SELECT * FROM task_dependencies WHERE id = ?', [id]);
      return parseOptional(taskDependencyRowSchema, rows);
    },

    async insert(dep: TaskDependency): Promise<void> {
      await db.execute(
        `INSERT INTO task_dependencies
          (id, predecessor_id, successor_id, dep_type, lag_days, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          dep.id,
          dep.predecessor_id,
          dep.successor_id,
          dep.dep_type,
          dep.lag_days,
          dep.created_at,
          dep.updated_at,
        ],
      );
    },

    async deleteById(id: string): Promise<number> {
      const result = await db.execute('DELETE FROM task_dependencies WHERE id = ?', [id]);
      return result.rowsAffected;
    },
  };
}

export type TaskDependencyRepository = ReturnType<typeof createTaskDependencyRepository>;
