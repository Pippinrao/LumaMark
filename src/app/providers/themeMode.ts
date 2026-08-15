import type { ThemeMode } from '../stores/appPreferencesStore';

export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>;

const SYSTEM_DARK_THEME_QUERY = '(prefers-color-scheme: dark)';

export function resolveThemeMode(
  theme: ThemeMode,
  matchMedia: typeof globalThis.matchMedia | undefined = globalThis.matchMedia,
): ResolvedThemeMode {
  if (theme !== 'system') {
    return theme;
  }

  return matchMedia?.(SYSTEM_DARK_THEME_QUERY).matches ? 'dark' : 'light';
}

export function applyResolvedTheme(theme: ResolvedThemeMode): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function observeSystemTheme(
  onChange: (theme: ResolvedThemeMode) => void,
  matchMedia: typeof globalThis.matchMedia | undefined = globalThis.matchMedia,
): (() => void) | undefined {
  if (!matchMedia) {
    onChange('light');
    return undefined;
  }

  const query = matchMedia(SYSTEM_DARK_THEME_QUERY);
  const applyQuery = (matches: boolean) => onChange(matches ? 'dark' : 'light');
  const listener = (event: MediaQueryListEvent) => applyQuery(event.matches);

  applyQuery(query.matches);
  query.addEventListener('change', listener);

  return () => query.removeEventListener('change', listener);
}
