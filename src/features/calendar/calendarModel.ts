import { addDays, formatMonthLabel, inclusiveDays, startOfWeekStr, todayHK } from '@/lib/date';
import type { Meeting, Milestone, Project, TaskWithProject } from '@/types';

/**
 * Pure month-grid construction. The calendar is strictly read-only: it derives
 * everything from rows the service already loaded and never writes, so no
 * rescheduling or status change can originate here.
 *
 * A month is identified by its 'YYYY-MM' prefix so month arithmetic stays
 * integer arithmetic and never touches `new Date('YYYY-MM-DD')`.
 */

/** Fixed six-week grid keeps the layout from jumping between months. */
const WEEKS_IN_GRID = 6;
const DAYS_IN_WEEK = 7;

export type CalendarEntryKind = 'task' | 'meeting' | 'milestone';

export interface CalendarEntry {
  /** Unique within the grid: one task can appear on both its start and due day. */
  readonly key: string;
  readonly kind: CalendarEntryKind;
  readonly sourceId: string;
  readonly date: string;
  readonly title: string;
  /** Type shown as text, so the three kinds are never distinguished by colour alone. */
  readonly kindLabel: string;
  /** Secondary line: project name, meeting time, milestone status. */
  readonly detail: string;
  /** Hash-router target for click-through to the detail view. */
  readonly href: string;
  /** Project colour, decoration only — never the sole carrier of meaning. */
  readonly color: string | null;
  /** Present for recurrence-derived meetings so the calendar can expose occurrence actions. */
  readonly recurrence: {
    readonly ruleId: string;
    readonly occurrenceDate: string;
  } | null;
}

export interface CalendarDay {
  readonly date: string;
  readonly dayOfMonth: number;
  /** False for the leading/trailing days borrowed from the adjacent months. */
  readonly inMonth: boolean;
  readonly isToday: boolean;
  readonly entries: readonly CalendarEntry[];
}

export interface CalendarMonth {
  /** 'YYYY-MM' */
  readonly month: string;
  /** '2026年7月' */
  readonly label: string;
  /** First and last day of the rendered grid — also the query window. */
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly weeks: readonly (readonly CalendarDay[])[];
  /** Entries inside the month proper, for the empty state. */
  readonly entryCount: number;
  readonly recurrenceTruncated: boolean;
  readonly colorBar: CalendarColorBarModel;
}

export interface CalendarData {
  readonly tasks: readonly TaskWithProject[];
  readonly meetings: readonly Meeting[];
  readonly milestones: readonly Milestone[];
  /** Used to name and colour milestones, which are stored without a join. */
  readonly projects: readonly Project[];
  readonly recurrenceTruncated?: boolean;
}

export interface CalendarColorBar {
  readonly id: string;
  readonly taskId: string;
  readonly title: string;
  readonly projectName: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly displayStart: string;
  readonly displayEnd: string;
  readonly lane: number;
  readonly color: string;
  readonly status: TaskWithProject['status'];
  readonly statusLabel: string;
  readonly href: string;
  readonly recurrence: CalendarEntry['recurrence'];
}

export interface CalendarColorBarEvent {
  readonly id: string;
  readonly date: string;
  readonly kind: Exclude<CalendarEntryKind, 'task'>;
  readonly kindLabel: string;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly color: string;
  readonly recurrence: CalendarEntry['recurrence'];
}

export interface CalendarColorBarModel {
  readonly dates: readonly string[];
  readonly lanes: readonly (readonly CalendarColorBar[])[];
  readonly unscheduledTasks: readonly TaskWithProject[];
  readonly events: readonly CalendarColorBarEvent[];
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const DEFAULT_CALENDAR_BAR_COLOR = '#64748b';

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Shift a 'YYYY-MM' by whole months; crosses year boundaries by construction. */
export function shiftMonth(month: string, delta: number): string {
  if (!MONTH_RE.test(month)) {
    throw new Error(`无效月份：${month}`);
  }
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  const shiftedYear = year + Math.floor(index / 12);
  const shiftedMonth = ((index % 12) + 12) % 12;
  return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth + 1).padStart(2, '0')}`;
}

/** The six-week window a month is rendered in, Monday-first. */
export function monthGridRange(month: string): { from: string; to: string } {
  const from = startOfWeekStr(`${month}-01`);
  return { from, to: addDays(from, WEEKS_IN_GRID * DAYS_IN_WEEK - 1) };
}

const KIND_LABELS: Record<CalendarEntryKind, string> = {
  task: '任务',
  meeting: '会议',
  milestone: '里程碑',
};

const MILESTONE_STATUS_LABELS: Record<Milestone['status'], string> = {
  upcoming: '待达成',
  achieved: '已达成',
  missed: '已错过',
  cancelled: '已取消',
};

/** Meetings read first, then milestones, then tasks; ties broken by title. */
const KIND_ORDER: Record<CalendarEntryKind, number> = { meeting: 0, milestone: 1, task: 2 };

function taskEntries(tasks: readonly TaskWithProject[]): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  for (const task of tasks) {
    const href = `/tasks?taskId=${encodeURIComponent(task.id)}`;
    if (task.due_date !== null) {
      entries.push({
        key: `task-due:${task.id}`,
        kind: 'task',
        sourceId: task.id,
        date: task.due_date,
        title: task.title,
        kindLabel: '任务截止',
        detail: task.project_name,
        href,
        color: task.project_color,
        recurrence:
          task.source_rule_id === null || task.source_occurrence_date === null
            ? null
            : {
                ruleId: task.source_rule_id,
                occurrenceDate: task.source_occurrence_date,
              },
      });
    }
    // A same-day start and due collapse into the single截止 entry above.
    if (task.start_date !== null && task.start_date !== task.due_date) {
      entries.push({
        key: `task-start:${task.id}`,
        kind: 'task',
        sourceId: task.id,
        date: task.start_date,
        title: task.title,
        kindLabel: '任务开始',
        detail: task.project_name,
        href,
        color: task.project_color,
        recurrence: null,
      });
    }
  }
  return entries;
}

function meetingEntries(
  meetings: readonly Meeting[],
  projectsById: ReadonlyMap<string, Project>,
): CalendarEntry[] {
  return meetings.map((meeting) => {
    const project = meeting.project_id === null ? undefined : projectsById.get(meeting.project_id);
    const parts = [meeting.start_time, project?.name ?? '独立会议'].filter(
      (part): part is string => part !== null && part !== '',
    );
    return {
      key: `meeting:${meeting.id}`,
      kind: 'meeting',
      sourceId: meeting.id,
      date: meeting.date,
      title: meeting.topic,
      kindLabel: meeting.source_rule_id === null ? KIND_LABELS.meeting : '周期会议',
      detail: parts.join(' · '),
      href:
        meeting.source_rule_id === null
          ? `/meetings/${encodeURIComponent(meeting.id)}`
          : `/meetings?series=${encodeURIComponent(meeting.source_rule_id)}`,
      color: project?.color ?? null,
      recurrence:
        meeting.source_rule_id === null || meeting.source_occurrence_date === null
          ? null
          : {
              ruleId: meeting.source_rule_id,
              occurrenceDate: meeting.source_occurrence_date,
            },
    };
  });
}

function milestoneEntries(
  milestones: readonly Milestone[],
  projectsById: ReadonlyMap<string, Project>,
): CalendarEntry[] {
  return milestones.map((milestone) => {
    const project = projectsById.get(milestone.project_id);
    return {
      key: `milestone:${milestone.id}`,
      kind: 'milestone',
      sourceId: milestone.id,
      date: milestone.date,
      title: milestone.name,
      kindLabel: KIND_LABELS.milestone,
      detail: [MILESTONE_STATUS_LABELS[milestone.status], project?.name]
        .filter((part): part is string => part !== undefined)
        .join(' · '),
      href: `/projects/${encodeURIComponent(milestone.project_id)}#project-milestones`,
      color: project?.color ?? null,
      recurrence: null,
    };
  });
}

const TASK_STATUS_LABELS: Record<TaskWithProject['status'], string> = {
  todo: '待办',
  in_progress: '进行中',
  blocked: '受阻',
  postponed: '已延期',
  done: '已完成',
  cancelled: '已取消',
};

/** Restrict decorative project colours to literal hex values before applying inline styles. */
export function safeCalendarColor(color: string | null | undefined): string {
  return color !== null && color !== undefined && HEX_COLOR_RE.test(color)
    ? color
    : DEFAULT_CALENDAR_BAR_COLOR;
}

function taskInterval(task: TaskWithProject): { start: string; end: string } | null {
  if (task.start_date === null && task.due_date === null) return null;
  if (task.start_date === null) return { start: task.due_date as string, end: task.due_date as string };
  if (task.due_date === null) return { start: task.start_date, end: task.start_date };
  // Legacy inverted dates are displayed as a safe single-day task rather than corrupting the lane layout.
  if (task.start_date > task.due_date) return { start: task.start_date, end: task.start_date };
  return { start: task.start_date, end: task.due_date };
}

/**
 * Builds clipped, deterministically packed task intervals for the continuous colour-bar timeline.
 * The source tasks remain untouched; clipping only affects this visible range.
 */
export function buildCalendarColorBar(
  data: CalendarData,
  rangeStart: string,
  rangeEnd: string,
  entries: readonly CalendarEntry[] = [],
): CalendarColorBarModel {
  const unscheduledTasks = data.tasks.filter((task) => taskInterval(task) === null);
  const candidates = data.tasks
    .flatMap((task) => {
      const interval = taskInterval(task);
      if (interval === null || interval.end < rangeStart || interval.start > rangeEnd) return [];
      return [
        {
          task,
          start: interval.start < rangeStart ? rangeStart : interval.start,
          end: interval.end > rangeEnd ? rangeEnd : interval.end,
        },
      ];
    })
    .sort((a, b) => {
      const durationA = inclusiveDays(a.start, a.end);
      const durationB = inclusiveDays(b.start, b.end);
      return (
        a.start.localeCompare(b.start) ||
        durationB - durationA ||
        a.end.localeCompare(b.end) ||
        a.task.project_id.localeCompare(b.task.project_id) ||
        a.task.title.localeCompare(b.task.title, 'zh-CN') ||
        a.task.id.localeCompare(b.task.id)
      );
    });
  const laneEnds: string[] = [];
  const lanes: CalendarColorBar[][] = [];
  for (const candidate of candidates) {
    let lane = laneEnds.findIndex((end) => end < candidate.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(candidate.end);
      lanes.push([]);
    } else {
      laneEnds[lane] = candidate.end;
    }
    const { task } = candidate;
    lanes[lane]?.push({
      id: `task-bar:${task.id}`,
      taskId: task.id,
      title: task.title,
      projectName: task.project_name,
      startDate: task.start_date ?? task.due_date ?? '',
      endDate: task.due_date ?? task.start_date ?? '',
      displayStart: candidate.start,
      displayEnd: candidate.end,
      lane,
      color: safeCalendarColor(task.project_color),
      status: task.status,
      statusLabel: TASK_STATUS_LABELS[task.status],
      href: `/tasks?taskId=${encodeURIComponent(task.id)}`,
      recurrence:
        task.source_rule_id === null || task.source_occurrence_date === null
          ? null
          : { ruleId: task.source_rule_id, occurrenceDate: task.source_occurrence_date },
    });
  }
  const events = entries
    .filter(
      (entry): entry is CalendarEntry & { kind: Exclude<CalendarEntryKind, 'task'> } =>
        entry.kind !== 'task' && entry.date >= rangeStart && entry.date <= rangeEnd,
    )
    .map((entry) => ({
      id: `calendar-event:${entry.key}`,
      date: entry.date,
      kind: entry.kind,
      kindLabel: entry.kindLabel,
      title: entry.title,
      detail: entry.detail,
      href: entry.href,
      color: safeCalendarColor(entry.color),
      recurrence: entry.recurrence,
    }));
  const dates = Array.from({ length: inclusiveDays(rangeStart, rangeEnd) }, (_, index) =>
    addDays(rangeStart, index),
  );
  return { dates, lanes, unscheduledTasks, events };
}

export function buildCalendarMonth(
  month: string,
  data: CalendarData,
  today: string = todayHK(),
): CalendarMonth {
  const { from, to } = monthGridRange(month);
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));

  const byDate = new Map<string, CalendarEntry[]>();
  const all = [
    ...meetingEntries(data.meetings, projectsById),
    ...milestoneEntries(data.milestones, projectsById),
    ...taskEntries(data.tasks),
  ];
  for (const entry of all) {
    if (entry.date < from || entry.date > to) {
      continue;
    }
    const bucket = byDate.get(entry.date);
    if (bucket === undefined) {
      byDate.set(entry.date, [entry]);
    } else {
      bucket.push(entry);
    }
  }
  for (const bucket of byDate.values()) {
    bucket.sort(
      (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title, 'zh-CN'),
    );
  }

  const weeks: CalendarDay[][] = [];
  let entryCount = 0;
  for (let week = 0; week < WEEKS_IN_GRID; week += 1) {
    const days: CalendarDay[] = [];
    for (let day = 0; day < DAYS_IN_WEEK; day += 1) {
      const date = addDays(from, week * DAYS_IN_WEEK + day);
      const entries = byDate.get(date) ?? [];
      const inMonth = monthOf(date) === month;
      if (inMonth) {
        entryCount += entries.length;
      }
      days.push({
        date,
        dayOfMonth: Number(date.slice(8, 10)),
        inMonth,
        isToday: date === today,
        entries,
      });
    }
    weeks.push(days);
  }

  return {
    month,
    label: formatMonthLabel(`${month}-01`),
    rangeStart: from,
    rangeEnd: to,
    weeks,
    entryCount,
    recurrenceTruncated: data.recurrenceTruncated ?? false,
    colorBar: buildCalendarColorBar(data, from, to, all),
  };
}

/** Grid width in days — asserted by the tests so the layout stays stable. */
export const CALENDAR_GRID_DAYS = WEEKS_IN_GRID * DAYS_IN_WEEK;

/** Monday-first weekday headers. */
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** Sanity helper for the tests: the grid must span exactly six whole weeks. */
export function gridDayCount(month: string): number {
  const { from, to } = monthGridRange(month);
  return inclusiveDays(from, to);
}
