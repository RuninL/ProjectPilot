import { z } from 'zod';
import { nowIso } from '@/lib/date';
import { getRepositories } from '@/repositories';

/**
 * Desktop widget preferences, persisted in the existing `app_settings` table
 * (no new migration). Only durable UI preferences live here — never the
 * runtime window state, which is always read from the real window.
 */
const SETTINGS_KEY = 'desktop.widget.v1';

const geometrySchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(320),
  height: z.number().min(420),
});

export const desktopWidgetSettingsSchema = z
  .object({
    /** Top level view: 今日任务 | 日历. */
    lastView: z.enum(['today', 'calendar']).default('today'),
    /** Sub view inside 日历: 今天 | 近七天. */
    calendarView: z.enum(['today', 'seven-day']).default('today'),
    monitorId: z.string().max(300).nullable().default(null),
    layouts: z.record(z.string().max(300), geometrySchema).default({}),
  })
  .strict();

export type DesktopWidgetSettings = z.infer<typeof desktopWidgetSettingsSchema>;
export const DEFAULT_DESKTOP_WIDGET_SETTINGS = desktopWidgetSettingsSchema.parse({});

export interface WidgetViewSelection {
  lastView: DesktopWidgetSettings['lastView'];
  calendarView: DesktopWidgetSettings['calendarView'];
}

/**
 * Map a legacy stored view value onto the new two-level structure:
 * `today` → 今日任务, `seven-day`/`sevenDays` → 日历·近七天,
 * `month`/`calendar` → 日历·今天 (the month grid no longer exists).
 */
export function migrateLegacyWidgetView(value: unknown): WidgetViewSelection {
  switch (value) {
    case 'seven-day':
    case 'sevenDays':
      return { lastView: 'calendar', calendarView: 'seven-day' };
    case 'month':
    case 'calendar':
      return { lastView: 'calendar', calendarView: 'today' };
    default:
      return { lastView: 'today', calendarView: 'today' };
  }
}

export async function loadDesktopWidgetSettings(): Promise<DesktopWidgetSettings> {
  const repos = await getRepositories();
  const setting = await repos.appSettings.get(SETTINGS_KEY);
  if (setting !== null) {
    try {
      const parsed = desktopWidgetSettingsSchema.safeParse(JSON.parse(setting.value) as unknown);
      if (parsed.success) return parsed.data;
    } catch {
      // fall through to legacy migration below
    }
    return DEFAULT_DESKTOP_WIDGET_SETTINGS;
  }
  // First run: adopt the legacy companion view preference if present.
  const legacy = await repos.appSettings.get('desktop.reminders.v1');
  if (legacy !== null) {
    try {
      const raw = JSON.parse(legacy.value) as Record<string, unknown>;
      return {
        ...DEFAULT_DESKTOP_WIDGET_SETTINGS,
        ...migrateLegacyWidgetView(raw['companionView']),
      };
    } catch {
      return DEFAULT_DESKTOP_WIDGET_SETTINGS;
    }
  }
  return DEFAULT_DESKTOP_WIDGET_SETTINGS;
}

export async function saveDesktopWidgetSettings(input: DesktopWidgetSettings): Promise<void> {
  const settings = desktopWidgetSettingsSchema.parse(input);
  await (await getRepositories()).appSettings.set(SETTINGS_KEY, JSON.stringify(settings), nowIso());
}
