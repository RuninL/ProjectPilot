import { describe, expect, it } from 'vitest';
import {
  applyThemeProfile,
  contrastRatio,
  createSafeThemeProfile,
  normalizeThemeProfile,
  rateContrast,
  themeProfileCssVariables,
  validateProgressPalette,
} from '@/features/settings/theme/themeProfile';
import {
  exportThemeProfile,
  importThemeProfile,
  parseThemeProfileBundle,
} from '@/features/settings/services/themeProfile.service';

describe('semantic theme profiles', () => {
  it('fills missing future tokens from the selected safe base', () => {
    const safe = createSafeThemeProfile('warm', {
      id: 'custom:one',
      name: '暖色',
      now: '2026-08-02T00:00:00.000Z',
    });
    const normalized = normalizeThemeProfile({
      ...safe,
      common: { primaryAccent: '#123456' },
    });

    expect(normalized.common.primaryAccent).toBe('#123456');
    expect(normalized.common.appBackground).toBe(safe.common.appBackground);
    expect(normalized.calendar.grid).toBe(safe.calendar.grid);
  });

  it.each([
    '#fff',
    'red',
    'url(https://example.com/x)',
    'var(--primary)',
    '#ffffff; color: red',
    '<script>alert(1)</script>',
  ])('rejects unsupported or injectable color %s', (color) => {
    const safe = createSafeThemeProfile();
    expect(() =>
      normalizeThemeProfile({
        ...safe,
        text: { ...safe.text, body: color },
      }),
    ).toThrow();
  });

  it('rates readable and unreadable contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(rateContrast('#000000', '#ffffff')).toBe('good');
    expect(rateContrast('#777777', '#ffffff')).toBe('marginal');
    expect(rateContrast('#eeeeee', '#ffffff')).toBe('poor');
  });

  it('keeps the safe progress palette and reports unsafe palettes', () => {
    const safe = createSafeThemeProfile();
    expect(validateProgressPalette(safe.progressPalette.colors)).toEqual([]);
    expect(validateProgressPalette(Array.from({ length: 6 }, () => '#ffffff'))).toContain(
      '六种颜色不能完全相同。',
    );
  });

  it('maps semantic values to safe CSS variables and cleans them up', () => {
    const profile = createSafeThemeProfile('light', {
      id: 'custom:css',
      name: 'CSS',
      now: '2026-08-02T00:00:00.000Z',
    });
    expect(themeProfileCssVariables(profile)['--semantic-link']).toBe(profile.text.link);

    applyThemeProfile(profile);
    expect(document.documentElement.dataset.themeProfile).toBe(profile.id);
    expect(document.documentElement.style.getPropertyValue('--semantic-link')).toBe(
      profile.text.link,
    );
    applyThemeProfile(null);
    expect(document.documentElement.dataset.themeProfile).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue('--semantic-link')).toBe('');
  });

  it('round-trips profile JSON and resolves imported id and name conflicts', () => {
    const original = createSafeThemeProfile('dark', {
      id: 'custom:same',
      name: '我的主题',
      now: '2026-08-02T00:00:00.000Z',
    });
    const imported = importThemeProfile(exportThemeProfile(original), [original]);
    expect(imported.id).not.toBe(original.id);
    expect(imported.name).toBe('我的主题（导入）');
  });

  it('falls back when a stored selected profile is invalid', () => {
    const bundle = parseThemeProfileBundle(
      JSON.stringify({
        schemaVersion: 1,
        selectedProfileId: 'missing',
        profiles: [],
      }),
    );
    expect(bundle.selectedProfileId).toBeNull();
  });
});
