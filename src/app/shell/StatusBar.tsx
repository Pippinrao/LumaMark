import type { StatusBarLabels } from './shellTypes';

type StatusBarProps = {
  currentFileName?: string;
  dirty: boolean;
  labels: StatusBarLabels;
  workspaceName?: string;
};

export function StatusBar({
  currentFileName,
  dirty,
  labels,
  workspaceName,
}: StatusBarProps) {
  return (
    <footer className="lm-status-bar">
      <span role="status">{labels.status}</span>
      <span className="lm-status-spacer" />
      <span>{labels.statistics}</span>
      {workspaceName ? <span>{workspaceName}</span> : null}
      {currentFileName ? <span>{currentFileName}</span> : null}
      {dirty ? <span>{labels.dirtyIndicator}</span> : null}
    </footer>
  );
}
