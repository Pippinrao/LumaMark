import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';

type ExternalFileConflictDialogProps = {
  onKeepCurrentContent: () => void;
  onReloadFromDisk: () => void;
  open: boolean;
};

export function ExternalFileConflictDialog({
  onKeepCurrentContent,
  onReloadFromDisk,
  open,
}: ExternalFileConflictDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="lm-dialog-overlay" />
        <Dialog.Content className="lm-settings-dialog">
          <Dialog.Title>{t('externalChange.title')}</Dialog.Title>
          <Dialog.Description className="lm-dialog-description">
            {t('externalChange.description')}
          </Dialog.Description>
          <div className="lm-dialog-actions">
            <button
              className="lm-icon-button"
              onClick={onKeepCurrentContent}
              type="button"
            >
              {t('externalChange.keepCurrent')}
            </button>
            <button
              className="lm-danger-button"
              onClick={onReloadFromDisk}
              type="button"
            >
              {t('externalChange.reload')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
