import {
  readableBarTextColor,
  safeCalendarColor,
  TASK_STATUS_LABELS,
} from '@/features/calendar/calendarModel';
import { addDays, formatDayLabel, todayHK } from '@/lib/date';
import type { TaskWithProject } from '@/types';

/**
 * Pure view-model for the desktop widget. Date arithmetic reuses the main
 * calendar's date helpers ('YYYY-MM-DD' inclusive ranges in Asia/Hong_Kong)
 * and the colour computation reuses the main calendar's safe colour and
 * readable-text helpers, so the widget never invents its own rules.
 */

export type WidgetView = 'today' | 'calendar';
export type WidgetCalendarView = 'today' | 'seven-day';

/** 近七天 = today plus the next six days: exactly 7 natural days. */
export const SEVEN_DAY_COUNT = 7;

export function sevenDayRange(today: string = todayHK()): string[] {
  return Array.from({ length: SEVEN_DAY_COUNT }, (_, index) => addDays(today, index));
}

/** One colour bar. Rendered as a focusable button that never drags the window. */
export interface WidgetTaskBar {
  readonly taskId: string;
  readonly title: string;
  /** Always a safe hex colour; falls back to the calendar default. */
  readonly color: string;
  readonly textColor: string;
  /** Non-colour status marker, only for完成/延期-like states. */
  readonly statusLabel: string | null;
  readonly done: boolean;
  /** True when this day is the real (unclipped) first/last day of the task. */
  readonly isStart: boolean;
  readonly isEnd: boolean;
  readonly projectName: string;
}

export interface WidgetCalendarDay {
  readonly date: string;
  readonly label: string;
  readonly isToday: boolean;
  readonly bars: readonly WidgetTaskBar[];
}

function effectiveRange(task: TaskWithProject): { start: string; end: string } | null {
  const start = task.start_date ?? task.due_date;
  const end = task.due_date ?? task.start_date;
  if (start === null || end === null) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

/** Does the task's inclusive date range cover `date`? */
export function taskCoversDate(task: TaskWithProject, date: string): boolean {
  const range = effectiveRange(task);
  return range !== null && range.start <= date && date <= range.end;
}

function toBar(task: TaskWithProject, date: string): WidgetTaskBar {
  const range = effectiveRange(task);
  const color = safeCalendarColor(task.project_color);
  const done = task.status === 'done';
  const flagged = done || task.status === 'postponed' || task.status === 'cancelled';
  return {
    taskId: task.id,
    title: task.title,
    color,
    textColor: readableBarTextColor(color),
    statusLabel: flagged ? TASK_STATUS_LABELS[task.status] : null,
    done,
    isStart: range?.start === date,
    isEnd: range?.end === date,
    projectName: task.project_name,
  };
}

/** Tasks covering one day, deduplicated by task id, in stable input order. */
export function barsForDate(tasks: readonly TaskWithProject[], date: string): WidgetTaskBar[] {
  const seen = new Set<string>();
  const bars: WidgetTaskBar[] = [];
  for (const task of tasks) {
    if (seen.has(task.id) || !taskCoversDate(task, date)) continue;
    seen.add(task.id);
    bars.push(toBar(task, date));
  }
  return bars;
}

/**
 * The vertical seven-day agenda. Cross-day tasks are clipped to the window
 * without losing their first or last day; each day never repeats a task.
 */
export function buildSevenDayAgenda(
  tasks: readonly TaskWithProject[],
  today: string = todayHK(),
): WidgetCalendarDay[] {
  return sevenDayRange(today).map((date) => ({
    date,
    label: formatDayLabel(date),
    isToday: date === today,
    bars: barsForDate(tasks, date),
  }));
}

/** The 今天 sub view: every task whose range covers today. */
export function buildTodayAgenda(
  tasks: readonly TaskWithProject[],
  today: string = todayHK(),
): WidgetCalendarDay {
  return {
    date: today,
    label: formatDayLabel(today),
    isToday: true,
    bars: barsForDate(tasks, today),
  };
}
