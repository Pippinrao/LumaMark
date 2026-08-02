import * as Dialog from '@radix-ui/react-dialog';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

type DiscardChangesDialogProps = {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onReturnFocus: () => void;
  open: boolean;
};

export function DiscardChangesDialog({
  onConfirm,
  onOpenChange,
  onReturnFocus,
  open,
}: DiscardChangesDialogProps) {
  const { t } = useTranslation();
  const confirmedRef = useRef(false);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="lm-dialog-overlay" />
        <Dialog.Content
          className="lm-settings-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!confirmedRef.current) {
              onReturnFocus();
            }
            confirmedRef.current = false;
          }}
        >
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
              onClick={() => {
                confirmedRef.current = true;
                onConfirm();
              }}
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
