import { actionItemRowSchema } from '@/db/schemas';
import type { SqlExecutor } from '@/lib/db';
import type { ActionItem } from '@/types';
import { buildUpdate, parseOptional, parseRows, runUpdate } from './_shared';

const UPDATABLE = ['content', 'owner', 'due_date', 'status'] as const;

export function createActionItemRepository(db: SqlExecutor) {
  return {
    async findByMeeting(meetingId: string): Promise<ActionItem[]> {
      const rows = await db.select(
        'SELECT * FROM action_items WHERE meeting_id = ? ORDER BY created_at ASC',
        [meetingId],
      );
      return parseRows(actionItemRowSchema, rows);
    },

    async findById(id: string): Promise<ActionItem | null> {
      const rows = await db.select('SELECT * FROM action_items WHERE id = ?', [id]);
      return parseOptional(actionItemRowSchema, rows);
    },

    /** Reverse lookup of the source action item for a converted task. */
    async findByConvertedTask(taskId: string): Promise<ActionItem | null> {
      const rows = await db.select('SELECT * FROM action_items WHERE converted_task_id = ?', [
        taskId,
      ]);
      return parseOptional(actionItemRowSchema, rows);
    },

    async insert(item: ActionItem): Promise<void> {
      await db.execute(
        `INSERT INTO action_items
          (id, meeting_id, content, owner, due_date, status,
           converted_task_id, converted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.meeting_id,
          item.content,
          item.owner,
          item.due_date,
          item.status,
          item.converted_task_id,
          item.converted_at,
          item.created_at,
          item.updated_at,
        ],
      );
    },

    async update(id: string, patch: Partial<ActionItem>, now: string): Promise<number> {
      return runUpdate(db, buildUpdate('action_items', UPDATABLE, patch, id, now));
    },

    async deleteById(id: string): Promise<number> {
      const result = await db.execute('DELETE FROM action_items WHERE id = ?', [id]);
      return result.rowsAffected;
    },
  };
}

export type ActionItemRepository = ReturnType<typeof createActionItemRepository>;
