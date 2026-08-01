import { taskMeetingRowSchema } from '@/db/schemas';
import type { SqlExecutor } from '@/lib/db';
import type { TaskMeeting } from '@/types';
import { parseRows } from './_shared';

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

    async insert(link: TaskMeeting): Promise<void> {
      await db.execute(
        'INSERT INTO task_meetings (task_id, meeting_id, linked_at) VALUES (?, ?, ?)',
        [link.task_id, link.meeting_id, link.linked_at],
      );
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
