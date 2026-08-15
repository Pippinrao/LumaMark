import * as Tabs from '@radix-ui/react-tabs';
import { useTranslation } from 'react-i18next';
import {
  MAX_SETTINGS_FONT_ZOOM_PERCENT,
  MIN_SETTINGS_FONT_ZOOM_PERCENT,
  SETTINGS_FONT_ZOOM_STEP_PERCENT,
  type SettingsOpenWindowMode,
  type SettingsTheme,
} from '../../services/settings/settingsTypes';
import type { AppLanguage } from '../../shared/i18n';
import type { EditorPageWidth } from '../reading-appearance/readingAppearanceStore';
import type { StartupBehavior } from '../startup/startupStore';
import { ClearRecentFilesDialog } from './ClearRecentFilesDialog';
import {
  SettingRow,
  SettingsGroup,
  SettingsPageHeader,
  SettingsRadioGroup,
  SettingsSwitch,
  ZoomStepper,
} from './SettingsPrimitives';

export type SettingsDisplayMode = 'livePreview' | 'source';

type GeneralSettingsPageProps = {
  autoCheckUpdates: boolean;
  clearRecentFilesOpen: boolean;
  language: AppLanguage;
  onAutoCheckUpdatesChange: (autoCheckUpdates: boolean) => void;
  onClearRecentFiles: () => void;
  onClearRecentFilesEscape: () => void;
  onClearRecentFilesOpenChange: (open: boolean) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onOpenWindowModeChange: (mode: SettingsOpenWindowMode) => void;
  onStartupBehaviorChange: (startupBehavior: StartupBehavior) => void;
  openWindowMode: SettingsOpenWindowMode;
  recentFilesPersistenceError: boolean;
  startupBehavior: StartupBehavior;
  startupPersistenceError: boolean;
};

export function GeneralSettingsPage({
  autoCheckUpdates,
  clearRecentFilesOpen,
  language,
  onAutoCheckUpdatesChange,
  onClearRecentFiles,
  onClearRecentFilesEscape,
  onClearRecentFilesOpenChange,
  onLanguageChange,
  onOpenWindowModeChange,
  onStartupBehaviorChange,
  openWindowMode,
  recentFilesPersistenceError,
  startupBehavior,
  startupPersistenceError,
}: GeneralSettingsPageProps) {
  const { t } = useTranslation();

  return (
    <Tabs.Content
      className="lm-settings-panel lm-settings-page"
      data-value="general"
      value="general"
    >
      <SettingsPageHeader
        description={t('settings.generalDescription')}
        title={t('settings.sectionGeneral')}
      />
      <SettingsGroup title={t('settings.groupLanguageRegion')}>
        <SettingRow
          description={t('settings.languageDescription')}
          label={t('settings.language')}
        >
          <SettingsRadioGroup
            label={t('settings.language')}
            onValueChange={onLanguageChange}
            options={[
              { label: t('settings.languageChinese'), value: 'zh-CN' },
              { label: t('settings.languageEnglish'), value: 'en' },
            ]}
            value={language}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={t('settings.groupStartup')}>
        <SettingRow
          description={t('settings.startupBehaviorDescription')}
          label={t('settings.startupBehavior')}
        >
          <SettingsRadioGroup
            label={t('settings.startupBehavior')}
            onValueChange={onStartupBehaviorChange}
            options={[
              { label: t('settings.startupHome'), value: 'home' },
              {
                label: t('settings.startupRestore'),
                value: 'restoreLastSession',
              },
            ]}
            value={startupBehavior}
          />
        </SettingRow>
        <SettingRow
          description={t('settings.openWindowModeDescription')}
          label={t('settings.openWindowMode')}
        >
          <SettingsRadioGroup
            label={t('settings.openWindowMode')}
            onValueChange={onOpenWindowModeChange}
            options={[
              {
                label: t('settings.openWindowModeMulti'),
                value: 'multiWindow',
              },
              {
                label: t('settings.openWindowModeAggregate'),
                value: 'aggregateWindow',
              },
            ]}
            value={openWindowMode}
          />
        </SettingRow>
        <SettingsSwitch
          checked={autoCheckUpdates}
          description={t('settings.autoCheckUpdatesDescription')}
          label={t('settings.autoCheckUpdates')}
          onCheckedChange={onAutoCheckUpdatesChange}
        />
        {startupPersistenceError ? (
          <p className="lm-setting-error" role="alert">
            {t('settings.startupPersistenceError')}
          </p>
        ) : null}
      </SettingsGroup>
      <SettingsGroup title={t('settings.groupRecentItems')}>
        <ClearRecentFilesDialog
          onConfirm={onClearRecentFiles}
          onEscape={onClearRecentFilesEscape}
          onOpenChange={onClearRecentFilesOpenChange}
          open={clearRecentFilesOpen}
        />
        {recentFilesPersistenceError ? (
          <p className="lm-setting-error" role="alert">
            {t('settings.recentFilesPersistenceError')}
          </p>
        ) : null}
      </SettingsGroup>
    </Tabs.Content>
  );
}

type AppearanceSettingsPageProps = {
  fontZoomDraft: string;
  fontZoomPercent: number;
  onFontZoomBlur: () => void;
  onFontZoomDraftChange: (draft: string) => void;
  onFontZoomPercentChange: (fontZoomPercent: number) => void;
  onPageWidthChange: (pageWidth: EditorPageWidth) => void;
  onSidebarOpenOnStartupChange: (sidebarOpenOnStartup: boolean) => void;
  onThemeChange: (theme: SettingsTheme) => void;
  pageWidth: EditorPageWidth;
  pageWidthPersistenceError: boolean;
  sidebarOpenOnStartup: boolean;
  theme: SettingsTheme;
};

export function AppearanceSettingsPage({
  fontZoomDraft,
  fontZoomPercent,
  onFontZoomBlur,
  onFontZoomDraftChange,
  onFontZoomPercentChange,
  onPageWidthChange,
  onSidebarOpenOnStartupChange,
  onThemeChange,
  pageWidth,
  pageWidthPersistenceError,
  sidebarOpenOnStartup,
  theme,
}: AppearanceSettingsPageProps) {
  const { t } = useTranslation();

  return (
    <Tabs.Content
      className="lm-settings-panel lm-settings-page"
      data-value="appearance"
      value="appearance"
    >
      <SettingsPageHeader
        description={t('settings.appearanceDescription')}
        title={t('settings.sectionAppearance')}
      />
      <SettingsGroup title={t('settings.groupTheme')}>
        <SettingRow
          description={t('settings.themeDescription')}
          label={t('settings.theme')}
        >
          <SettingsRadioGroup
            label={t('settings.theme')}
            onValueChange={onThemeChange}
            options={[
              { label: t('settings.themeLight'), value: 'light' },
              { label: t('settings.themeDark'), value: 'dark' },
              { label: t('settings.themeSystem'), value: 'system' },
            ]}
            value={theme}
            variant="themeCards"
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={t('settings.groupWritingCanvas')}>
        <SettingRow
          description={t('settings.pageWidthDescription')}
          label={t('settings.pageWidth')}
        >
          <SettingsRadioGroup
            label={t('settings.pageWidth')}
            onValueChange={onPageWidthChange}
            options={[
              { label: t('settings.pageWidthNarrow'), value: 'narrow' },
              { label: t('settings.pageWidthStandard'), value: 'standard' },
              { label: t('settings.pageWidthWide'), value: 'wide' },
              { label: t('settings.pageWidthFluid'), value: 'fluid' },
            ]}
            value={pageWidth}
            variant="pageWidthCards"
          />
        </SettingRow>
        <ZoomStepper
          decreaseLabel={t('settings.fontZoomDecrease')}
          description={t('settings.fontZoomDescription')}
          draft={fontZoomDraft}
          increaseLabel={t('settings.fontZoomIncrease')}
          label={t('settings.fontZoom')}
          max={MAX_SETTINGS_FONT_ZOOM_PERCENT}
          min={MIN_SETTINGS_FONT_ZOOM_PERCENT}
          onBlur={onFontZoomBlur}
          onDraftChange={onFontZoomDraftChange}
          onValueChange={onFontZoomPercentChange}
          step={SETTINGS_FONT_ZOOM_STEP_PERCENT}
          value={fontZoomPercent}
        />
        <SettingsSwitch
          checked={sidebarOpenOnStartup}
          description={t('settings.sidebarOpenOnStartupDescription')}
          label={t('settings.sidebarOpenOnStartup')}
          onCheckedChange={onSidebarOpenOnStartupChange}
        />
        {pageWidthPersistenceError ? (
          <p className="lm-setting-error" role="alert">
            {t('settings.pageWidthPersistenceError')}
          </p>
        ) : null}
      </SettingsGroup>
    </Tabs.Content>
  );
}

type EditorSettingsPageProps = {
  defaultDisplayMode: SettingsDisplayMode;
  focusModeOnStartup: boolean;
  onDefaultDisplayModeChange: (mode: SettingsDisplayMode) => void;
  onFocusModeOnStartupChange: (focusModeOnStartup: boolean) => void;
};

export function EditorSettingsPage({
  defaultDisplayMode,
  focusModeOnStartup,
  onDefaultDisplayModeChange,
  onFocusModeOnStartupChange,
}: EditorSettingsPageProps) {
  const { t } = useTranslation();

  return (
    <Tabs.Content
      className="lm-settings-panel lm-settings-page"
      data-value="editor"
      value="editor"
    >
      <SettingsPageHeader
        description={t('settings.editorDescription')}
        title={t('settings.sectionEditor')}
      />
      <SettingsGroup title={t('settings.groupEditorDefaults')}>
        <SettingRow
          description={t('settings.defaultDisplayModeDescription')}
          label={t('settings.defaultDisplayMode')}
        >
          <SettingsRadioGroup
            label={t('settings.defaultDisplayMode')}
            onValueChange={onDefaultDisplayModeChange}
            options={[
              {
                label: t('settings.displayLivePreview'),
                value: 'livePreview',
              },
              { label: t('settings.displaySource'), value: 'source' },
            ]}
            value={defaultDisplayMode}
          />
        </SettingRow>
        <SettingsSwitch
          checked={focusModeOnStartup}
          description={t('settings.focusModeOnStartupDescription')}
          label={t('settings.focusModeOnStartup')}
          onCheckedChange={onFocusModeOnStartupChange}
        />
      </SettingsGroup>
    </Tabs.Content>
  );
}

type ImagesSettingsPageProps = {
  copyImagesToAssets: boolean;
  onCopyImagesToAssetsChange: (copyImagesToAssets: boolean) => void;
};

export function ImagesSettingsPage({
  copyImagesToAssets,
  onCopyImagesToAssetsChange,
}: ImagesSettingsPageProps) {
  const { t } = useTranslation();

  return (
    <Tabs.Content
      className="lm-settings-panel lm-settings-page"
      data-value="images"
      value="images"
    >
      <SettingsPageHeader
        description={t('settings.imagesDescription')}
        title={t('settings.sectionImages')}
      />
      <SettingsGroup title={t('settings.groupImageHandling')}>
        <SettingsSwitch
          checked={copyImagesToAssets}
          description={t('settings.copyImagesToAssetsDescription')}
          label={t('settings.copyImagesToAssets')}
          onCheckedChange={onCopyImagesToAssetsChange}
        />
      </SettingsGroup>
    </Tabs.Content>
  );
}
