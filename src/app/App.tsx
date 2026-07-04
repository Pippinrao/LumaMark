import { I18nProvider } from './providers/I18nProvider';
import { ThemeProvider } from './providers/ThemeProvider';
import { AppShell } from './shell/AppShell';

export function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </I18nProvider>
  );
}
