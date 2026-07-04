import { useTranslation } from 'react-i18next';
import type { StatusKey } from '../stores/appStore';

type StatusBarProps = {
  currentFileName?: string;
  dirty: boolean;
  statusKey: StatusKey;
  workspaceName?: string;
};

export function StatusBar({
  currentFileName,
  dirty,
  statusKey,
  workspaceName,
}: StatusBarProps) {
  const { t } = useTranslation();

  return (
    <footer className="lm-status-bar">
      <span role="status">{t(statusKey)}</span>
      <span className="lm-status-spacer" />
      {workspaceName ? <span>{workspaceName}</span> : null}
      {currentFileName ? <span>{currentFileName}</span> : null}
      {dirty ? <span>{t('status.dirtyIndicator')}</span> : null}
    </footer>
  );
}
