import {
  addDays as addCalendarDays,
  addMonths,
  differenceInCalendarDays,
  endOfWeek,
  format,
  startOfWeek,
} from 'date-fns';

/**
 * Business dates are calendar days (date-only) in the Asia/Hong_Kong timezone,
 * stored as TEXT 'YYYY-MM-DD'. Lexicographic order equals chronological order,
 * so all comparisons are plain string comparisons. Never use
 * `new Date().toISOString().slice(0, 10)` for "today" — that is the UTC day and
 * is off by one for up to 8 hours after HK midnight.
 */

export const HK_TIME_ZONE = 'Asia/Hong_Kong';

/** Terminal statuses excluded from overdue checks. */
const CLOSED_TASK_STATUSES = new Set(['done', 'cancelled']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Asia/Hong_Kong as 'YYYY-MM-DD'. `en-CA` formats as ISO date. */
export function todayHK(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Current instant as a UTC ISO-8601 timestamp, for `created_at`/`updated_at`
 * audit columns only. Business dates must come from `todayHK()`.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** True when `value` is a real 'YYYY-MM-DD' calendar date (rejects 2026-02-30 etc.). */
export function isValidDateStr(value: string): boolean {
  if (!DATE_RE.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Parse a Date at local midnight from a validated date string. */
function toDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/**
 * Overdue = due date strictly before today and the task is not closed.
 * `null` due dates are never overdue.
 */
export function isOverdue(
  dueDate: string | null,
  status: string,
  today: string = todayHK(),
): boolean {
  if (dueDate === null) {
    return false;
  }
  return dueDate < today && !CLOSED_TASK_STATUSES.has(status);
}

/** True when `date` equals today (HK). */
export function isDueToday(date: string | null, today: string = todayHK()): boolean {
  return date !== null && date === today;
}

/**
 * True when `date` falls in the current week (Monday–Sunday, matching
 * date-fns weekStartsOn: 1). Compared entirely in date-string space.
 */
export function isThisWeek(date: string | null, today: string = todayHK()): boolean {
  if (date === null) {
    return false;
  }
  const base = toDate(today);
  const start = format(startOfWeek(base, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const end = format(endOfWeek(base, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  return date >= start && date <= end;
}

/**
 * Calendar days from `from` to `date` (positive = future). Today = 0.
 * Used for milestone countdowns.
 */
export function daysUntil(date: string, from: string = todayHK()): number {
  return differenceInCalendarDays(toDate(date), toDate(from));
}

/** `date` shifted by `days` calendar days, back as 'YYYY-MM-DD'. */
export function addDays(date: string, days: number): string {
  return format(addCalendarDays(toDate(date), days), 'yyyy-MM-dd');
}

/** Inclusive day count from `from` to `to`; 1 for a single day, 0 when reversed. */
export function inclusiveDays(from: string, to: string): number {
  return Math.max(0, differenceInCalendarDays(toDate(to), toDate(from)) + 1);
}

/** Monday of the week containing `date` (matching `isThisWeek`). */
export function startOfWeekStr(date: string): string {
  return format(startOfWeek(toDate(date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

/** First day of the month containing `date`. */
export function startOfMonthStr(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** First day of the calendar quarter containing `date`. */
export function startOfQuarterStr(date: string): string {
  const month = Number(date.slice(5, 7));
  const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${date.slice(0, 4)}-${String(firstMonth).padStart(2, '0')}-01`;
}

/** First day of the month after the one containing `date`. */
export function startOfNextMonthStr(date: string): string {
  return format(addMonths(toDate(startOfMonthStr(date)), 1), 'yyyy-MM-dd');
}

/** Simplified-Chinese labels for the Gantt axis: '2026年8月', '8月3日', '2026 Q3'. */
export function formatMonthLabel(date: string): string {
  return `${date.slice(0, 4)}年${String(Number(date.slice(5, 7)))}月`;
}

export function formatDayLabel(date: string): string {
  return `${String(Number(date.slice(5, 7)))}月${String(Number(date.slice(8, 10)))}日`;
}

export function formatQuarterLabel(date: string): string {
  const quarter = Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
  return `${date.slice(0, 4)} Q${String(quarter)}`;
}

/** Display a date, or the Simplified-Chinese placeholder for a missing one. */
export function formatDisplay(date: string | null): string {
  return date === null || date === '' ? '未设置' : date;
}

/**
 * Normalize user input to a stored date string, or `null` when empty.
 * Throws on an invalid non-empty value so the form layer surfaces it.
 */
export function parseInput(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }
  if (!isValidDateStr(trimmed)) {
    throw new Error(`无效日期：${input}`);
  }
  return trimmed;
}
