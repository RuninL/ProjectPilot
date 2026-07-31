import { z } from 'zod';
import { nowIso } from '@/lib/date';
import { getRepositories } from '@/repositories';

const REMINDER_SETTINGS_KEY = 'desktop.reminders.v1';
const DELIVERY_KEY = 'desktop.reminder-deliveries.v1';
const MAX_DELIVERIES = 500;

export const reminderSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    meetingMinutesBefore: z.enum(['none', '0', '5', '10', '15', '30', '60', '1440']).default('15'),
    taskLeadDays: z.enum(['none', '0', '1', '3']).default('0'),
    projectMilestoneLeadDays: z.enum(['none', '0', '1', '3', '7']).default('1'),
    quietStart: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .default('22:00'),
    quietEnd: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .default('08:00'),
    dailySummaryTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .default('08:30'),
    pausedUntil: z.string().datetime().nullable().default(null),
    closeToTray: z.boolean().default(true),
    companionAlwaysOnTop: z.boolean().default(false),
    companionView: z.enum(['today', 'calendar']).default('today'),
    companionGeometry: z
      .object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() })
      .nullable()
      .default(null),
  })
  .strict();

export type ReminderSettings = z.infer<typeof reminderSettingsSchema>;

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = reminderSettingsSchema.parse({});

export async function loadReminderSettings(): Promise<ReminderSettings> {
  const setting = await (await getRepositories()).appSettings.get(REMINDER_SETTINGS_KEY);
  if (setting === null) return DEFAULT_REMINDER_SETTINGS;
  try {
    const parsed = reminderSettingsSchema.safeParse(JSON.parse(setting.value) as unknown);
    return parsed.success ? parsed.data : DEFAULT_REMINDER_SETTINGS;
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}

export async function saveReminderSettings(input: ReminderSettings): Promise<void> {
  const settings = reminderSettingsSchema.parse(input);
  await (
    await getRepositories()
  ).appSettings.set(REMINDER_SETTINGS_KEY, JSON.stringify(settings), nowIso());
}

export async function loadDeliveredReminderIds(): Promise<Set<string>> {
  const setting = await (await getRepositories()).appSettings.get(DELIVERY_KEY);
  if (setting === null) return new Set();
  try {
    const value = z
      .array(z.string())
      .max(MAX_DELIVERIES)
      .safeParse(JSON.parse(setting.value) as unknown);
    return new Set(value.success ? value.data : []);
  } catch {
    return new Set();
  }
}

export async function saveDeliveredReminderIds(ids: readonly string[]): Promise<void> {
  await (
    await getRepositories()
  ).appSettings.set(
    DELIVERY_KEY,
    JSON.stringify([...new Set(ids)].slice(-MAX_DELIVERIES)),
    nowIso(),
  );
}
