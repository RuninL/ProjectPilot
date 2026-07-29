import type { Theme } from '@/lib/theme';
import { nowIso } from '@/lib/date';
import { getRepositories } from '@/repositories';

const THEME_KEY = 'theme';

function isTheme(value: string): value is Theme {
  return value === 'dark' || value === 'light' || value === 'system';
}

export async function loadThemePreference(): Promise<Theme | null> {
  const repositories = await getRepositories();
  const setting = await repositories.appSettings.get(THEME_KEY);
  return setting !== null && isTheme(setting.value) ? setting.value : null;
}

export async function saveThemePreference(theme: Theme): Promise<void> {
  const repositories = await getRepositories();
  await repositories.appSettings.set(THEME_KEY, theme, nowIso());
}
