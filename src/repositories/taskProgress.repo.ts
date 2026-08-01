import { taskProgressUpdateRowSchema } from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type { TaskProgressUpdate } from '@/types';
import { buildUpdate, parseOptional, parseRows, runUpdate } from './_shared';

const UPDATABLE = ['title', 'description', 'occurred_at', 'contribution_percent'] as const;

export function createTaskProgressRepository(db: SqlExecutor) {
  return {
    async findByTask(taskId: string): Promise<TaskProgressUpdate[]> {
      return parseRows(
        taskProgressUpdateRowSchema,
        await db.select(
          `SELECT * FROM task_progress_updates
            WHERE task_id = ?
            ORDER BY occurred_at DESC, created_at DESC, id ASC`,
          [taskId],
        ),
      );
    },

    async findById(id: string): Promise<TaskProgressUpdate | null> {
      return parseOptional(
        taskProgressUpdateRowSchema,
        await db.select('SELECT * FROM task_progress_updates WHERE id = ?', [id]),
      );
    },

    async sumByTask(taskId: string, excludingId?: string): Promise<number> {
      const rows = await db.select(
        `SELECT COALESCE(SUM(contribution_percent), 0) AS total
           FROM task_progress_updates
          WHERE task_id = ?${excludingId === undefined ? '' : ' AND id <> ?'}`,
        excludingId === undefined ? [taskId] : [taskId, excludingId],
      );
      const total = (rows as { total?: unknown }[])[0]?.total;
      return typeof total === 'number' ? total : 0;
    },

    async insert(update: TaskProgressUpdate): Promise<void> {
      const statement = this.buildInsert(update);
      await db.execute(statement.sql, statement.params);
    },

    buildInsert(update: TaskProgressUpdate): BatchStatement {
      return {
        sql: `INSERT INTO task_progress_updates
          (id, task_id, title, description, occurred_at, contribution_percent, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          update.id,
          update.task_id,
          update.title,
          update.description,
          update.occurred_at,
          update.contribution_percent,
          update.created_at,
          update.updated_at,
        ],
      };
    },

    async update(id: string, patch: Partial<TaskProgressUpdate>, now: string): Promise<number> {
      return runUpdate(db, buildUpdate('task_progress_updates', UPDATABLE, patch, id, now));
    },

    async deleteById(id: string): Promise<number> {
      return (await db.execute('DELETE FROM task_progress_updates WHERE id = ?', [id]))
        .rowsAffected;
    },
  };
}

export type TaskProgressRepository = ReturnType<typeof createTaskProgressRepository>;
