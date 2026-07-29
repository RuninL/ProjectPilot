import { actionItemRowSchema } from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type { ActionItem } from '@/types';
import { buildUpdate, inClause, parseOptional, parseRows, runUpdate } from './_shared';

/**
 * `converted_task_id` and `converted_at` are deliberately absent: they may only
 * be written by the conversion statement below, inside the atomic batch, so a
 * plain edit can never fabricate or clear a conversion.
 */
const UPDATABLE = ['content', 'owner', 'due_date', 'status'] as const;

/**
 * The write half of a conversion. `converted_at IS NULL` in the WHERE clause is
 * the idempotency latch: a second concurrent conversion matches no row, the
 * batch's affected-row count comes back short, and the service aborts the whole
 * transaction — so the task inserted alongside it is rolled back rather than
 * left orphaned.
 */
const CONVERT_SQL = `UPDATE action_items
     SET converted_task_id = ?, converted_at = ?, updated_at = ?
   WHERE id = ? AND converted_at IS NULL AND converted_task_id IS NULL`;

export function createActionItemRepository(db: SqlExecutor) {
  return {
    async findByMeeting(meetingId: string): Promise<ActionItem[]> {
      const rows = await db.select(
        'SELECT * FROM action_items WHERE meeting_id = ? ORDER BY created_at ASC',
        [meetingId],
      );
      return parseRows(actionItemRowSchema, rows);
    },

    /** Unfinished items for a bounded meeting set, for the read-only dashboard. */
    async findUnfinishedByMeetingIds(meetingIds: readonly string[]): Promise<ActionItem[]> {
      if (meetingIds.length === 0) {
        return [];
      }
      const meetings = inClause('meeting_id', meetingIds);
      const rows = await db.select(
        `SELECT * FROM action_items
          WHERE ${meetings.sql} AND status NOT IN ('done', 'cancelled')
          ORDER BY due_date IS NULL, due_date ASC, created_at ASC`,
        meetings.params,
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

    /** Real count of the items a meeting deletion would take with it. */
    async countByMeeting(meetingId: string): Promise<number> {
      const rows = await db.select('SELECT COUNT(*) AS n FROM action_items WHERE meeting_id = ?', [
        meetingId,
      ]);
      const first = (rows as { n?: unknown }[])[0];
      return typeof first?.n === 'number' ? first.n : 0;
    },

    /** Link an action item to the task created for it, only if not yet converted. */
    buildConvertStatement(id: string, taskId: string, now: string): BatchStatement {
      return { sql: CONVERT_SQL, params: [taskId, now, now, id] };
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
