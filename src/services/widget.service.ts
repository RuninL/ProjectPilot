import { addDays, todayHK } from '@/lib/date';
import { getCalendarService } from '@/services/calendar.service';
import { WIDGET_DAY_COUNT } from '@/features/widget/widgetModel';
import type { CalendarData } from '@/features/calendar/calendarModel';

/**
 * Data access for the desktop widget calendar. Reuses the main calendar's
 * authoritative date-range repository query (inclusive business dates in
 * Asia/Hong_Kong, archived tasks excluded) instead of reinventing it.
 */
export async function loadWidgetCalendarRange(from: string, to: string): Promise<CalendarData> {
  return (await getCalendarService()).loadRange(from, to);
}

/** All calendar items intersecting today plus the following seven natural days. */
export async function loadWidgetAgenda(today: string = todayHK()): Promise<CalendarData> {
  return loadWidgetCalendarRange(today, addDays(today, WIDGET_DAY_COUNT - 1));
}
