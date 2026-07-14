import { taskDependencyRowSchema } from '@/db/schemas';
import type { SqlExecutor } from '@/lib/db';
import type { TaskDependency } from '@/types';
import { parseOptional, parseRows } from './_shared';

export function createTaskDependencyRepository(db: SqlExecutor) {
  return {
    async findByProject(projectId: string): Promise<TaskDependency[]> {
      const rows = await db.select(
        `SELECT d.* FROM task_dependencies d
         JOIN tasks t ON t.id = d.successor_id
         WHERE t.project_id = ?`,
        [projectId],
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
