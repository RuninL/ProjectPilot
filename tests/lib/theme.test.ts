import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, resolveTheme, subscribeToSystemTheme } from '@/lib/theme';

interface FakeQuery {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function stubMatchMedia(matches: boolean): FakeQuery {
  const query: FakeQuery = {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  return query;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark', 'theme-warm', 'theme-colorful');
});

describe('resolveTheme', () => {
  it('returns explicit themes unchanged', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('warm')).toBe('warm');
    expect(resolveTheme('colorful')).toBe('colorful');
  });

  it('follows the OS preference for system', () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
    stubMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('falls back to dark when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveTheme('system')).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('adds the dark class for dark and removes it for light', () => {
    expect(applyTheme('dark')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    expect(applyTheme('light')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('applies theme-warm as a light-based palette', () => {
    expect(applyTheme('warm')).toBe('warm');
    expect(document.documentElement.classList.contains('theme-warm')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('applies theme-colorful as a dark-based palette', () => {
    expect(applyTheme('colorful')).toBe('colorful');
    expect(document.documentElement.classList.contains('theme-colorful')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('clears palette classes when switching back to light', () => {
    applyTheme('colorful');
    expect(applyTheme('light')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('theme-warm')).toBe(false);
    expect(document.documentElement.classList.contains('theme-colorful')).toBe(false);
  });
});

describe('subscribeToSystemTheme', () => {
  it('registers and removes the change listener', () => {
    const query = stubMatchMedia(true);
    const onChange = vi.fn();

    const unsubscribe = subscribeToSystemTheme(onChange);
    expect(query.addEventListener).toHaveBeenCalledWith('change', onChange);

    unsubscribe();
    expect(query.removeEventListener).toHaveBeenCalledWith('change', onChange);
  });

  it('returns a safe no-op when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => {
      subscribeToSystemTheme(vi.fn())();
    }).not.toThrow();
  });
});
