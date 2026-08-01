import { meetingRowSchema, taskMeetingRowSchema, taskWithProjectRowSchema } from '@/db/schemas';
import type { BatchStatement } from '@/lib/commands';
import type { SqlExecutor } from '@/lib/db';
import type { Meeting, TaskMeeting, TaskWithProject } from '@/types';
import { parseRows } from './_shared';

const INSERT_SQL =
  'INSERT OR IGNORE INTO task_meetings (task_id, meeting_id, linked_at) VALUES (?, ?, ?)';

export function createTaskMeetingRepository(db: SqlExecutor) {
  return {
    async findByTask(taskId: string): Promise<TaskMeeting[]> {
      const rows = await db.select(
        'SELECT * FROM task_meetings WHERE task_id = ? ORDER BY linked_at ASC, meeting_id ASC',
        [taskId],
      );
      return parseRows(taskMeetingRowSchema, rows);
    },

    async findByMeeting(meetingId: string): Promise<TaskMeeting[]> {
      const rows = await db.select(
        'SELECT * FROM task_meetings WHERE meeting_id = ? ORDER BY linked_at ASC, task_id ASC',
        [meetingId],
      );
      return parseRows(taskMeetingRowSchema, rows);
    },

    async findMeetingsByTask(taskId: string): Promise<Meeting[]> {
      const rows = await db.select(
        `SELECT m.*
           FROM task_meetings tm
           JOIN meetings m ON m.id = tm.meeting_id
          WHERE tm.task_id = ?
          ORDER BY tm.linked_at ASC, m.id ASC`,
        [taskId],
      );
      return parseRows(meetingRowSchema, rows);
    },

    async findTasksByMeeting(meetingId: string): Promise<TaskWithProject[]> {
      const rows = await db.select(
        `SELECT t.*, p.name AS project_name, p.color AS project_color, p.status AS project_status
           FROM task_meetings tm
           JOIN tasks t ON t.id = tm.task_id
           JOIN projects p ON p.id = t.project_id
          WHERE tm.meeting_id = ?
          ORDER BY tm.linked_at ASC, t.id ASC`,
        [meetingId],
      );
      return parseRows(taskWithProjectRowSchema, rows);
    },

    async insert(link: TaskMeeting): Promise<boolean> {
      const result = await db.execute(INSERT_SQL, [
        link.task_id,
        link.meeting_id,
        link.linked_at,
      ]);
      return result.rowsAffected > 0;
    },

    buildInsert(link: TaskMeeting): BatchStatement {
      return {
        sql: INSERT_SQL,
        params: [link.task_id, link.meeting_id, link.linked_at],
      };
    },

    async deleteLink(taskId: string, meetingId: string): Promise<number> {
      const result = await db.execute(
        'DELETE FROM task_meetings WHERE task_id = ? AND meeting_id = ?',
        [taskId, meetingId],
      );
      return result.rowsAffected;
    },
  };
}

export type TaskMeetingRepository = ReturnType<typeof createTaskMeetingRepository>;
