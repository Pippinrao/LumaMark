import { CircleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CommandError } from '../../services/tauri/invokeCommand';

type FileErrorNoticeProps = {
  error: CommandError;
  onDismiss: () => void;
  onRetry?: () => void;
};

function messageKeyForError(code: string): string {
  switch (code) {
    case 'file.not_found':
      return 'fileError.notFound';
    case 'file.permission_denied':
      return 'fileError.accessDenied';
    case 'file.invalid_encoding':
      return 'fileError.invalidEncoding';
    case 'file.invalid_path':
    case 'file.path_required':
      return 'fileError.invalidPath';
    case 'file.watch_error':
      return 'fileError.watchFailed';
    case 'workspace.not_directory':
      return 'fileError.workspaceNotDirectory';
    case 'desktop.open_request_queue_unavailable':
    case 'desktop.open_request_listener_unavailable':
    case 'desktop.open_request_drain_failed':
      return 'fileError.desktopOpenUnavailable';
    case 'desktop.open_request_path_not_utf8':
      return 'fileError.desktopPathUnsupported';
    case 'link.empty':
      return 'linkError.empty';
    case 'link.protocol_javascript':
      return 'linkError.protocolJavascript';
    case 'link.protocol_data':
      return 'linkError.protocolData';
    case 'link.protocol_file':
      return 'linkError.protocolFile';
    case 'link.protocol_rejected':
      return 'linkError.protocolRejected';
    case 'link.open_failed':
      return 'linkError.openFailed';
    case 'link.unsavedChanges':
      return 'linkError.unsavedChanges';
    case 'link.relativeUnavailable':
      return 'linkError.relativeUnavailable';
    case 'link.fragmentUnavailable':
      return 'linkError.fragmentUnavailable';
    case 'link.copy_failed':
      return 'linkError.copyFailed';
    default:
      if (code.startsWith('desktop.open_request_')) {
        return 'fileError.desktopOpenUnavailable';
      }
      return 'fileError.operationFailed';
  }
}

export function FileErrorNotice({
  error,
  onDismiss,
  onRetry,
}: FileErrorNoticeProps) {
  const { t } = useTranslation();

  return (
    <div className="lm-file-error-notice" role="alert">
      <CircleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
      <div className="lm-file-error-copy">
        <strong>{t(messageKeyForError(error.code))}</strong>
        <span>{t('fileError.documentSafe')}</span>
        {onRetry && error.recoverable ? (
          <button
            className="lm-file-error-retry"
            onClick={onRetry}
            type="button"
          >
            {t('fileError.retry')}
          </button>
        ) : null}
      </div>
      <button
        aria-label={t('dialog.close')}
        className="lm-file-error-dismiss"
        onClick={onDismiss}
        type="button"
      >
        <X aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>
    </div>
  );
}
