import { taskChecklistItemRowSchema } from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type { TaskChecklistItem } from '@/types';
import { parseOptional, parseRows } from './_shared';

export function createTaskChecklistRepository(db: SqlExecutor) {
  return {
    async findByTask(taskId: string): Promise<TaskChecklistItem[]> {
      return parseRows(
        taskChecklistItemRowSchema,
        await db.select(
          `SELECT * FROM task_checklist_items
            WHERE task_id = ?
            ORDER BY sort_order ASC, created_at ASC, id ASC`,
          [taskId],
        ),
      );
    },

    async findById(id: string): Promise<TaskChecklistItem | null> {
      return parseOptional(
        taskChecklistItemRowSchema,
        await db.select('SELECT * FROM task_checklist_items WHERE id = ?', [id]),
      );
    },

    async nextSortOrder(taskId: string): Promise<number> {
      const rows = await db.select(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM task_checklist_items WHERE task_id = ?',
        [taskId],
      );
      const next = (rows as { next_order?: unknown }[])[0]?.next_order;
      return typeof next === 'number' ? next : 0;
    },

    async insert(item: TaskChecklistItem): Promise<void> {
      await db.execute(
        `INSERT INTO task_checklist_items
          (id, task_id, content, is_completed, sort_order, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.task_id,
          item.content,
          item.is_completed,
          item.sort_order,
          item.completed_at,
          item.created_at,
          item.updated_at,
        ],
      );
    },

    async update(
      id: string,
      fields: Pick<TaskChecklistItem, 'content' | 'is_completed' | 'completed_at'>,
      now: string,
    ): Promise<number> {
      return (
        await db.execute(
          `UPDATE task_checklist_items
              SET content = ?, is_completed = ?, completed_at = ?, updated_at = ?
            WHERE id = ?`,
          [fields.content, fields.is_completed, fields.completed_at, now, id],
        )
      ).rowsAffected;
    },

    buildReorder(id: string, taskId: string, sortOrder: number, now: string): BatchStatement {
      return {
        sql: `UPDATE task_checklist_items
                 SET sort_order = ?, updated_at = ?
               WHERE id = ? AND task_id = ?`,
        params: [sortOrder, now, id, taskId],
      };
    },

    async deleteById(id: string): Promise<number> {
      return (await db.execute('DELETE FROM task_checklist_items WHERE id = ?', [id])).rowsAffected;
    },
  };
}

export type TaskChecklistRepository = ReturnType<typeof createTaskChecklistRepository>;
