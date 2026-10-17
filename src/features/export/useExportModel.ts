import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorState } from '@codemirror/state';
import type { FileMetadata } from '../../services/files/fileTypes';
import {
  exportPackage,
  getExportCapabilities,
  printExportPdf,
  showExportSaveDialog,
  writeExportHtml,
} from '../../services/export/exportCommands';
import type { CommandError } from '../../services/tauri/invokeCommand';
import type { PackageResourceWarning } from '../../services/packages/packageTypes';
import { useSettingsStore } from '../settings/settingsStore';
import {
  buildPackageExportPlan,
  packageEntryName,
} from '../packages/packageExportPlan';
import type {
  PackageExportPlanWarning,
} from '../packages/packageExportPlan';
import { mountExportPdfStage, printWithSystemDialog } from './exportPdfStage';
import type {
  ExportKind,
  ExportMathPreferences,
  ExportRenderResult,
  ExportWarning,
  PackageExportWarningCode,
} from './exportTypes';

export type ExportStatus =
  | 'idle'
  | 'preparing'
  | 'printing'
  | 'rendering'
  | 'writing'
  | 'done'
  | 'error';

export type ExportDialogState = {
  error: CommandError | null;
  kind: ExportKind;
  open: boolean;
  path: string | null;
  status: ExportStatus;
  summary?: {
    resourceCount: number;
    totalBytes: number;
  };
  warnings: ExportWarning[];
};

const INITIAL_STATE: ExportDialogState = {
  error: null,
  kind: 'html',
  open: false,
  path: null,
  status: 'idle',
  warnings: [],
};

type UseExportModelOptions = {
  currentFile: FileMetadata | null;
  focusEditor: () => void;
  getDocumentText: () => string;
  getEditorState: () => EditorState | null;
};

export function useExportModel({
  currentFile,
  focusEditor,
  getDocumentText,
  getEditorState,
}: UseExportModelOptions) {
  const { i18n, t } = useTranslation();
  const settings = useSettingsStore((state) => state.settings);
  const [state, setState] = useState<ExportDialogState>(INITIAL_STATE);
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const lastKindRef = useRef<ExportKind>('html');

  const cancel = useCallback(() => {
    if (state.status === 'printing' || state.status === 'writing') {
      return;
    }
    generationRef.current += 1;
    busyRef.current = false;
    setState(INITIAL_STATE);
    focusEditor();
  }, [focusEditor, state.status]);

  const close = useCallback(() => {
    if (state.status === 'printing' || state.status === 'writing') {
      return;
    }
    generationRef.current += 1;
    busyRef.current = false;
    setState(INITIAL_STATE);
    focusEditor();
  }, [focusEditor, state.status]);

  const run = useCallback(
    async (kind: ExportKind, generation: number) => {
      const math: ExportMathPreferences = {
        numbering: settings.markdown.math.equationNumbering,
        physics: settings.markdown.math.physicsEnabled,
        syntaxMode: settings.markdown.math.syntaxMode,
      };
      const language = i18n.language === 'zh-CN' ? 'zh-CN' : 'en';
      const baseName = exportBaseName(currentFile, t('app.emptyTitle'));
      const suggestedDirectory = documentDirectory(currentFile?.path ?? null);
      const suggestedName =
        kind === 'package' ? `${baseName}.zip` : `${baseName}.${kind}`;

      setState((current) => ({
        ...current,
        error: null,
        kind,
        open: true,
        path: null,
        status: 'preparing',
        warnings: [],
      }));

      try {
        const capabilities =
          kind === 'pdf'
            ? await getExportCapabilities().catch(() => null)
            : null;
        const directPdf =
          capabilities?.ok === true &&
          capabilities.data.pdfMode === 'direct';
        let outputPath: string | null = null;

        if (kind === 'html' || kind === 'package' || directPdf) {
          const selected = await showExportSaveDialog({
            documentPath: currentFile?.path ?? null,
            kind,
            suggestedDirectory,
            suggestedName,
          });
          if (!selected.ok) {
            throw selected.error;
          }
          if (selected.data === null) {
            if (generation === generationRef.current) {
              busyRef.current = false;
              setState(INITIAL_STATE);
              focusEditor();
            }
            return;
          }
          outputPath = selected.data;
        }

        if (generation !== generationRef.current) {
          return;
        }

        if (kind === 'package') {
          if (!outputPath) {
            throw new Error('Missing package output path.');
          }
          setState((current) => ({ ...current, status: 'writing' }));
          const editorState = getEditorState();
          if (!editorState) {
            throw packageFailure(
              'package.editor_unavailable',
              'The editor is not available.',
            );
          }
          const plan = buildPackageExportPlan({
            documentPath: currentFile?.path ?? null,
            downloadRemoteImages:
              settings.images.downloadRemoteImagesOnExport,
            entryName: packageEntryName(currentFile?.name),
            state: editorState,
          });
          if (plan.status === 'error') {
            throw packageFailure(
              `package.${plan.error}`,
              `The package image could not be planned: ${plan.source}`,
            );
          }
          const written = await exportPackage({
            documentPath: currentFile?.path ?? null,
            entryName: plan.entryName,
            entryText: plan.entryText,
            outputPath,
            resources: plan.resources,
          });
          if (!written.ok) {
            throw written.error;
          }
          if (generation !== generationRef.current) {
            return;
          }
          setState({
            error: null,
            kind,
            open: true,
            path: written.data.outputPath,
            status: 'done',
            summary: {
              resourceCount: written.data.resourceCount,
              totalBytes: written.data.totalBytes,
            },
            warnings: [
              ...planWarningsToExportWarnings(plan.warnings),
              ...rustWarningsToExportWarnings(written.data.warnings),
            ],
          });
          return;
        }

        setState((current) => ({ ...current, status: 'rendering' }));
        const { renderExportDocument } = await import('./renderExportDocument');
        const rendered: ExportRenderResult = await renderExportDocument({
          documentPath: currentFile?.path ?? null,
          language,
          markdown: getDocumentText(),
          math,
          messages: {
            diagramFailed: t('export.message.diagramFailed'),
            imageUnavailable: t('export.message.imageUnavailable'),
            mathFailed: t('export.message.mathFailed'),
          },
          plantumlEnabled: settings.markdown.plantuml.enabled,
          title: null,
        });

        if (generation !== generationRef.current) {
          return;
        }

        if (kind === 'html') {
          if (!outputPath) {
            throw new Error('Missing export output path.');
          }
          setState((current) => ({ ...current, status: 'writing' }));
          const written = await writeExportHtml({
            force: true,
            html: rendered.html,
            path: outputPath,
          });
          if (!written.ok) {
            throw written.error;
          }
          setState({
            error: null,
            kind,
            open: true,
            path: written.data.path,
            status: 'done',
            warnings: rendered.warnings,
          });
          return;
        }

        setState((current) => ({ ...current, status: 'printing' }));
        const cleanup = await mountExportPdfStage(rendered.html);
        let printedPath: string | null = outputPath;
        try {
          if (generation !== generationRef.current) {
            return;
          }
          if (directPdf) {
            if (!outputPath) {
              throw new Error('Missing PDF output path.');
            }
            const printed = await printExportPdf(outputPath);
            if (!printed.ok) {
              if (printed.error.code === 'export.pdf_unavailable') {
                await printWithSystemDialog();
                printedPath = null;
              } else {
                throw printed.error;
              }
            }
          } else {
            await printWithSystemDialog();
            printedPath = null;
          }
        } finally {
          cleanup();
        }

        setState({
          error: null,
          kind,
          open: true,
          path: printedPath,
          status: 'done',
          warnings: rendered.warnings,
        });
      } catch (error) {
        if (generation !== generationRef.current) {
          return;
        }
        setState((current) => ({
          ...current,
          error: toCommandError(error),
          status: 'error',
        }));
      } finally {
        if (generation === generationRef.current) {
          busyRef.current = false;
        }
      }
    },
    [
      currentFile,
      focusEditor,
      getDocumentText,
      getEditorState,
      i18n.language,
      settings.images.downloadRemoteImagesOnExport,
      settings.markdown.math.equationNumbering,
      settings.markdown.math.physicsEnabled,
      settings.markdown.math.syntaxMode,
      settings.markdown.plantuml.enabled,
      t,
    ],
  );

  const start = useCallback(
    (kind: ExportKind) => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      lastKindRef.current = kind;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      void run(kind, generation);
    },
    [run],
  );

  const retry = useCallback(() => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    void run(lastKindRef.current, generation);
  }, [run]);

  return {
    cancel,
    close,
    exportHtml: useCallback(() => start('html'), [start]),
    exportPackage: useCallback(() => start('package'), [start]),
    exportPdf: useCallback(() => start('pdf'), [start]),
    retry,
    state,
  };
}

export type ExportModel = ReturnType<typeof useExportModel>;

function exportBaseName(
  file: FileMetadata | null,
  untitled: string,
): string {
  if (!file) {
    return untitled;
  }
  return file.name.replace(/\.[^.]+$/u, '') || untitled;
}

function documentDirectory(path: string | null): string | null {
  if (!path) {
    return null;
  }
  const normalized = path.replace(/\\/gu, '/');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return null;
  }
  const directory = path.slice(0, index);
  return directory || null;
}

function toCommandError(error: unknown): CommandError {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return error as CommandError;
  }
  return {
    code: 'export.render_failed',
    message: error instanceof Error ? error.message : String(error),
    recoverable: true,
  };
}

const PACKAGE_WARNING_CODES: Record<
  PackageExportPlanWarning['code'],
  PackageExportWarningCode
> = {
  package_blob_unsupported: 'export.package_blob_unsupported',
  package_html_image_unsupported: 'export.package_html_image_unsupported',
  package_image_unsupported: 'export.package_image_unsupported',
  package_remote_skipped: 'export.package_remote_skipped',
  package_unsupported_source: 'export.package_unsupported_source',
};

function planWarningsToExportWarnings(
  warnings: readonly PackageExportPlanWarning[],
): ExportWarning[] {
  return warnings.map((warning) => ({
    code: PACKAGE_WARNING_CODES[warning.code],
    message: '',
    source: warning.source,
  }));
}

function rustWarningsToExportWarnings(
  warnings: readonly PackageResourceWarning[],
): ExportWarning[] {
  return warnings.map((warning) => ({
    code: 'export.package_image_unavailable',
    message: warning.reason,
    source: warning.source,
  }));
}

function packageFailure(
  code: string,
  message: string,
): CommandError {
  return { code, message, recoverable: true };
}
