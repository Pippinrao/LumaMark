import { i18n } from '../shared/i18n';
import {
  type AppPreferencesState,
  useAppPreferencesStore,
} from './stores/appPreferencesStore';

type StartupPreferences = Pick<AppPreferencesState, 'language' | 'theme'>;

export async function bootstrapApp(
  renderApp: () => void,
  preferences: StartupPreferences = useAppPreferencesStore.getState(),
): Promise<void> {
  const { language, theme } = preferences;

  document.documentElement.lang = language;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  if (i18n.resolvedLanguage !== language) {
    await i18n.changeLanguage(language);
  }

  renderApp();
}
