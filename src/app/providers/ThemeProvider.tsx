import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useAppPreferencesStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return children;
}
