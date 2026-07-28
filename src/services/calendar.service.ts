import { todayHK } from '@/lib/date';
import type {
  MeetingRepository,
  MilestoneRepository,
  ProjectRepository,
  TaskRepository,
} from '@/repositories';
import { getRepositories } from '@/repositories';
import {
  buildCalendarMonth,
  monthGridRange,
  type CalendarMonth,
} from '@/features/calendar/calendarModel';

export interface CalendarServiceDeps {
  tasks: TaskRepository;
  meetings: MeetingRepository;
  milestones: MilestoneRepository;
  projects: ProjectRepository;
}

/**
 * Read-only aggregation for the month view. Four windowed reads, then a pure
 * grid build — the calendar has no write path at all, which is what keeps
 * dragging or accidental rescheduling out of it by construction.
 */
export function createCalendarService(deps: CalendarServiceDeps) {
  return {
    async loadMonth(month: string, today: string = todayHK()): Promise<CalendarMonth> {
      const { from, to } = monthGridRange(month);
      const [tasks, meetings, milestones, projects] = await Promise.all([
        deps.tasks.findInDateRange(from, to),
        deps.meetings.findByDateRange(from, to),
        deps.milestones.findByDateRange(from, to),
        deps.projects.findAll(),
      ]);
      return buildCalendarMonth(month, { tasks, meetings, milestones, projects }, today);
    },
  };
}

export type CalendarService = ReturnType<typeof createCalendarService>;

export async function getCalendarService(): Promise<CalendarService> {
  const repos = await getRepositories();
  return createCalendarService({
    tasks: repos.tasks,
    meetings: repos.meetings,
    milestones: repos.milestones,
    projects: repos.projects,
  });
}
