import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppLanguage } from '../../shared/i18n';
import type { EditorPageWidth } from '../reading-appearance/readingAppearanceStore';
import type { StartupBehavior } from '../startup/startupStore';

type ThemeMode = 'light' | 'dark';

type SettingsDialogProps = {
  copyImagesToAssets: boolean;
  language: AppLanguage;
  onCopyImagesToAssetsChange: (copyImagesToAssets: boolean) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onOpenChange: (open: boolean) => void;
  onPageWidthChange: (pageWidth: EditorPageWidth) => void;
  onReturnFocus: () => void;
  onStartupBehaviorChange: (startupBehavior: StartupBehavior) => void;
  onThemeChange: (theme: ThemeMode) => void;
  open: boolean;
  pageWidth: EditorPageWidth;
  pageWidthPersistenceError: boolean;
  recentFilesPersistenceError: boolean;
  startupBehavior: StartupBehavior;
  startupPersistenceError: boolean;
  theme: ThemeMode;
};

export function SettingsDialog({
  copyImagesToAssets,
  language,
  onCopyImagesToAssetsChange,
  onLanguageChange,
  onOpenChange,
  onPageWidthChange,
  onReturnFocus,
  onStartupBehaviorChange,
  onThemeChange,
  open,
  pageWidth,
  pageWidthPersistenceError,
  recentFilesPersistenceError,
  startupBehavior,
  startupPersistenceError,
  theme,
}: SettingsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="lm-dialog-overlay" />
        <Dialog.Content
          className="lm-settings-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
        >
          <div className="lm-dialog-title-row">
            <Dialog.Title>{t('settings.title')}</Dialog.Title>
            <Dialog.Close className="lm-icon-button" aria-label={t('dialog.close')}>
              <X size={16} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="lm-dialog-description">
            {t('settings.description')}
          </Dialog.Description>

          <Tabs.Root defaultValue="appearance" className="lm-settings-tabs">
            <Tabs.List className="lm-settings-tab-list">
              <Tabs.Trigger value="appearance">{t('settings.appearance')}</Tabs.Trigger>
              <Tabs.Trigger value="language">{t('settings.language')}</Tabs.Trigger>
              <Tabs.Trigger value="images">{t('settings.images')}</Tabs.Trigger>
              <Tabs.Trigger value="startup">{t('settings.startup')}</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="appearance" className="lm-settings-panel">
              <div className="lm-setting-row">
                <span>{t('settings.theme')}</span>
                <div className="lm-segmented-control">
                  <button
                    type="button"
                    aria-pressed={theme === 'light'}
                    onClick={() => {
                      onThemeChange('light');
                    }}
                  >
                    {t('settings.themeLight')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={theme === 'dark'}
                    onClick={() => {
                      onThemeChange('dark');
                    }}
                  >
                    {t('settings.themeDark')}
                  </button>
                </div>
              </div>
              <div className="lm-setting-row">
                <span>{t('settings.pageWidth')}</span>
                <div
                  aria-label={t('settings.pageWidth')}
                  className="lm-segmented-control"
                  role="group"
                >
                  <button
                    type="button"
                    aria-pressed={pageWidth === 'narrow'}
                    onClick={() => {
                      onPageWidthChange('narrow');
                    }}
                  >
                    {t('settings.pageWidthNarrow')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={pageWidth === 'standard'}
                    onClick={() => {
                      onPageWidthChange('standard');
                    }}
                  >
                    {t('settings.pageWidthStandard')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={pageWidth === 'wide'}
                    onClick={() => {
                      onPageWidthChange('wide');
                    }}
                  >
                    {t('settings.pageWidthWide')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={pageWidth === 'fluid'}
                    onClick={() => {
                      onPageWidthChange('fluid');
                    }}
                  >
                    {t('settings.pageWidthFluid')}
                  </button>
                </div>
              </div>
              {pageWidthPersistenceError ? (
                <p className="lm-setting-error" role="alert">
                  {t('settings.pageWidthPersistenceError')}
                </p>
              ) : null}
            </Tabs.Content>
            <Tabs.Content value="language" className="lm-settings-panel">
              <div className="lm-setting-row">
                <span>{t('settings.language')}</span>
                <div className="lm-segmented-control">
                  <button
                    type="button"
                    aria-pressed={language === 'zh-CN'}
                    onClick={() => {
                      onLanguageChange('zh-CN');
                    }}
                  >
                    {t('settings.languageChinese')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={language === 'en'}
                    onClick={() => {
                      onLanguageChange('en');
                    }}
                  >
                    {t('settings.languageEnglish')}
                  </button>
                </div>
              </div>
            </Tabs.Content>
            <Tabs.Content value="images" className="lm-settings-panel">
              <label className="lm-setting-row">
                <span>{t('settings.copyImagesToAssets')}</span>
                <input
                  checked={copyImagesToAssets}
                  onChange={(event) => {
                    onCopyImagesToAssetsChange(event.currentTarget.checked);
                  }}
                  type="checkbox"
                />
              </label>
            </Tabs.Content>
            <Tabs.Content value="startup" className="lm-settings-panel">
              <div className="lm-setting-row">
                <span>{t('settings.startupBehavior')}</span>
                <div className="lm-segmented-control">
                  <button
                    aria-pressed={startupBehavior === 'home'}
                    onClick={() => { onStartupBehaviorChange('home'); }}
                    type="button"
                  >
                    {t('settings.startupHome')}
                  </button>
                  <button
                    aria-pressed={startupBehavior === 'restoreLastSession'}
                    onClick={() => { onStartupBehaviorChange('restoreLastSession'); }}
                    type="button"
                  >
                    {t('settings.startupRestore')}
                  </button>
                </div>
              </div>
              {startupPersistenceError ? (
                <p className="lm-setting-error" role="alert">
                  {t('settings.startupPersistenceError')}
                </p>
              ) : null}
              {recentFilesPersistenceError ? (
                <p className="lm-setting-error" role="alert">
                  {t('settings.recentFilesPersistenceError')}
                </p>
              ) : null}
            </Tabs.Content>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
