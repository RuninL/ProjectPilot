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
  document.documentElement.classList.remove('dark');
});

describe('resolveTheme', () => {
  it('returns explicit themes unchanged', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
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
