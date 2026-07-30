import { todayHK } from '@/lib/date';
import type {
  MeetingRepository,
  MilestoneRepository,
  ProjectRepository,
  RecurrenceRepository,
  TaskRepository,
} from '@/repositories';
import { expandRule } from './recurrence.service';
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
  recurrence?: RecurrenceRepository;
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
      const rules =
        deps.recurrence === undefined
          ? []
          : await deps.recurrence.findActiveByProjectIds(projects.map((project) => project.id));
      const expansions = await Promise.all(
        rules.map(async (rule) => ({
          rule,
          result: expandRule(
            rule,
            from,
            to,
            null,
            deps.recurrence === undefined ? [] : await deps.recurrence.findExceptions(rule.id),
          ),
        })),
      );
      const recurringTasks = expansions.flatMap(({ rule, result }) => {
        if (rule.kind !== 'task' || rule.project_id === null) return [];
        const projectId = rule.project_id;
        return result.occurrences
          .filter((occurrence) => occurrence.materialized_id === null)
          .map((occurrence) => ({
            id: `expected:${rule.id}:${occurrence.date}`,
            project_id: projectId,
            parent_task_id: null,
            title: rule.title,
            description: rule.note,
            status: 'todo' as const,
            priority: rule.default_priority ?? 'medium',
            start_date: occurrence.date,
            due_date: occurrence.date,
            progress: 0,
            estimated_hours: null,
            actual_hours: null,
            completed_at: null,
            archived_at: null,
            source_meeting_id: null,
            source_rule_id: rule.id,
            source_occurrence_date: occurrence.date,
            is_sample: 0 as const,
            created_at: rule.created_at,
            updated_at: rule.updated_at,
            project_name: projects.find((project) => project.id === rule.project_id)?.name ?? '',
            project_color:
              projects.find((project) => project.id === rule.project_id)?.color ?? '#64748b',
            project_status:
              projects.find((project) => project.id === rule.project_id)?.status ?? 'active',
          }));
      });
      const recurringMeetings = expansions.flatMap(({ rule, result }) =>
        rule.kind === 'meeting'
          ? result.occurrences
              .filter((occurrence) => occurrence.materialized_id === null)
              .map((occurrence) => ({
                id: `expected:${rule.id}:${occurrence.date}`,
                project_id: rule.project_id,
                topic: rule.title,
                date: occurrence.date,
                start_time: rule.time_of_day,
                attendees: '[]',
                agenda: rule.note,
                notes: '',
                decisions: '',
                risks: '',
                source_rule_id: rule.id,
                source_occurrence_date: occurrence.date,
                is_sample: 0 as const,
                created_at: rule.created_at,
                updated_at: rule.updated_at,
              }))
          : [],
      );
      return buildCalendarMonth(
        month,
        {
          tasks: [...tasks, ...recurringTasks],
          meetings: [...meetings, ...recurringMeetings],
          milestones,
          projects,
          recurrenceTruncated: expansions.some(({ result }) => result.truncated),
        },
        today,
      );
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
    recurrence: repos.recurrence,
  });
}
