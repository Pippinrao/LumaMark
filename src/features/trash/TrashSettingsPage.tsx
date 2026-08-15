import * as Tabs from '@radix-ui/react-tabs';
import { useTranslation } from 'react-i18next';

import type { TrashDocument, TrashEntry } from '../../services/trash/trashClient';
import {
  SettingRow,
  SettingsGroup,
  SettingsPageHeader,
} from '../settings/SettingsPrimitives';

type TrashSettingsPageProps = {
  emptyBusy: boolean;
  entries: TrashEntry[];
  loadError: string | null;
  onEmpty: () => void;
  onPreview: (id: string) => void;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
  preview: TrashDocument | null;
  previewBusy: boolean;
  restoreBusyId: string | null;
};

export function TrashSettingsPage({
  emptyBusy,
  entries,
  loadError,
  onEmpty,
  onPreview,
  onRemove,
  onRestore,
  preview,
  previewBusy,
  restoreBusyId,
}: TrashSettingsPageProps) {
  const { t } = useTranslation();

  return (
    <Tabs.Content
      aria-label={t('settings.sectionTrash')}
      className="lm-settings-panel lm-settings-page"
      data-value="trash"
      value="trash"
    >
      <SettingsPageHeader
        description={t('settings.trashDescription')}
        title={t('settings.sectionTrash')}
      />
      <SettingsGroup title={t('settings.groupTrashSnapshots')}>
        {loadError ? (
          <p className="lm-setting-error" role="alert">
            {t('settings.trashLoadError')}
          </p>
        ) : null}
        {entries.length === 0 && !loadError ? (
          <p className="lm-setting-description">{t('settings.trashEmpty')}</p>
        ) : null}
        {entries.map((entry) => (
          <article className="lm-setting-row" key={entry.id}>
            <div className="lm-setting-copy">
              <span className="lm-setting-label">
                {entry.sourcePath ?? t('settings.trashUntitled')}
              </span>
              <p className="lm-setting-description">
                {new Date(entry.createdAtMs).toLocaleString()}
              </p>
            </div>
            <div className="lm-setting-control">
              <button
                className="lm-button"
                onClick={() => onPreview(entry.id)}
                type="button"
              >
                {t('settings.trashPreview')}
              </button>
              <button
                className="lm-button"
                disabled={restoreBusyId === entry.id}
                onClick={() => onRestore(entry.id)}
                type="button"
              >
                {t('settings.trashRestore')}
              </button>
              <button
                className="lm-danger-button"
                onClick={() => onRemove(entry.id)}
                type="button"
              >
                {t('settings.trashDelete')}
              </button>
            </div>
          </article>
        ))}
        {preview ? (
          <pre aria-live="polite" className="lm-setting-description">
            {previewBusy ? t('settings.trashPreview') : preview.text}
          </pre>
        ) : null}
        <SettingRow
          description={t('settings.trashDescription')}
          label={t('settings.trashEmptyAction')}
        >
          <button
            className="lm-danger-button"
            disabled={emptyBusy || entries.length === 0}
            onClick={onEmpty}
            type="button"
          >
            {t('settings.trashEmptyAction')}
          </button>
        </SettingRow>
      </SettingsGroup>
    </Tabs.Content>
  );
}
