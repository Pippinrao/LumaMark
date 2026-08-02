import * as Dialog from '@radix-ui/react-dialog';
import { FileText, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type AboutDialogProps = {
  onReturnFocus: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  version: string;
};

export function AboutDialog({ onOpenChange, onReturnFocus, open, version }: AboutDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="lm-dialog-overlay" />
        <Dialog.Content
          className="lm-about-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
        >
          <div className="lm-dialog-title-row">
            <Dialog.Title>{t('menu.about')}</Dialog.Title>
            <Dialog.Close className="lm-icon-button" aria-label={t('dialog.close')}>
              <X aria-hidden="true" size={16} />
            </Dialog.Close>
          </div>
          <div className="lm-about-identity" aria-hidden="true">
            <FileText size={24} strokeWidth={1.8} />
          </div>
          <Dialog.Description className="lm-dialog-description lm-about-description">
            {t('about.description')}
          </Dialog.Description>
          <p className="lm-about-version">
            <span>{t('about.version')}</span>
            <strong>{version}</strong>
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
