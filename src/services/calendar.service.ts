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
import type { TaskPriority, TaskWithProject } from '@/types';

export interface CalendarServiceDeps {
  tasks: TaskRepository;
  meetings: MeetingRepository;
  milestones: MilestoneRepository;
  projects: ProjectRepository;
  recurrence?: RecurrenceRepository;
}

export interface CalendarAttentionTask {
  readonly task: TaskWithProject;
  readonly labels: readonly string[];
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function taskAttention(task: TaskWithProject, date: string): CalendarAttentionTask | null {
  if (task.status === 'done' || task.status === 'cancelled' || task.archived_at !== null)
    return null;
  const labels = [
    ...(task.status === 'blocked' &&
    ((task.start_date ?? '') <= date || (task.due_date ?? '') < date)
      ? ['受阻任务']
      : []),
    ...(task.due_date !== null && task.due_date < date ? ['已逾期'] : []),
    ...(task.due_date === date ? ['今日截止'] : []),
    ...(task.start_date === date ? ['今日开始'] : []),
    ...(task.start_date !== null &&
    task.due_date !== null &&
    task.start_date <= date &&
    date <= task.due_date
      ? ['今日进行中']
      : []),
  ];
  return labels.length === 0 ? null : { task, labels };
}

function attentionOrder(item: CalendarAttentionTask): readonly number[] {
  return [
    item.labels.includes('受阻任务') ? 0 : 1,
    item.labels.includes('已逾期') ? 0 : 1,
    item.labels.includes('今日截止') ? 0 : 1,
    item.labels.includes('今日开始') ? 0 : 1,
  ];
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
            source_occurrence_date: occurrence.occurrenceDate,
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
                source_occurrence_date: occurrence.occurrenceDate,
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
    async loadAttentionTasks(date: string): Promise<readonly CalendarAttentionTask[]> {
      return (await deps.tasks.findByQuery())
        .map((task) => taskAttention(task, date))
        .filter((item): item is CalendarAttentionTask => item !== null)
        .sort((a, b) => {
          const orderA = attentionOrder(a);
          const orderB = attentionOrder(b);
          for (let index = 0; index < orderA.length; index += 1) {
            const difference = (orderA[index] ?? 0) - (orderB[index] ?? 0);
            if (difference !== 0) return difference;
          }
          return (
            (a.task.due_date ?? '9999-12-31').localeCompare(b.task.due_date ?? '9999-12-31') ||
            PRIORITY_ORDER[a.task.priority] - PRIORITY_ORDER[b.task.priority] ||
            a.task.title.localeCompare(b.task.title, 'zh-CN')
          );
        });
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
