import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import type { RecoveryDraft } from '../../services/drafts/draftStore';

type RecoveryDraftDialogProps = {
  draft: RecoveryDraft;
  onDiscard: () => void;
  onRestore: () => void;
};

function fileNameFromPath(path: string | null): string | null {
  return path?.split(/[\\/]/).at(-1)?.trim() || null;
}

export function RecoveryDraftDialog({
  draft,
  onDiscard,
  onRestore,
}: RecoveryDraftDialogProps) {
  const { t } = useTranslation();
  const sourceName = fileNameFromPath(draft.filePath);

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="lm-dialog-overlay" />
        <Dialog.Content
          className="lm-settings-dialog"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title>{t('recoveryDraft.title')}</Dialog.Title>
          <Dialog.Description className="lm-dialog-description">
            {sourceName
              ? t('recoveryDraft.fileDescription', { name: sourceName })
              : t('recoveryDraft.untitledDescription')}
          </Dialog.Description>
          <div className="lm-dialog-actions">
            <button className="lm-danger-button" onClick={onDiscard} type="button">
              {t('recoveryDraft.discard')}
            </button>
            <button className="lm-primary-button" onClick={onRestore} type="button">
              {t('recoveryDraft.restore')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
