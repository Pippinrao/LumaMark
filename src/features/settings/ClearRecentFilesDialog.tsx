import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useTranslation } from 'react-i18next';
import { SettingRow } from './SettingsPrimitives';

type ClearRecentFilesDialogProps = {
  onConfirm: () => void;
  onEscape: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function ClearRecentFilesDialog({
  onConfirm,
  onEscape,
  onOpenChange,
  open,
}: ClearRecentFilesDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog.Root onOpenChange={onOpenChange} open={open}>
      <SettingRow
        description={t('settings.clearRecentFilesDescription')}
        label={t('settings.clearRecentFiles')}
      >
        <AlertDialog.Trigger asChild>
          <button className="lm-button" type="button">
            {t('settings.clearRecentFiles')}
          </button>
        </AlertDialog.Trigger>
      </SettingRow>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="lm-dialog-overlay lm-settings-confirm-overlay" />
        <AlertDialog.Content
          className="lm-settings-confirm-dialog"
          data-lm-window-interactive=""
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            onEscape();
          }}
        >
          <AlertDialog.Title>
            {t('settings.clearRecentFiles')}
          </AlertDialog.Title>
          <AlertDialog.Description>
            {t('settings.clearRecentFilesConfirm')}
          </AlertDialog.Description>
          <div className="lm-setting-confirm-actions">
            <AlertDialog.Cancel asChild>
              <button className="lm-button" type="button">
                {t('dialog.cancel')}
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                className="lm-danger-button"
                onClick={onConfirm}
                type="button"
              >
                {t('settings.clearRecentFilesConfirmAction')}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
