import { addDays, todayHK } from '@/lib/date';
import type { CalendarEntry } from '@/features/calendar/calendarModel';
import {
  getRepositories,
  type MeetingRepository,
  type MilestoneRepository,
  type ProjectRepository,
  type TaskRepository,
} from '@/repositories';
import { getTaskService } from './task.service';
import { getCalendarService } from './calendar.service';
import type { TaskPriority } from '@/types';

export interface CompanionTodayItem {
  id: string;
  kind: 'meeting' | 'overdue-task' | 'today-task' | 'milestone';
  title: string;
  subtitle: string;
  taskId?: string;
  startsAt?: string;
  completed?: boolean;
}

export interface CompanionDay {
  date: string;
  entries: readonly CalendarEntry[];
}

export interface CompanionQuickTaskInput {
  title: string;
  date: string;
  projectId: string;
  priority: TaskPriority;
  description: string;
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
  const items = await createCompanionService({
    tasks: repos.tasks,
    meetings: repos.meetings,
    milestones: repos.milestones,
    projects: repos.projects,
  }).loadToday(date);
  const [day, completedTasks] = await Promise.all([
    loadCompanionWeek(date).then((days) => days[0]),
    repos.tasks.findInDateRange(date, date),
  ]);
  const completed = completedTasks
    .filter((task) => task.status === 'done')
    .map((task) => ({
      id: task.id,
      kind: 'today-task' as const,
      title: task.title,
      subtitle: task.project_name,
      taskId: task.id,
      completed: true,
    }));
  const recurring =
    day?.entries
      .filter((entry) => entry.recurrence !== null)
      .map((entry) => ({
        id: entry.sourceId,
        kind: entry.kind === 'meeting' ? ('meeting' as const) : ('today-task' as const),
        title: entry.title,
        subtitle: `${entry.detail}${entry.detail === '' ? '' : ' · '}周期`,
      })) ?? [];
  const keys = new Set(items.map((item) => `${item.kind}:${item.id}`));
  return [
    ...items,
    ...recurring.filter((item) => !keys.has(`${item.kind}:${item.id}`)),
    ...completed,
  ];
}

export async function completeCompanionTask(id: string): Promise<void> {
  await (await getTaskService()).bulkUpdateTasks([id], { status: 'done' });
}

export async function reopenCompanionTask(id: string): Promise<void> {
  await (await getTaskService()).bulkUpdateTasks([id], { status: 'todo' });
}

export async function loadCompanionWeek(start = todayHK()): Promise<CompanionDay[]> {
  const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
  const service = await getCalendarService();
  const calendars = await Promise.all(months.map((month) => service.loadCompactMonth(month)));
  const entriesByDate = new Map(
    calendars
      .flatMap((calendar) => calendar.weeks.flat())
      .filter((day) => dates.includes(day.date))
      .map((day) => [day.date, day.entries] as const),
  );
  return dates.map((date) => ({ date, entries: entriesByDate.get(date) ?? [] }));
}

export async function createCompanionTask(input: CompanionQuickTaskInput): Promise<string> {
  const task = await (
    await getTaskService()
  ).createTask({
    project_id: input.projectId,
    parent_task_id: null,
    title: input.title,
    description: input.description,
    status: 'todo',
    priority: input.priority,
    start_date: input.date,
    due_date: input.date,
    progress: 0,
    estimated_hours: null,
    actual_hours: null,
  });
  return task.id;
}

export async function loadCompanionProjectOptions(): Promise<
  readonly { id: string; name: string }[]
> {
  const projects = await (await getRepositories()).projects.findAll();
  return projects
    .filter((project) => project.archived_at === null)
    .map((project) => ({ id: project.id, name: project.name }));
}
