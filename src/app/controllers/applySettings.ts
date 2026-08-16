import { useReadingAppearanceStore } from '../../features/reading-appearance/readingAppearanceStore';
import { useSettingsStore } from '../../features/settings/settingsStore';
import { useStartupStore } from '../../features/startup/startupStore';
import type {
  LumaMarkSettings,
  SettingsMarkdownMath,
  SettingsMarkdownPlantuml,
} from '../../services/settings/settingsTypes';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import { useAppStore } from '../stores/appStore';

/** Project the canonical settings document into legacy runtime consumers. */
export function applySettingsToLegacyStores(settings: LumaMarkSettings): void {
  useAppPreferencesStore.setState({
    language: settings.general.language,
    preferencesPersistenceError: false,
    theme: settings.appearance.theme,
  });
  useReadingAppearanceStore.setState({
    fontZoomPercent: settings.appearance.fontZoomPercent,
    pageWidth: settings.appearance.pageWidth,
    pageWidthPersistenceError: false,
  });
  useAppStore
    .getState()
    .setCopyImagesToAssets(settings.images.copyImagesToAssets);
  useStartupStore.setState({
    startupBehavior: settings.general.startupBehavior,
  });
}

export function patchSettings(
  updater: (current: LumaMarkSettings) => LumaMarkSettings,
): void {
  const canonical = useSettingsStore.getState().updateSettings(updater);
  applySettingsToLegacyStores(canonical);
}

export function patchMarkdownMath(patch: Partial<SettingsMarkdownMath>): void {
  patchSettings((current) => ({
    ...current,
    markdown: {
      ...current.markdown,
      math: { ...current.markdown.math, ...patch },
    },
  }));
}

export function patchMarkdownPlantuml(
  patch: Partial<SettingsMarkdownPlantuml>,
): void {
  patchSettings((current) => ({
    ...current,
    markdown: {
      ...current.markdown,
      plantuml: { ...current.markdown.plantuml, ...patch },
    },
  }));
}

export function syncFontZoomToSettings(fontZoomPercent: number): void {
  patchSettings((current) => ({
    ...current,
    appearance: {
      ...current.appearance,
      fontZoomPercent,
    },
  }));
}
