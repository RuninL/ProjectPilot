/** User-selectable theme. `system` follows the OS preference. */
export type Theme = 'light' | 'dark' | 'system';

/** The theme actually painted, after resolving `system`. */
export type ResolvedTheme = 'light' | 'dark';

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

/** Paint the theme by toggling the `dark` class Tailwind is configured against. */
export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
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
