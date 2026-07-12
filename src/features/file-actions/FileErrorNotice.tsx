import { CircleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CommandError } from '../../services/tauri/invokeCommand';

type FileErrorNoticeProps = {
  error: CommandError;
  onDismiss: () => void;
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
    default:
      return 'fileError.operationFailed';
  }
}

export function FileErrorNotice({
  error,
  onDismiss,
}: FileErrorNoticeProps) {
  const { t } = useTranslation();

  return (
    <div className="lm-file-error-notice" role="alert">
      <CircleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
      <div className="lm-file-error-copy">
        <strong>{t(messageKeyForError(error.code))}</strong>
        <span>{t('fileError.documentSafe')}</span>
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
