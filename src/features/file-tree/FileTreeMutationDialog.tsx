import * as Dialog from '@radix-ui/react-dialog';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type FileTreeMutationRequest =
  | {
      defaultValue: string;
      mode: 'createDirectory' | 'createFile';
      parentPath: string;
    }
  | {
      defaultValue: string;
      entryKind: 'directory' | 'file';
      mode: 'rename';
      path: string;
    }
  | {
      entryKind: 'directory' | 'file';
      mode: 'delete';
      name: string;
      path: string;
    };

type FileTreeMutationDialogProps = {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (name: string | undefined) => void;
  onReturnFocus: () => void;
  request: FileTreeMutationRequest;
};

export function FileTreeMutationDialog({
  request,
  ...props
}: FileTreeMutationDialogProps) {
  return (
    <FileTreeMutationDialogContent
      {...props}
      key={requestIdentity(request)}
      request={request}
    />
  );
}

function FileTreeMutationDialogContent({
  busy,
  onCancel,
  onConfirm,
  onReturnFocus,
  request,
}: FileTreeMutationDialogProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(
    request.mode === 'delete' ? '' : request.defaultValue,
  );

  const trimmedName = name.trim();
  const title = titleForRequest(request, t);
  const confirmLabel = busy
    ? t('fileTreeDialog.processing')
    : request.mode === 'delete'
      ? t('fileTreeDialog.moveToTrash')
      : request.mode === 'rename'
        ? t('fileTreeDialog.renameAction')
        : t('fileTreeDialog.createAction');

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open && !busy) {
          onCancel();
        }
      }}
      open
    >
      <Dialog.Portal>
        <Dialog.Overlay className="lm-dialog-overlay" />
        <Dialog.Content
          aria-busy={busy}
          className="lm-file-tree-mutation-dialog"
          data-lm-window-interactive="true"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) {
              event.preventDefault();
            }
          }}
          onOpenAutoFocus={(event) => {
            if (request.mode === 'delete') {
              return;
            }

            event.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="lm-dialog-description">
            {descriptionForRequest(request, t)}
          </Dialog.Description>

          {request.mode === 'delete' ? (
            <div className="lm-dialog-actions">
              <button
                className="lm-button"
                disabled={busy}
                onClick={onCancel}
                type="button"
              >
                {t('dialog.cancel')}
              </button>
              <button
                className="lm-danger-button"
                disabled={busy}
                onClick={() => onConfirm(undefined)}
                type="button"
              >
                {confirmLabel}
              </button>
            </div>
          ) : (
            <form
              className="lm-file-tree-mutation-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy && trimmedName.length > 0) {
                  onConfirm(trimmedName);
                }
              }}
            >
              <label htmlFor={inputId}>
                {request.mode === 'createDirectory' ||
                (request.mode === 'rename' && request.entryKind === 'directory')
                  ? t('fileTreeDialog.folderName')
                  : t('fileTreeDialog.fileName')}
              </label>
              <input
                autoComplete="off"
                disabled={busy}
                id={inputId}
                onChange={(event) => setName(event.target.value)}
                ref={inputRef}
                value={name}
              />
              <div className="lm-dialog-actions">
                <button
                  className="lm-button"
                  disabled={busy}
                  onClick={onCancel}
                  type="button"
                >
                  {t('dialog.cancel')}
                </button>
                <button
                  className="lm-button"
                  disabled={busy || trimmedName.length === 0}
                  type="submit"
                >
                  {confirmLabel}
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function requestIdentity(request: FileTreeMutationRequest): string {
  return JSON.stringify(request);
}

type Translate = ReturnType<typeof useTranslation>['t'];

function titleForRequest(
  request: FileTreeMutationRequest,
  t: Translate,
): string {
  switch (request.mode) {
    case 'createDirectory':
      return t('fileTreeDialog.createFolderTitle');
    case 'createFile':
      return t('fileTreeDialog.createFileTitle');
    case 'delete':
      return t('fileTreeDialog.deleteTitle');
    case 'rename':
      return t('fileTreeDialog.renameTitle');
  }
}

function descriptionForRequest(
  request: FileTreeMutationRequest,
  t: Translate,
): string {
  switch (request.mode) {
    case 'createDirectory':
      return t('fileTreeDialog.createFolderDescription');
    case 'createFile':
      return t('fileTreeDialog.createFileDescription');
    case 'delete':
      return t('fileTreeDialog.deleteDescription', { name: request.name });
    case 'rename':
      return t('fileTreeDialog.renameDescription');
  }
}
