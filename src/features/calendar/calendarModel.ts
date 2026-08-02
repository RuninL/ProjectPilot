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

/**
 * The lightweight grid used by the desktop companion. It deliberately omits
 * colour-bar lane packing, which the compact date picker neither displays nor
 * needs to calculate.
 */
export type CompactCalendarMonth = Pick<
  CalendarMonth,
  'month' | 'label' | 'rangeStart' | 'rangeEnd' | 'weeks' | 'entryCount' | 'recurrenceTruncated'
>;

export interface CalendarData {
  readonly tasks: readonly TaskWithProject[];
  readonly meetings: readonly Meeting[];
  readonly milestones: readonly Milestone[];
  /** Used to name and colour milestones, which are stored without a join. */
  readonly projects: readonly Project[];
  readonly recurrenceTruncated?: boolean;
}

/**
 * One visible piece of a task/meeting/milestone inside a single calendar week.
 * Cross-week items are split into several segments purely for rendering; the
 * underlying data is never duplicated or modified.
 */
export interface CalendarColorBarSegment {
  /** Unique per segment: `${sourceKey}@${weekStart}`. */
  readonly key: string;
  /** Stable identity shared by every segment of the same item. */
  readonly sourceKey: string;
  readonly kind: CalendarEntryKind;
  readonly kindLabel: string;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly color: string;
  /** Readable foreground for solid task bars, derived from `color`. */
  readonly textColor: string;
  /** Visible range inside this week (both inclusive). */
  readonly start: string;
  readonly end: string;
  /** 1-based column inside the 7-day week row. */
  readonly startColumn: number;
  readonly span: number;
  /** 0-based lane inside this week only — every week packs independently. */
  readonly lane: number;
  /** True when this segment contains the real (clipped) first day. */
  readonly isStart: boolean;
  /** True when this segment contains the real (clipped) last day. */
  readonly isEnd: boolean;
  /** Full display range for the accessible label. */
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly status: TaskWithProject['status'] | null;
  readonly statusLabel: string | null;
  readonly recurrence: CalendarEntry['recurrence'];
}

export interface CalendarColorBarWeek {
  readonly days: readonly CalendarDay[];
  readonly segments: readonly CalendarColorBarSegment[];
  /** Actual lanes used this week; the week row height derives only from this. */
  readonly laneCount: number;
}

export interface CalendarColorBarModel {
  readonly weeks: readonly CalendarColorBarWeek[];
  readonly unscheduledTasks: readonly TaskWithProject[];
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

/** Text labels so task status is never carried by colour alone. */
export const TASK_STATUS_LABELS: Record<TaskWithProject['status'], string> = {
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

/** Dark or light foreground so bar titles stay readable on any project colour. */
export function readableBarTextColor(background: string): string {
  const hex = safeCalendarColor(background).slice(1);
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#1f2937' : '#ffffff';
}

function taskInterval(task: TaskWithProject): { start: string; end: string } | null {
  if (task.start_date === null && task.due_date === null) return null;
  if (task.start_date === null)
    return { start: task.due_date as string, end: task.due_date as string };
  if (task.due_date === null) return { start: task.start_date, end: task.start_date };
  // Legacy inverted dates are displayed as a safe single-day task rather than corrupting the lane layout.
  if (task.start_date > task.due_date) return { start: task.start_date, end: task.start_date };
  return { start: task.start_date, end: task.due_date };
}

/** A month-clipped display interval before it is split into weekly segments. */
interface ColorBarInterval {
  readonly sourceKey: string;
  readonly kind: CalendarEntryKind;
  readonly kindLabel: string;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly color: string;
  readonly displayStart: string;
  readonly displayEnd: string;
  readonly status: TaskWithProject['status'] | null;
  readonly statusLabel: string | null;
  readonly recurrence: CalendarEntry['recurrence'];
}

/**
 * Builds the compact month-grid colour-bar model. Cross-week items are split
 * into per-week segments and every week runs its own deterministic first-fit
 * lane packing starting from lane 0, so one busy week never inflates another.
 * Source tasks remain untouched; clipping only affects the visible range.
 */
export function buildCalendarColorBar(
  data: CalendarData,
  weeks: readonly (readonly CalendarDay[])[],
  entries: readonly CalendarEntry[] = [],
): CalendarColorBarModel {
  const rangeStart = weeks[0]?.[0]?.date ?? '';
  const lastWeek = weeks[weeks.length - 1];
  const rangeEnd = lastWeek?.[lastWeek.length - 1]?.date ?? '';
  const unscheduledTasks = data.tasks.filter((task) => taskInterval(task) === null);

  const intervals: ColorBarInterval[] = [];
  for (const task of data.tasks) {
    const interval = taskInterval(task);
    if (interval === null || interval.end < rangeStart || interval.start > rangeEnd) continue;
    intervals.push({
      sourceKey: `task-bar:${task.id}`,
      kind: 'task',
      kindLabel: KIND_LABELS.task,
      title: task.title,
      detail: task.project_name,
      href: `/tasks?taskId=${encodeURIComponent(task.id)}`,
      color: safeCalendarColor(task.project_color),
      displayStart: interval.start < rangeStart ? rangeStart : interval.start,
      displayEnd: interval.end > rangeEnd ? rangeEnd : interval.end,
      status: task.status,
      statusLabel: TASK_STATUS_LABELS[task.status],
      recurrence:
        task.source_rule_id === null || task.source_occurrence_date === null
          ? null
          : { ruleId: task.source_rule_id, occurrenceDate: task.source_occurrence_date },
    });
  }
  for (const entry of entries) {
    if (entry.kind === 'task' || entry.date < rangeStart || entry.date > rangeEnd) continue;
    intervals.push({
      sourceKey: `calendar-event:${entry.key}`,
      kind: entry.kind,
      kindLabel: entry.kindLabel,
      title: entry.title,
      detail: entry.detail,
      href: entry.href,
      color: safeCalendarColor(entry.color),
      displayStart: entry.date,
      displayEnd: entry.date,
      status: null,
      statusLabel: null,
      recurrence: entry.recurrence,
    });
  }

  const packedWeeks = weeks.map((days) => {
    const weekStart = days[0]?.date ?? '';
    const weekEnd = days[days.length - 1]?.date ?? '';
    const candidates = intervals
      .filter((item) => item.displayStart <= weekEnd && item.displayEnd >= weekStart)
      .map((item) => ({
        item,
        start: item.displayStart < weekStart ? weekStart : item.displayStart,
        end: item.displayEnd > weekEnd ? weekEnd : item.displayEnd,
      }))
      .sort(
        (a, b) =>
          a.start.localeCompare(b.start) ||
          inclusiveDays(b.start, b.end) - inclusiveDays(a.start, a.end) ||
          a.end.localeCompare(b.end) ||
          KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
          a.item.title.localeCompare(b.item.title, 'zh-CN') ||
          a.item.sourceKey.localeCompare(b.item.sourceKey),
      );

    // First-fit: every week restarts at lane 0 and always reuses the topmost
    // free lane. Sharing a day (previous end == next start) is a conflict.
    const laneEnds: string[] = [];
    const segments: CalendarColorBarSegment[] = [];
    for (const candidate of candidates) {
      let lane = laneEnds.findIndex((end) => end < candidate.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(candidate.end);
      } else {
        laneEnds[lane] = candidate.end;
      }
      const { item } = candidate;
      segments.push({
        key: `${item.sourceKey}@${weekStart}`,
        sourceKey: item.sourceKey,
        kind: item.kind,
        kindLabel: item.kindLabel,
        title: item.title,
        detail: item.detail,
        href: item.href,
        color: item.color,
        textColor: readableBarTextColor(item.color),
        start: candidate.start,
        end: candidate.end,
        startColumn: days.findIndex((day) => day.date === candidate.start) + 1,
        span: inclusiveDays(candidate.start, candidate.end),
        lane,
        isStart: candidate.start === item.displayStart,
        isEnd: candidate.end === item.displayEnd,
        rangeStart: item.displayStart,
        rangeEnd: item.displayEnd,
        status: item.status,
        statusLabel: item.statusLabel,
        recurrence: item.recurrence,
      });
    }
    return { days, segments, laneCount: laneEnds.length };
  });

  return { weeks: packedWeeks, unscheduledTasks };
}

interface CalendarGridData extends CompactCalendarMonth {
  readonly entries: readonly CalendarEntry[];
}

function buildCalendarGrid(
  month: string,
  data: CalendarData,
  today: string = todayHK(),
): CalendarGridData {
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
    entries: all,
  };
}

/** Build the month model for the companion without the main Calendar's bar layout. */
export function buildCompactCalendarMonth(
  month: string,
  data: CalendarData,
  today: string = todayHK(),
): CompactCalendarMonth {
  const grid = buildCalendarGrid(month, data, today);
  return {
    month: grid.month,
    label: grid.label,
    rangeStart: grid.rangeStart,
    rangeEnd: grid.rangeEnd,
    weeks: grid.weeks,
    entryCount: grid.entryCount,
    recurrenceTruncated: grid.recurrenceTruncated,
  };
}

export function buildCalendarMonth(
  month: string,
  data: CalendarData,
  today: string = todayHK(),
): CalendarMonth {
  const grid = buildCalendarGrid(month, data, today);
  const { entries, ...calendar } = grid;
  return {
    ...calendar,
    colorBar: buildCalendarColorBar(data, grid.weeks, entries),
  };
}

/** Grid width in days — asserted by the tests so the layout stays stable. */
export const CALENDAR_GRID_DAYS = WEEKS_IN_GRID * DAYS_IN_WEEK;

/** Monday-first weekday headers, shared by both calendar views. */
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

/** Sanity helper for the tests: the grid must span exactly six whole weeks. */
export function gridDayCount(month: string): number {
  const { from, to } = monthGridRange(month);
  return inclusiveDays(from, to);
}
