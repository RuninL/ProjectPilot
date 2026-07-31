import { todayHK } from '@/lib/date';
import {
  getRepositories,
  type MeetingRepository,
  type MilestoneRepository,
  type ProjectRepository,
  type TaskRepository,
} from '@/repositories';
import { getTaskService } from './task.service';

export interface CompanionTodayItem {
  id: string;
  kind: 'meeting' | 'overdue-task' | 'today-task' | 'milestone';
  title: string;
  subtitle: string;
  taskId?: string;
  startsAt?: string;
}

export interface CompanionServiceDeps {
  tasks: Pick<TaskRepository, 'findForCompanionToday'>;
  meetings: Pick<MeetingRepository, 'findByDateRange'>;
  milestones: Pick<MilestoneRepository, 'findByDateRange'>;
  projects: Pick<ProjectRepository, 'findAll'>;
}

type CompanionTask = Awaited<ReturnType<TaskRepository['findForCompanionToday']>>[number];

function isTodayTask(task: CompanionTask, date: string): boolean {
  if (task.due_date === date || task.start_date === date) return true;
  return (
    task.start_date !== null &&
    task.due_date !== null &&
    task.start_date <= date &&
    date <= task.due_date
  );
}

export function createCompanionService(deps: CompanionServiceDeps) {
  return {
    async loadToday(date = todayHK()): Promise<CompanionTodayItem[]> {
      const [tasks, meetings, milestones, projects] = await Promise.all([
        deps.tasks.findForCompanionToday(date),
        deps.meetings.findByDateRange(date, date),
        deps.milestones.findByDateRange(date, date),
        deps.projects.findAll(),
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
          .filter((task) => task.due_date !== null && task.due_date < date)
          .map((task) => ({
            id: task.id,
            kind: 'overdue-task' as const,
            title: task.title,
            subtitle: projectName.get(task.project_id) ?? '',
            taskId: task.id,
          })),
        ...tasks
          .filter((task) => isTodayTask(task, date))
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
    },
  };
}

export type CompanionService = ReturnType<typeof createCompanionService>;

export async function loadCompanionToday(date = todayHK()): Promise<CompanionTodayItem[]> {
  const repos = await getRepositories();
  return createCompanionService({
    tasks: repos.tasks,
    meetings: repos.meetings,
    milestones: repos.milestones,
    projects: repos.projects,
  }).loadToday(date);
}

export async function completeCompanionTask(id: string): Promise<void> {
  await (await getTaskService()).bulkUpdateTasks([id], { status: 'done' });
}
