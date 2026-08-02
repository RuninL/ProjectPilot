import { addDays, todayHK } from '@/lib/date';
import { getRepositories } from '@/repositories';
import { SEVEN_DAY_COUNT } from '@/features/widget/widgetModel';
import type { TaskWithProject } from '@/types';

/**
 * Data access for the desktop widget calendar. Reuses the main calendar's
 * authoritative date-range repository query (inclusive business dates in
 * Asia/Hong_Kong, archived tasks excluded) instead of reinventing it.
 */
export async function loadWidgetRangeTasks(
  from: string,
  to: string,
): Promise<readonly TaskWithProject[]> {
  return (await getRepositories()).tasks.findInDateRange(from, to);
}

/** Tasks intersecting the widget's 近七天 window starting today. */
export async function loadWidgetSevenDayTasks(
  today: string = todayHK(),
): Promise<readonly TaskWithProject[]> {
  return loadWidgetRangeTasks(today, addDays(today, SEVEN_DAY_COUNT - 1));
}

/** Tasks whose range covers today, for the widget calendar's 今天 sub view. */
export async function loadWidgetTodayTasks(
  today: string = todayHK(),
): Promise<readonly TaskWithProject[]> {
  return loadWidgetRangeTasks(today, today);
}
