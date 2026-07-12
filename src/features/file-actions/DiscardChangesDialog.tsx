import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';

type DiscardChangesDialogProps = {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function DiscardChangesDialog({
  onConfirm,
  onOpenChange,
  open,
}: DiscardChangesDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="lm-dialog-overlay" />
        <Dialog.Content className="lm-settings-dialog">
          <Dialog.Title>{t('newDocument.discardTitle')}</Dialog.Title>
          <Dialog.Description className="lm-dialog-description">
            {t('newDocument.discardDescription')}
          </Dialog.Description>
          <div className="lm-dialog-actions">
            <Dialog.Close className="lm-icon-button">
              {t('newDocument.cancel')}
            </Dialog.Close>
            <button
              className="lm-danger-button"
              onClick={onConfirm}
              type="button"
            >
              {t('newDocument.discard')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
