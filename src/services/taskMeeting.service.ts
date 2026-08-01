import { nowIso } from '@/lib/date';
import { AppError } from '@/lib/errors';
import {
  getRepositories,
  type MeetingRepository,
  type TaskMeetingRepository,
  type TaskRepository,
} from '@/repositories';
import type { TaskMeeting } from '@/types';

export interface TaskMeetingServiceDeps {
  taskMeetings: TaskMeetingRepository;
  tasks: TaskRepository;
  meetings: MeetingRepository;
}

/**
 * Task <-> meeting association links. Linking is independent: it never
 * changes the task's project, the meeting's project, or any participant data.
 */
export function createTaskMeetingService(deps: TaskMeetingServiceDeps) {
  async function requireTask(taskId: string): Promise<void> {
    if ((await deps.tasks.findById(taskId)) === null) {
      throw new AppError('not_found', '任务不存在或已被删除');
    }
  }

  return {
    async listByTask(taskId: string): Promise<TaskMeeting[]> {
      await requireTask(taskId);
      return deps.taskMeetings.findByTask(taskId);
    },

    async link(taskId: string, meetingId: string): Promise<TaskMeeting> {
      await requireTask(taskId);
      if ((await deps.meetings.findById(meetingId)) === null) {
        throw new AppError('not_found', '会议不存在或已被删除');
      }
      const existing = await deps.taskMeetings.findByTask(taskId);
      if (existing.some((link) => link.meeting_id === meetingId)) {
        throw new AppError('validation', '该会议已与此任务关联');
      }
      const link: TaskMeeting = { task_id: taskId, meeting_id: meetingId, linked_at: nowIso() };
      await deps.taskMeetings.insert(link);
      return link;
    },

    async unlink(taskId: string, meetingId: string): Promise<void> {
      const removed = await deps.taskMeetings.deleteLink(taskId, meetingId);
      if (removed === 0) {
        throw new AppError('not_found', '关联不存在或已被移除');
      }
    },
  };
}

export type TaskMeetingService = ReturnType<typeof createTaskMeetingService>;

export async function getTaskMeetingService(): Promise<TaskMeetingService> {
  const repositories = await getRepositories();
  return createTaskMeetingService({
    taskMeetings: repositories.taskMeetings,
    tasks: repositories.tasks,
    meetings: repositories.meetings,
  });
}
