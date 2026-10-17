import * as Dialog from '@radix-ui/react-dialog';
import {
  CheckCircle2,
  CircleAlert,
  FileDown,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CommandError } from '../../services/tauri/invokeCommand';
import type {
  ExportKind,
  ExportWarning,
} from './exportTypes';
import type { ExportDialogState, ExportStatus } from './useExportModel';

type ExportDialogProps = {
  onCancel: () => void;
  onClose: () => void;
  onRetry: () => void;
  state: ExportDialogState;
};

export function ExportDialog({
  onCancel,
  onClose,
  onRetry,
  state,
}: ExportDialogProps) {
  const { t } = useTranslation();
  const busy = isBusy(state.status);
  const printing = state.status === 'printing' || state.status === 'writing';

  return (
    <Dialog.Root
      open={state.open}
      onOpenChange={(open) => {
        if (!open && !printing) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="lm-dialog-overlay" />
        <Dialog.Content
          className="lm-settings-dialog lm-export-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) {
              event.preventDefault();
            }
          }}
          onPointerDownOutside={(event) => {
            if (busy) {
              event.preventDefault();
            }
          }}
        >
          <Dialog.Title className="lm-export-dialog-title">
            <FileDown aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{t(titleKey(state.kind))}</span>
          </Dialog.Title>
          <Dialog.Description className="lm-dialog-description">
            {t(
              state.kind === 'package'
                ? 'export.description.package'
                : 'export.description',
            )}
          </Dialog.Description>

          <div className="lm-export-dialog-body" aria-live="polite">
            {state.status === 'error' && state.error ? (
              <ErrorSummary error={state.error} />
            ) : state.status === 'done' ? (
              <SuccessSummary state={state} />
            ) : (
              <ProgressSummary status={state.status} />
            )}

            {state.warnings.length > 0 && state.status === 'done' ? (
              <WarningList warnings={state.warnings} />
            ) : null}
          </div>

          <div className="lm-dialog-actions">
            {state.status === 'error' ? (
              <button className="lm-icon-button" onClick={onClose} type="button">
                {t('export.close')}
              </button>
            ) : busy ? (
              <button
                className="lm-icon-button"
                disabled={printing}
                onClick={onCancel}
                type="button"
              >
                {t('export.cancel')}
              </button>
            ) : (
              <button className="lm-icon-button" onClick={onClose} type="button">
                {t('export.close')}
              </button>
            )}
            {state.status === 'error' ? (
              <button className="lm-button" onClick={onRetry} type="button">
                {t('export.retry')}
              </button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProgressSummary({ status }: { status: ExportStatus }) {
  const { t } = useTranslation();
  return (
    <div className="lm-export-progress">
      <Loader2
        aria-hidden="true"
        className="lm-export-spinner"
        size={18}
        strokeWidth={1.8}
      />
      <span>{t(progressKey(status))}</span>
    </div>
  );
}

function SuccessSummary({ state }: { state: ExportDialogState }) {
  const { t } = useTranslation();
  const message =
    state.kind === 'package'
      ? t('export.success.package', {
          count: state.summary?.resourceCount ?? 0,
          size: formatBytes(state.summary?.totalBytes ?? 0),
        })
      : t(
          state.kind === 'html'
            ? 'export.success.html'
            : 'export.success.pdf',
        );
  return (
    <div className="lm-export-success">
      <div className="lm-export-status-line">
        <CheckCircle2 aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>{message}</span>
      </div>
      {state.path ? (
        <code className="lm-export-output-path" title={state.path}>
          {state.path}
        </code>
      ) : state.kind === 'pdf' ? (
        <p className="lm-export-hint">{t('export.pdfDialogHint')}</p>
      ) : null}
    </div>
  );
}

function ErrorSummary({ error }: { error: CommandError }) {
  const { t } = useTranslation();
  return (
    <div className="lm-export-error" role="alert">
      <div className="lm-export-status-line">
        <CircleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>{t(errorKey(error.code))}</span>
      </div>
      {error.message ? (
        <p className="lm-export-hint" title={error.message}>
          {error.message}
        </p>
      ) : null}
    </div>
  );
}

function WarningList({ warnings }: { warnings: ExportWarning[] }) {
  const { t } = useTranslation();
  return (
    <div className="lm-export-warnings">
      <div className="lm-export-status-line">
        <TriangleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>{t('export.warnings')}</span>
      </div>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${index}`}>
            <span>{t(warningKey(warning))}</span>
            {'source' in warning && warning.source ? (
              <code title={warning.source}>{warning.source}</code>
            ) : null}
            {'line' in warning && warning.line ? (
              <span className="lm-export-warning-line">
                {t('export.line', { line: warning.line })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function titleKey(kind: ExportKind): string {
  switch (kind) {
    case 'html':
      return 'export.title.html';
    case 'pdf':
      return 'export.title.pdf';
    case 'package':
      return 'export.title.package';
  }
}

function progressKey(status: ExportStatus): string {
  switch (status) {
    case 'rendering':
      return 'export.progress.rendering';
    case 'writing':
      return 'export.progress.writing';
    case 'printing':
      return 'export.progress.printing';
    default:
      return 'export.progress.preparing';
  }
}

function warningKey(warning: ExportWarning): string {
  switch (warning.code) {
    case 'export.diagram_failed':
      return 'export.warning.diagramFailed';
    case 'export.diagram_timeout':
      return 'export.warning.diagramTimeout';
    case 'export.diagram_unavailable':
      return 'export.warning.diagramUnavailable';
    case 'export.image_relative_without_document':
      return 'export.warning.imageRelativeWithoutDocument';
    case 'export.image_read_failed':
      return 'export.warning.imageReadFailed';
    case 'export.image_too_large':
      return 'export.warning.imageTooLarge';
    case 'export.image_remote_failed':
      return 'export.warning.imageRemoteFailed';
    case 'export.image_unsupported':
      return 'export.warning.imageUnsupported';
    case 'export.package_blob_unsupported':
      return 'export.warning.packageBlobUnsupported';
    case 'export.package_html_image_unsupported':
      return 'export.warning.packageHtmlImageUnsupported';
    case 'export.package_image_too_large':
      return 'export.warning.imageTooLarge';
    case 'export.package_image_unavailable':
      return 'export.warning.packageImageUnavailable';
    case 'export.package_image_unsupported':
      return 'export.warning.imageUnsupported';
    case 'export.package_remote_skipped':
      return 'export.warning.packageRemoteSkipped';
    case 'export.package_unsupported_source':
      return 'export.warning.packageUnsupportedSource';
    case 'export.math_failed':
      return 'export.warning.mathFailed';
    default:
      return 'export.warning.generic';
  }
}

function errorKey(code: string): string {
  switch (code) {
    case 'export.output_exists':
      return 'exportError.outputExists';
    case 'export.html_too_large':
    case 'export.image_too_large':
      return 'exportError.tooLarge';
    case 'file.invalid_path':
    case 'file.path_required':
      return 'exportError.invalidPath';
    case 'export.pdf_timeout':
      return 'exportError.pdfTimeout';
    case 'export.pdf_unavailable':
      return 'exportError.pdfUnavailable';
    case 'export.pdf_failed':
      return 'exportError.pdfFailed';
    case 'export.render_failed':
      return 'exportError.renderFailed';
    case 'package.editor_unavailable':
      return 'exportError.packageEditorUnavailable';
    case 'package.relative_without_document':
      return 'exportError.packageRelativeWithoutDocument';
    case 'package.resource_unavailable':
      return 'exportError.packageResourceUnavailable';
    case 'package.resource_too_large':
    case 'package.too_large':
      return 'exportError.tooLarge';
    case 'package.unsupported_source':
      return 'exportError.packageUnsupportedSource';
    case 'package.export_failed':
      return 'exportError.packageWriteFailed';
    case 'package.invalid_path':
      return 'exportError.invalidPath';
    default:
      return 'exportError.generic';
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  if (unitIndex < 0) {
    return `${Math.round(value)} B`;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function isBusy(status: ExportStatus): boolean {
  return (
    status === 'preparing' ||
    status === 'rendering' ||
    status === 'writing' ||
    status === 'printing'
  );
}
