import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileMetadata } from '../../services/files/fileTypes';
import {
  getExportCapabilities,
  printExportPdf,
  showExportSaveDialog,
  writeExportHtml,
} from '../../services/export/exportCommands';
import type { CommandError } from '../../services/tauri/invokeCommand';
import { useSettingsStore } from '../settings/settingsStore';
import { mountExportPdfStage, printWithSystemDialog } from './exportPdfStage';
import type {
  ExportKind,
  ExportMathPreferences,
  ExportRenderResult,
  ExportWarning,
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
};

export function useExportModel({
  currentFile,
  focusEditor,
  getDocumentText,
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

        if (kind === 'html' || directPdf) {
          const selected = await showExportSaveDialog({
            documentPath: currentFile?.path ?? null,
            kind,
            suggestedDirectory,
            suggestedName: `${baseName}.${kind}`,
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
      i18n.language,
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
