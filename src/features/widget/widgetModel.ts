import {
  readableBarTextColor,
  safeCalendarColor,
  TASK_STATUS_LABELS,
  type CalendarData,
} from '@/features/calendar/calendarModel';
import { addDays, formatDayLabel, todayHK } from '@/lib/date';
import type { TaskWithProject } from '@/types';

export type WidgetView = 'today' | 'calendar';
export type WidgetCalendarView = 'today' | 'seven-day';

/** Today plus the next seven days, i.e. exactly eight natural dates. */
export const WIDGET_DAY_COUNT = 8;

export function sevenDayRange(today: string = todayHK()): string[] {
  return Array.from({ length: WIDGET_DAY_COUNT }, (_, index) => addDays(today, index));
}

export type WidgetCalendarItemType = 'task' | 'meeting' | 'milestone';

export interface WidgetCalendarBar {
  readonly id: string;
  readonly type: WidgetCalendarItemType;
  readonly title: string;
  readonly date: string;
  readonly start: string;
  readonly end: string;
  readonly color: string;
  readonly textColor: string;
  readonly typeLabel: string;
  readonly navigationTarget: string;
  readonly statusLabel: string | null;
  readonly done: boolean;
}

export interface WidgetCalendarDay {
  readonly date: string;
  readonly label: string;
  readonly isToday: boolean;
  readonly bars: readonly WidgetCalendarBar[];
}

function taskRange(task: TaskWithProject): { start: string; end: string } | null {
  const start = task.start_date ?? task.due_date;
  const end = task.due_date ?? task.start_date;
  if (start === null || end === null || start > end) return null;
  return { start, end };
}

export function taskCoversDate(task: TaskWithProject, date: string): boolean {
  const range = taskRange(task);
  return range !== null && range.start <= date && date <= range.end;
}

function taskBars(data: CalendarData): WidgetCalendarBar[] {
  return data.tasks.flatMap((task) => {
    const range = taskRange(task);
    if (range === null || task.archived_at !== null) return [];
    const color = safeCalendarColor(task.project_color);
    return [{
      id: task.id,
      type: 'task' as const,
      title: task.title || '未命名任务',
      date: range.start,
      start: range.start,
      end: range.end,
      color,
      textColor: readableBarTextColor(color),
      typeLabel: '任务',
      navigationTarget: `/tasks/${encodeURIComponent(task.id)}`,
      statusLabel: TASK_STATUS_LABELS[task.status],
      done: task.status === 'done',
    }];
  });
}

function eventBars(data: CalendarData): WidgetCalendarBar[] {
  const projects = new Map(data.projects.map((project) => [project.id, project]));
  const meetings = data.meetings.map((meeting) => {
    const color = '#0f766e';
    return {
      id: meeting.id,
      type: 'meeting' as const,
      title: meeting.topic || '未命名会议',
      date: meeting.date,
      start: meeting.date,
      end: meeting.date,
      color,
      textColor: readableBarTextColor(color),
      typeLabel: meeting.source_rule_id === null ? '会议' : '周期会议',
      navigationTarget:
        meeting.source_rule_id === null
          ? `/meetings/${encodeURIComponent(meeting.id)}`
          : `/meetings?series=${encodeURIComponent(meeting.source_rule_id)}`,
      statusLabel: null,
      done: false,
    };
  });
  const milestones = data.milestones.map((milestone) => {
    const color = safeCalendarColor(projects.get(milestone.project_id)?.color);
    return {
      id: milestone.id,
      type: 'milestone' as const,
      title: milestone.name || '未命名里程碑',
      date: milestone.date,
      start: milestone.date,
      end: milestone.date,
      color,
      textColor: readableBarTextColor(color),
      typeLabel: '里程碑',
      navigationTarget: `/projects/${encodeURIComponent(milestone.project_id)}#project-milestones`,
      statusLabel: null,
      done: false,
    };
  });
  return [...meetings, ...milestones];
}

const TYPE_ORDER: Record<WidgetCalendarItemType, number> = { meeting: 0, milestone: 1, task: 2 };

export function buildWidgetAgenda(
  data: CalendarData,
  today: string = todayHK(),
  dayCount: number = WIDGET_DAY_COUNT,
): WidgetCalendarDay[] {
  const bars = [...eventBars(data), ...taskBars(data)];
  return Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(today, index);
    const seen = new Set<string>();
    const daily = bars
      .filter((bar) => {
        const key = `${bar.type}:${bar.id}`;
        if (bar.start > date || bar.end < date || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(
        (a, b) =>
          TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
          a.title.localeCompare(b.title, 'zh-CN') ||
          a.id.localeCompare(b.id),
      );
    return { date, label: formatDayLabel(date), isToday: index === 0, bars: daily };
  });
}
