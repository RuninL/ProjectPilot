import { z } from 'zod';
import type { ResolvedTheme } from '@/lib/theme';
import {
  PROGRESS_SEGMENT_COLORS,
  setProgressSegmentPalette,
} from '@/features/tasks/taskProgressSegments';

export const THEME_PROFILE_SCHEMA_VERSION = 1 as const;
export const SAFE_THEME_PROFILE_ID = 'builtin:dark';
export const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const colorSchema = z.string().regex(COLOR_PATTERN, '颜色必须是 #RRGGBB 格式');
const baseThemeSchema = z.enum(['light', 'dark', 'warm', 'colorful']);

const commonSchema = z.object({
  appBackground: colorSchema,
  mainSurface: colorSchema,
  cardBackground: colorSchema,
  sidebarBackground: colorSchema,
  primaryText: colorSchema,
  secondaryText: colorSchema,
  primaryAccent: colorSchema,
  border: colorSchema,
  selectedBackground: colorSchema,
  primaryButton: colorSchema,
  primaryButtonText: colorSchema,
});

const textSchema = z.object({
  pageTitle: colorSchema,
  sectionTitle: colorSchema,
  body: colorSchema,
  secondary: colorSchema,
  metadata: colorSchema,
  link: colorSchema,
  placeholder: colorSchema,
  completed: colorSchema,
  archived: colorSchema,
  disabled: colorSchema,
  success: colorSchema,
  warning: colorSchema,
  error: colorSchema,
});

const surfacesSchema = z.object({
  topBar: colorSchema,
  dialog: colorSchema,
  input: colorSchema,
  hover: colorSchema,
  selected: colorSchema,
  border: colorSchema,
  divider: colorSchema,
  focus: colorSchema,
  overlay: colorSchema,
  scrollbar: colorSchema,
});

const controlsSchema = z.object({
  primaryButton: colorSchema,
  primaryButtonText: colorSchema,
  secondaryButton: colorSchema,
  secondaryButtonText: colorSchema,
  dangerButton: colorSchema,
  dangerButtonText: colorSchema,
});

const statusesSchema = z.object({
  active: colorSchema,
  archived: colorSchema,
  completed: colorSchema,
  postponed: colorSchema,
  dueSoon: colorSchema,
  priorityHigh: colorSchema,
  priorityMedium: colorSchema,
  priorityLow: colorSchema,
  success: colorSchema,
  warning: colorSchema,
  error: colorSchema,
  info: colorSchema,
});

const calendarSchema = z.object({
  standaloneMeeting: colorSchema,
  recurringMeeting: colorSchema,
  today: colorSchema,
  selectedDate: colorSchema,
  weekend: colorSchema,
  currentTime: colorSchema,
  taskBar: colorSchema,
  meetingBar: colorSchema,
  postponed: colorSchema,
  completed: colorSchema,
  grid: colorSchema,
  background: colorSchema,
  outsideMonth: colorSchema,
});

const desktopWidgetSchema = z.object({
  background: colorSchema,
  primaryText: colorSchema,
  secondaryText: colorSchema,
  border: colorSchema,
  overlay: colorSchema,
});

const progressPaletteSchema = z.object({
  enabled: z.boolean(),
  colors: z.array(colorSchema).length(6),
});

export const themeProfileSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9:_-]+$/),
    name: z.string().trim().min(1).max(50),
    schemaVersion: z.literal(THEME_PROFILE_SCHEMA_VERSION),
    baseTheme: baseThemeSchema,
    common: commonSchema,
    text: textSchema,
    surfaces: surfacesSchema,
    controls: controlsSchema,
    statuses: statusesSchema,
    calendar: calendarSchema,
    progressPalette: progressPaletteSchema,
    desktopWidget: desktopWidgetSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strip();

export type ThemeProfile = z.infer<typeof themeProfileSchema>;
export type ThemeColorGroup =
  'common' | 'text' | 'surfaces' | 'controls' | 'statuses' | 'calendar' | 'desktopWidget';

const LIGHT = {
  background: '#ffffff',
  surface: '#ffffff',
  foreground: '#020817',
  muted: '#64748b',
  accent: '#2563eb',
  subtle: '#f1f5f9',
  border: '#e2e8f0',
  danger: '#ef4444',
};

const DARK = {
  background: '#020817',
  surface: '#07101f',
  foreground: '#f8fafc',
  muted: '#94a3b8',
  accent: '#3b82f6',
  subtle: '#1e293b',
  border: '#1e293b',
  danger: '#991b1b',
};

function baseColors(baseTheme: ResolvedTheme) {
  if (baseTheme === 'warm') {
    return {
      ...LIGHT,
      background: '#fffaf3',
      foreground: '#281b16',
      muted: '#78645a',
      accent: '#f97316',
      subtle: '#ffedd5',
      border: '#ead8c4',
    };
  }
  if (baseTheme === 'colorful') {
    return {
      ...DARK,
      background: '#1a1325',
      surface: '#241b32',
      foreground: '#f1f3fa',
      muted: '#a4a8c2',
      accent: '#d946ef',
      subtle: '#33284a',
      border: '#45385f',
      danger: '#f43f5e',
    };
  }
  return baseTheme === 'light' ? LIGHT : DARK;
}

export function createSafeThemeProfile(
  baseTheme: ResolvedTheme = 'dark',
  input: { id?: string; name?: string; now?: string } = {},
): ThemeProfile {
  const colors = baseColors(baseTheme);
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? `builtin:${baseTheme}`,
    name: input.name ?? `${baseTheme} 安全主题`,
    schemaVersion: THEME_PROFILE_SCHEMA_VERSION,
    baseTheme,
    common: {
      appBackground: colors.background,
      mainSurface: colors.background,
      cardBackground: colors.surface,
      sidebarBackground: colors.surface,
      primaryText: colors.foreground,
      secondaryText: colors.muted,
      primaryAccent: colors.accent,
      border: colors.border,
      selectedBackground: colors.subtle,
      primaryButton: colors.accent,
      primaryButtonText: baseTheme === 'dark' || baseTheme === 'colorful' ? '#0f172a' : '#ffffff',
    },
    text: {
      pageTitle: colors.foreground,
      sectionTitle: baseTheme === 'colorful' ? '#5eead4' : colors.accent,
      body: colors.foreground,
      secondary: colors.muted,
      metadata: colors.muted,
      link: colors.accent,
      placeholder: colors.muted,
      completed: '#16a34a',
      archived: colors.muted,
      disabled: colors.muted,
      success: '#16a34a',
      warning: '#d97706',
      error: baseTheme === 'dark' || baseTheme === 'colorful' ? '#f87171' : colors.danger,
    },
    surfaces: {
      topBar: colors.surface,
      dialog: colors.surface,
      input: colors.background,
      hover: colors.subtle,
      selected: colors.subtle,
      border: colors.border,
      divider: colors.border,
      focus: colors.accent,
      overlay: '#000000',
      scrollbar: colors.muted,
    },
    controls: {
      primaryButton: colors.accent,
      primaryButtonText: baseTheme === 'dark' || baseTheme === 'colorful' ? '#0f172a' : '#ffffff',
      secondaryButton: colors.subtle,
      secondaryButtonText: colors.foreground,
      dangerButton: colors.danger,
      dangerButtonText: '#ffffff',
    },
    statuses: {
      active: '#2563eb',
      archived: '#64748b',
      completed: '#16a34a',
      postponed: '#d97706',
      dueSoon: '#f59e0b',
      priorityHigh: '#dc2626',
      priorityMedium: '#d97706',
      priorityLow: '#16a34a',
      success: '#16a34a',
      warning: '#d97706',
      error: '#dc2626',
      info: '#0891b2',
    },
    calendar: {
      standaloneMeeting: '#7c3aed',
      recurringMeeting: '#2563eb',
      today: '#f59e0b',
      selectedDate: colors.accent,
      weekend: colors.muted,
      currentTime: '#dc2626',
      taskBar: '#2563eb',
      meetingBar: '#7c3aed',
      postponed: '#d97706',
      completed: '#16a34a',
      grid: colors.border,
      background: colors.background,
      outsideMonth: colors.muted,
    },
    progressPalette: {
      enabled: false,
      colors: PROGRESS_SEGMENT_COLORS.map((color) => color.background),
    },
    desktopWidget: {
      background: colors.surface,
      primaryText: colors.foreground,
      secondaryText: colors.muted,
      border: colors.border,
      overlay: '#000000',
    },
    createdAt: now,
    updatedAt: now,
  };
}

function mergeObject<T extends Record<string, unknown>>(fallback: T, input: unknown): T {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return fallback;
  return { ...fallback, ...input };
}

export function normalizeThemeProfile(input: unknown): ThemeProfile {
  const record =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const baseResult = baseThemeSchema.safeParse(record.baseTheme);
  const baseTheme = baseResult.success ? baseResult.data : 'dark';
  const fallback = createSafeThemeProfile(baseTheme);
  return themeProfileSchema.parse({
    ...fallback,
    ...record,
    schemaVersion: THEME_PROFILE_SCHEMA_VERSION,
    common: mergeObject(fallback.common, record.common),
    text: mergeObject(fallback.text, record.text),
    surfaces: mergeObject(fallback.surfaces, record.surfaces),
    controls: mergeObject(fallback.controls, record.controls),
    statuses: mergeObject(fallback.statuses, record.statuses),
    calendar: mergeObject(fallback.calendar, record.calendar),
    progressPalette: mergeObject(fallback.progressPalette, record.progressPalette),
    desktopWidget: mergeObject(fallback.desktopWidget, record.desktopWidget),
  });
}

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    if (!COLOR_PATTERN.test(color)) return 0;
    const channels = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
    return (
      0.2126 * linearChannel(channels[0] ?? 0) +
      0.7152 * linearChannel(channels[1] ?? 0) +
      0.0722 * linearChannel(channels[2] ?? 0)
    );
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export type ContrastRating = 'good' | 'marginal' | 'poor';

export function rateContrast(foreground: string, background: string): ContrastRating {
  const ratio = contrastRatio(foreground, background);
  return ratio >= 4.5 ? 'good' : ratio >= 3 ? 'marginal' : 'poor';
}

export function validateProgressPalette(colors: readonly string[]): string[] {
  if (colors.length !== 6 || colors.some((color) => !COLOR_PATTERN.test(color)))
    return ['调色板必须包含六个有效颜色。'];
  const warnings: string[] = [];
  if (new Set(colors.map((color) => color.toLowerCase())).size === 1)
    warnings.push('六种颜色不能完全相同。');
  const distance = (left: string, right: string) =>
    Math.sqrt(
      [1, 3, 5]
        .map(
          (start) =>
            Number.parseInt(left.slice(start, start + 2), 16) -
            Number.parseInt(right.slice(start, start + 2), 16),
        )
        .reduce((sum, channel) => sum + channel ** 2, 0),
    );
  if (
    colors.some(
      (color, index) => distance(color, colors[(index + 1) % colors.length] ?? color) < 45,
    )
  )
    warnings.push('相邻颜色差异过小。');
  if (
    colors.some(
      (color) => contrastRatio(color, '#ffffff') < 1.35 || contrastRatio(color, '#020817') < 1.35,
    )
  )
    warnings.push('部分颜色无法同时在浅色和深色背景上识别。');
  return warnings;
}

function hexToHslChannels(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(
    (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  const max = Math.max(r ?? 0, g ?? 0, b ?? 0);
  const min = Math.min(r ?? 0, g ?? 0, b ?? 0);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return `0 0% ${(lightness * 100).toFixed(1)}%`;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue =
    max === r
      ? ((g ?? 0) - (b ?? 0)) / delta
      : max === g
        ? 2 + ((b ?? 0) - (r ?? 0)) / delta
        : 4 + ((r ?? 0) - (g ?? 0)) / delta;
  hue = (hue * 60 + 360) % 360;
  return `${hue.toFixed(1)} ${(saturation * 100).toFixed(1)}% ${(lightness * 100).toFixed(1)}%`;
}

export function themeProfileCssVariables(profile: ThemeProfile): Record<string, string> {
  return {
    '--background': hexToHslChannels(profile.common.appBackground),
    '--foreground': hexToHslChannels(profile.common.primaryText),
    '--card': hexToHslChannels(profile.common.cardBackground),
    '--card-foreground': hexToHslChannels(profile.common.primaryText),
    '--primary': hexToHslChannels(profile.controls.primaryButton),
    '--primary-foreground': hexToHslChannels(profile.controls.primaryButtonText),
    '--secondary': hexToHslChannels(profile.controls.secondaryButton),
    '--secondary-foreground': hexToHslChannels(profile.controls.secondaryButtonText),
    '--muted': hexToHslChannels(profile.surfaces.hover),
    '--muted-foreground': hexToHslChannels(profile.text.secondary),
    '--accent': hexToHslChannels(profile.surfaces.selected),
    '--accent-foreground': hexToHslChannels(profile.text.body),
    '--destructive': hexToHslChannels(profile.controls.dangerButton),
    '--destructive-foreground': hexToHslChannels(profile.controls.dangerButtonText),
    '--success': hexToHslChannels(profile.statuses.success),
    '--border': hexToHslChannels(profile.surfaces.border),
    '--input': hexToHslChannels(profile.surfaces.input),
    '--ring': hexToHslChannels(profile.surfaces.focus),
    '--heading': hexToHslChannels(profile.text.sectionTitle),
    '--recurrence': hexToHslChannels(profile.calendar.recurringMeeting),
    '--recurrence-background': hexToHslChannels(profile.calendar.background),
    '--semantic-sidebar': profile.common.sidebarBackground,
    '--semantic-link': profile.text.link,
    '--semantic-warning': profile.text.warning,
    '--semantic-calendar-today': profile.calendar.today,
    '--semantic-calendar-selected': profile.calendar.selectedDate,
    '--semantic-desktop-background': profile.desktopWidget.background,
  };
}

export function applyThemeProfile(profile: ThemeProfile | null): void {
  const root = document.documentElement;
  const previous = root.getAttribute('data-theme-profile-vars');
  if (previous !== null) {
    for (const name of previous.split(',')) root.style.removeProperty(name);
  }
  if (profile === null) {
    setProgressSegmentPalette(null);
    root.removeAttribute('data-theme-profile');
    root.removeAttribute('data-theme-profile-vars');
    return;
  }
  setProgressSegmentPalette(
    profile.progressPalette.enabled ? profile.progressPalette.colors : null,
  );
  const variables = themeProfileCssVariables(profile);
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
  root.setAttribute('data-theme-profile', profile.id);
  root.setAttribute('data-theme-profile-vars', Object.keys(variables).join(','));
}
