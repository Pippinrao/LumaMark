import type { StatusBarLabels } from './shellTypes';

type StatusBarProps = {
  currentFileName?: string;
  dirty: boolean;
  labels: StatusBarLabels;
  readingMode: boolean;
  readOnlyFlashing: boolean;
  workspaceName?: string;
};

export function StatusBar({
  currentFileName,
  dirty,
  labels,
  readingMode,
  readOnlyFlashing,
  workspaceName,
}: StatusBarProps) {
  return (
    <footer className="lm-status-bar">
      <span role="status">{labels.status}</span>
      {readingMode ? (
        <span
          aria-live="polite"
          className={
            readOnlyFlashing
              ? 'lm-status-readonly lm-status-readonly-flash'
              : 'lm-status-readonly'
          }
          data-testid="status-readonly"
        >
          {readOnlyFlashing ? labels.readOnlyFlash : labels.readOnly}
        </span>
      ) : null}
      <span className="lm-status-spacer" />
      <span>{labels.statistics}</span>
      {workspaceName ? <span>{workspaceName}</span> : null}
      {currentFileName ? <span>{currentFileName}</span> : null}
      {dirty ? <span>{labels.dirtyIndicator}</span> : null}
    </footer>
  );
}
