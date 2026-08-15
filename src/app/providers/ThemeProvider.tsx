import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import { applyResolvedTheme, observeSystemTheme } from './themeMode';

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useAppPreferencesStore((state) => state.theme);

  useEffect(() => {
    if (theme === 'system') {
      return observeSystemTheme(applyResolvedTheme);
    }

    applyResolvedTheme(theme);
    return undefined;
  }, [theme]);

  return children;
}
