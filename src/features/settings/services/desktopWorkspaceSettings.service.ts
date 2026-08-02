import { z } from 'zod';
import { nowIso } from '@/lib/date';
import { getRepositories } from '@/repositories';

const SETTINGS_KEY = 'desktop.workspace.v1';

const geometrySchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(320),
  height: z.number().min(420),
});

export const desktopWorkspaceSettingsSchema = z
  .object({
    mode: z.enum(['off', 'widget', 'workerw']).default('off'),
    defaultView: z.enum(['today', 'sevenDays', 'calendar']).default('today'),
    monitorId: z.string().max(300).nullable().default(null),
    layouts: z.record(z.string().max(300), geometrySchema).default({}),
    scale: z.number().min(0.5).max(2).default(1),
    opacity: z.number().min(0.3).max(1).default(0.92),
    blur: z.boolean().default(false),
    locked: z.boolean().default(false),
    clickThrough: z.boolean().default(false),
    interactionShortcut: z.string().max(100).default('Ctrl+Alt+I'),
    showCompleted: z.boolean().default(true),
    projectFilter: z.string().nullable().default(null),
    showMeetings: z.boolean().default(true),
    showRecurringMeetings: z.boolean().default(true),
    launchAtLogin: z.boolean().default(false),
    showAtLaunch: z.boolean().default(false),
    mainCloseBehavior: z.enum(['hide', 'exit']).default('hide'),
    fullscreenBehavior: z.enum(['keep', 'reduce', 'pause']).default('reduce'),
    batteryBehavior: z.enum(['keep', 'reduce', 'pause']).default('reduce'),
    workerwFallback: z.boolean().default(true),
  })
  .strict();

export type DesktopWorkspaceSettings = z.infer<typeof desktopWorkspaceSettingsSchema>;
export const DEFAULT_DESKTOP_WORKSPACE_SETTINGS = desktopWorkspaceSettingsSchema.parse({});

export async function loadDesktopWorkspaceSettings(): Promise<DesktopWorkspaceSettings> {
  const setting = await (await getRepositories()).appSettings.get(SETTINGS_KEY);
  if (setting === null) return DEFAULT_DESKTOP_WORKSPACE_SETTINGS;
  try {
    const parsed = desktopWorkspaceSettingsSchema.safeParse(JSON.parse(setting.value) as unknown);
    return parsed.success ? parsed.data : DEFAULT_DESKTOP_WORKSPACE_SETTINGS;
  } catch {
    return DEFAULT_DESKTOP_WORKSPACE_SETTINGS;
  }
}

export async function saveDesktopWorkspaceSettings(input: DesktopWorkspaceSettings): Promise<void> {
  const settings = desktopWorkspaceSettingsSchema.parse(input);
  await (await getRepositories()).appSettings.set(SETTINGS_KEY, JSON.stringify(settings), nowIso());
}
