import { i18n } from '../shared/i18n';
import { applySettingsToLegacyStores } from './controllers/applySettings';
import { useRecentFilesStore } from '../features/recent-files/recentFilesStore';
import { useSettingsStore } from '../features/settings/settingsStore';
import { useAppStore } from './stores/appStore';
import {
  type AppPreferencesState,
  useAppPreferencesStore,
} from './stores/appPreferencesStore';
import { applyResolvedTheme, resolveThemeMode } from './providers/themeMode';

type StartupPreferences = Pick<AppPreferencesState, 'language' | 'theme'>;

export async function bootstrapApp(
  renderApp: () => void,
  preferences?: StartupPreferences,
): Promise<void> {
  try {
    await useSettingsStore.getState().hydrateFromClient();
  } catch {
    // Hydration records a structured read/compatibility error before rejecting.
    // Continue with in-memory defaults so the recovery UI can stay available.
  }

  try {
    await useRecentFilesStore.getState().hydrateFromClient();
  } catch {
    // The recent-files store keeps its optimistic in-memory state and exposes
    // a persistence error without preventing the application from starting.
  }

  const settings = useSettingsStore.getState().settings;
  applySettingsToLegacyStores(settings);
  useAppStore
    .getState()
    .setSidebarOpen(settings.appearance.sidebarOpenOnStartup);

  const resolved =
    preferences ??
    ({
      language: useAppPreferencesStore.getState().language,
      theme: useAppPreferencesStore.getState().theme,
    } satisfies StartupPreferences);
  const { language, theme } = resolved;

  document.documentElement.lang = language;
  applyResolvedTheme(resolveThemeMode(theme));

  if (i18n.resolvedLanguage !== language) {
    await i18n.changeLanguage(language);
  }

  renderApp();
}
