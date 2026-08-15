import * as Tabs from '@radix-ui/react-tabs';
import {
  Image as ImageIcon,
  Palette,
  Settings2,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'images'
  | 'trash';

export function isSettingsSection(value: string): value is SettingsSection {
  return (
    value === 'general' ||
    value === 'appearance' ||
    value === 'editor' ||
    value === 'images' ||
    value === 'trash'
  );
}

export function SettingsNavigation() {
  const { t } = useTranslation();

  return (
    <Tabs.List
      aria-label={t('settings.title')}
      aria-orientation="vertical"
      className="lm-settings-sidebar lm-settings-tab-list lm-settings-tab-list-vertical"
    >
      <Tabs.Trigger data-value="general" value="general">
        <Settings2 aria-hidden="true" size={16} />
        <span>{t('settings.sectionGeneral')}</span>
      </Tabs.Trigger>
      <Tabs.Trigger data-value="appearance" value="appearance">
        <Palette aria-hidden="true" size={16} />
        <span>{t('settings.sectionAppearance')}</span>
      </Tabs.Trigger>
      <Tabs.Trigger data-value="editor" value="editor">
        <SquarePen aria-hidden="true" size={16} />
        <span>{t('settings.sectionEditor')}</span>
      </Tabs.Trigger>
      <Tabs.Trigger data-value="images" value="images">
        <ImageIcon aria-hidden="true" size={16} />
        <span>{t('settings.sectionImages')}</span>
      </Tabs.Trigger>
      <Tabs.Trigger data-value="trash" value="trash">
        <Trash2 aria-hidden="true" size={16} />
        <span>{t('settings.sectionTrash')}</span>
      </Tabs.Trigger>
    </Tabs.List>
  );
}
