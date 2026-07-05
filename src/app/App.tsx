import { lazy, Suspense } from 'react';
import { I18nProvider } from './providers/I18nProvider';
import { ThemeProvider } from './providers/ThemeProvider';

const LazyAppShell = lazy(() =>
  import('./shell/AppShell').then((module) => ({
    default: module.AppShell,
  })),
);

export function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <Suspense fallback={null}>
          <LazyAppShell />
        </Suspense>
      </ThemeProvider>
    </I18nProvider>
  );
}
