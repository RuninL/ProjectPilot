import { z } from 'zod';
import { nowIso } from '@/lib/date';
import { newId } from '@/lib/uuid';
import { getRepositories } from '@/repositories';
import {
  createSafeThemeProfile,
  normalizeThemeProfile,
  themeProfileSchema,
  type ThemeProfile,
} from '../theme/themeProfile';

const THEME_PROFILES_KEY = 'themes.profiles.v1';

const storedBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    selectedProfileId: z.string().nullable(),
    profiles: z.array(z.unknown()).max(100),
  })
  .strict();

export interface ThemeProfileBundle {
  schemaVersion: 1;
  selectedProfileId: string | null;
  profiles: ThemeProfile[];
}

export const EMPTY_THEME_PROFILE_BUNDLE: ThemeProfileBundle = {
  schemaVersion: 1,
  selectedProfileId: null,
  profiles: [],
};

export function parseThemeProfileBundle(value: string): ThemeProfileBundle {
  const parsed = storedBundleSchema.parse(JSON.parse(value) as unknown);
  const profiles = parsed.profiles.flatMap((profile) => {
    try {
      return [normalizeThemeProfile(profile)];
    } catch {
      return [];
    }
  });
  const uniqueProfiles = [...new Map(profiles.map((profile) => [profile.id, profile])).values()];
  const selectedProfileId =
    parsed.selectedProfileId !== null &&
    uniqueProfiles.some((profile) => profile.id === parsed.selectedProfileId)
      ? parsed.selectedProfileId
      : null;
  return { schemaVersion: 1, selectedProfileId, profiles: uniqueProfiles };
}

export async function loadThemeProfileBundle(): Promise<ThemeProfileBundle> {
  const setting = await (await getRepositories()).appSettings.get(THEME_PROFILES_KEY);
  if (setting === null) return EMPTY_THEME_PROFILE_BUNDLE;
  try {
    return parseThemeProfileBundle(setting.value);
  } catch {
    return EMPTY_THEME_PROFILE_BUNDLE;
  }
}

export async function saveThemeProfileBundle(bundle: ThemeProfileBundle): Promise<void> {
  const validated: ThemeProfileBundle = {
    schemaVersion: 1,
    selectedProfileId:
      bundle.selectedProfileId !== null &&
      bundle.profiles.some((profile) => profile.id === bundle.selectedProfileId)
        ? bundle.selectedProfileId
        : null,
    profiles: bundle.profiles.map((profile) => themeProfileSchema.parse(profile)),
  };
  await (
    await getRepositories()
  ).appSettings.set(THEME_PROFILES_KEY, JSON.stringify(validated), nowIso());
}

export function createCustomThemeProfile(
  baseTheme: ThemeProfile['baseTheme'],
  name: string,
): ThemeProfile {
  return createSafeThemeProfile(baseTheme, {
    id: `custom:${newId()}`,
    name,
  });
}

export function exportThemeProfile(profile: ThemeProfile): string {
  return JSON.stringify(themeProfileSchema.parse(profile), null, 2);
}

export function importThemeProfile(
  contents: string,
  existing: readonly ThemeProfile[],
): ThemeProfile {
  const imported = normalizeThemeProfile(JSON.parse(contents) as unknown);
  const now = nowIso();
  const ids = new Set(existing.map((profile) => profile.id));
  const names = new Set(existing.map((profile) => profile.name));
  const name = names.has(imported.name) ? `${imported.name}（导入）` : imported.name;
  return {
    ...imported,
    id: ids.has(imported.id) ? `custom:${newId()}` : imported.id,
    name,
    createdAt: now,
    updatedAt: now,
  };
}

export function activeThemeProfile(bundle: ThemeProfileBundle): ThemeProfile | null {
  return bundle.profiles.find((profile) => profile.id === bundle.selectedProfileId) ?? null;
}
