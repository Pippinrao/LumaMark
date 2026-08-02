import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppLanguage } from '../../shared/i18n';

type ThemeMode = 'light' | 'dark';

type SettingsDialogProps = {
  copyImagesToAssets: boolean;
  language: AppLanguage;
  onCopyImagesToAssetsChange: (copyImagesToAssets: boolean) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onOpenChange: (open: boolean) => void;
  onReturnFocus: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  open: boolean;
  theme: ThemeMode;
};

export function SettingsDialog({
  copyImagesToAssets,
  language,
  onCopyImagesToAssetsChange,
  onLanguageChange,
  onOpenChange,
  onReturnFocus,
  onThemeChange,
  open,
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
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
