/**
 * User-selectable theme. `system` follows the OS preference (dark/light).
 * `warm` is a soft orange-on-white palette; `colorful` is a vibrant,
 * VS Code-inspired multi-hue palette.
 */
export type Theme = 'light' | 'dark' | 'system' | 'warm' | 'colorful';

/** The theme actually painted, after resolving `system`. */
export type ResolvedTheme = 'light' | 'dark' | 'warm' | 'colorful';

/** All persistable theme values, for validation of stored preferences. */
export const THEME_VALUES: readonly Theme[] = ['light', 'dark', 'system', 'warm', 'colorful'];

export function isTheme(value: string): value is Theme {
  return (THEME_VALUES as readonly string[]).includes(value);
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function noop(): void {
  // no-op unsubscribe used when matchMedia is unavailable
}

function matchDarkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(DARK_QUERY);
}

/**
 * Resolve `system` against the OS preference. When matchMedia is unavailable
 * (jsdom, older webviews) we fall back to dark, matching the product's
 * dark-first default rather than silently flipping to light.
 */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') {
    return theme;
  }
  const prefersDark = matchDarkQuery()?.matches ?? true;
  return prefersDark ? 'dark' : 'light';
}

/**
 * Paint the theme by toggling the `dark` class Tailwind is configured against,
 * plus the `theme-warm` / `theme-colorful` classes that swap the CSS palette.
 */
export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  // `colorful` is a dark-based palette, so it keeps the `dark` class and the
  // `.theme-colorful` variables (declared after `.dark`) override the colors.
  root.classList.toggle('dark', resolved === 'dark' || resolved === 'colorful');
  root.classList.toggle('theme-warm', resolved === 'warm');
  root.classList.toggle('theme-colorful', resolved === 'colorful');
  return resolved;
}

/** Watch OS theme changes. Returns an unsubscribe function. */
export function subscribeToSystemTheme(onChange: () => void): () => void {
  const query = matchDarkQuery();
  if (query === null) {
    return noop;
  }
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}
