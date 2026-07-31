import { todayHK } from '@/lib/date';
import { getRepositories } from '@/repositories';
import { getTaskService } from './task.service';

export interface CompanionTodayItem {
  id: string;
  kind: 'meeting' | 'overdue-task' | 'today-task' | 'milestone';
  title: string;
  subtitle: string;
  taskId?: string;
  startsAt?: string;
}

export async function loadCompanionToday(date = todayHK()): Promise<CompanionTodayItem[]> {
  const repos = await getRepositories();
  const [tasks, meetings, milestones, projects] = await Promise.all([
    repos.tasks.findByQuery(),
    repos.meetings.findByDateRange(date, date),
    repos.milestones.findByDateRange(date, date),
    repos.projects.findAll(),
  ]);
  const projectName = new Map(projects.map((project) => [project.id, project.name]));
  return [
    ...meetings.map((meeting) => ({
      id: meeting.id,
      kind: 'meeting' as const,
      title: meeting.topic,
      subtitle: meeting.start_time ?? '今日会议',
      ...(meeting.start_time === null ? {} : { startsAt: meeting.start_time }),
    })),
    ...tasks
      .filter(
        (task) =>
          task.status !== 'done' &&
          task.status !== 'cancelled' &&
          task.due_date !== null &&
          task.due_date < date,
      )
      .map((task) => ({
        id: task.id,
        kind: 'overdue-task' as const,
        title: task.title,
        subtitle: projectName.get(task.project_id) ?? '',
        taskId: task.id,
      })),
    ...tasks
      .filter(
        (task) => task.status !== 'done' && task.status !== 'cancelled' && task.due_date === date,
      )
      .map((task) => ({
        id: task.id,
        kind: 'today-task' as const,
        title: task.title,
        subtitle: projectName.get(task.project_id) ?? '',
        taskId: task.id,
      })),
    ...milestones.map((milestone) => ({
      id: milestone.id,
      kind: 'milestone' as const,
      title: milestone.name,
      subtitle: projectName.get(milestone.project_id) ?? '',
    })),
  ];
}

export async function completeCompanionTask(id: string): Promise<void> {
  await (await getTaskService()).bulkUpdateTasks([id], { status: 'done' });
}
