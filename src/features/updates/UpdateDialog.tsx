import * as Dialog from '@radix-ui/react-dialog';
import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UpdateDownloadProgress } from '../../services/updater/updaterService';
import type { UpdateUiStatus } from './updateStore';

type UpdateDialogProps = {
  currentVersion: string;
  errorCode: string | null;
  errorMessage: string | null;
  notes: string | null;
  onInstall: () => void;
  onOpenChange: (open: boolean) => void;
  onReturnFocus: () => void;
  open: boolean;
  progress: UpdateDownloadProgress | null;
  status: UpdateUiStatus;
  version: string | null;
};

export function UpdateDialog({
  currentVersion,
  errorCode,
  errorMessage,
  notes,
  onInstall,
  onOpenChange,
  onReturnFocus,
  open,
  progress,
  status,
  version,
}: UpdateDialogProps) {
  const { t } = useTranslation();
  const busy = status === 'checking' || status === 'downloading' || status === 'installing';
  const progressPercent = resolveProgressPercent(progress);

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="lm-dialog-overlay" />
        <Dialog.Content
          className="lm-update-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
        >
          <div className="lm-dialog-title-row">
            <Dialog.Title>{t('update.title')}</Dialog.Title>
            <Dialog.Close
              aria-label={t('dialog.close')}
              className="lm-icon-button"
              disabled={busy}
            >
              <X aria-hidden="true" size={16} />
            </Dialog.Close>
          </div>

          <div className="lm-update-identity" aria-hidden="true">
            <RefreshCw size={24} strokeWidth={1.8} />
          </div>

          <Dialog.Description className="lm-dialog-description lm-update-description">
            {resolveDescription({
              errorCode,
              errorMessage,
              status,
              t,
              version,
            })}
          </Dialog.Description>

          <dl className="lm-update-versions">
            <div>
              <dt>{t('update.currentVersion')}</dt>
              <dd>
                <strong>{currentVersion}</strong>
              </dd>
            </div>
            {version ? (
              <div>
                <dt>{t('update.newVersion')}</dt>
                <dd>
                  <strong>{version}</strong>
                </dd>
              </div>
            ) : null}
          </dl>

          {notes && status === 'available' ? (
            <section className="lm-update-notes" aria-label={t('update.releaseNotes')}>
              <h3>{t('update.releaseNotes')}</h3>
              <pre>{notes}</pre>
            </section>
          ) : null}

          {status === 'downloading' || status === 'installing' ? (
            <div
              aria-label={t('update.downloading')}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progressPercent ?? undefined}
              className="lm-update-progress"
              role="progressbar"
            >
              <div
                className="lm-update-progress-bar"
                style={{ width: `${progressPercent ?? 10}%` }}
              />
              <p>{t('update.downloading')}</p>
            </div>
          ) : null}

          <div className="lm-dialog-actions">
            {status === 'available' ? (
              <>
                <button
                  className="lm-icon-button"
                  onClick={() => {
                    onOpenChange(false);
                  }}
                  type="button"
                >
                  {t('update.later')}
                </button>
                <button
                  className="lm-update-install-button"
                  onClick={onInstall}
                  type="button"
                >
                  {t('update.installNow')}
                </button>
              </>
            ) : (
              <button
                className="lm-icon-button"
                disabled={busy}
                onClick={() => {
                  onOpenChange(false);
                }}
                type="button"
              >
                {t('dialog.close')}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function resolveDescription({
  errorCode,
  errorMessage,
  status,
  t,
  version,
}: {
  errorCode: string | null;
  errorMessage: string | null;
  status: UpdateUiStatus;
  t: (key: string, options?: Record<string, string>) => string;
  version: string | null;
}): string {
  switch (status) {
    case 'checking':
      return t('update.checking');
    case 'available':
      return t('update.available', { version: version ?? '' });
    case 'downloading':
    case 'installing':
      return t('update.downloading');
    case 'upToDate':
      return t('update.upToDate');
    case 'error':
      if (errorCode === 'update.unsupported') {
        return t('update.unsupported');
      }
      if (errorCode === 'update.downloadFailed') {
        return errorMessage?.trim()
          ? errorMessage
          : t('update.downloadFailed');
      }
      return errorMessage?.trim() ? errorMessage : t('update.checkFailed');
    default:
      return t('update.title');
  }
}

function resolveProgressPercent(
  progress: UpdateDownloadProgress | null,
): number | null {
  if (!progress || progress.contentLength === null || progress.contentLength <= 0) {
    return null;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((progress.downloaded / progress.contentLength) * 100)),
  );
}
