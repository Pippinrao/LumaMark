import { invoke } from '@tauri-apps/api/core';
import { mountExportPdfStage } from '../../features/export/exportPdfStage';
import { renderExportDocument } from '../../features/export/renderExportDocument';
import type {
  ExportMathPreferences,
  ExportWarning,
} from '../../features/export/exportTypes';
import type { CommandError } from '../../services/tauri/invokeCommand';

type ExportJob = {
  documentPath: string | null;
  force: boolean;
  format: 'html' | 'pdf';
  jobId: number;
  language: 'en' | 'zh-CN';
  math: {
    numbering: 'all' | 'ams' | 'none';
    physics: boolean;
    syntaxMode: 'disabled' | 'legacy' | 'pandoc';
  };
  messages: {
    diagramFailed: string;
    imageUnavailable: string;
    mathFailed: string;
  };
  output: string;
  plantumlEnabled: boolean;
  source: string;
  title: string | null;
};

type ExportResult = {
  bytes?: number;
  diagnostics: CommandError[];
  ok: boolean;
  output?: string;
  ready?: boolean;
  warnings: ExportWarning[];
};

async function progress(): Promise<void> {
  try {
    await invoke('export_render_progress');
  } catch {
    // The host is gone; the next pull will stop the loop.
  }
}

async function run(job: ExportJob): Promise<ExportResult> {
  try {
    await progress();
    const math: ExportMathPreferences = {
      numbering: job.math.numbering,
      physics: job.math.physics,
      syntaxMode: job.math.syntaxMode,
    };
    const rendered = await renderExportDocument({
      documentPath: job.documentPath,
      language: job.language,
      markdown: job.source,
      math,
      messages: {
        diagramFailed: job.messages.diagramFailed,
        imageUnavailable: job.messages.imageUnavailable,
        mathFailed: job.messages.mathFailed,
      },
      plantumlEnabled: job.plantumlEnabled,
      title: job.title,
    });

    if (job.format === 'html') {
      await progress();
      const written = await invoke<{ byteLength: number; path: string }>(
        'export_write_html',
        {
          force: job.force,
          html: rendered.html,
          path: job.output,
        },
      );
      return {
        bytes: written.byteLength,
        diagnostics: [],
        ok: true,
        output: written.path,
        warnings: rendered.warnings,
      };
    }

    await progress();
    await mountExportPdfStage(rendered.html);
    return {
      diagnostics: [],
      ok: true,
      output: job.output,
      ready: true,
      warnings: rendered.warnings,
    };
  } catch (error) {
    return {
      diagnostics: [toCommandError(error)],
      ok: false,
      warnings: [],
    };
  }
}

async function main(): Promise<void> {
  await progress();
  await invoke('export_host_ready');

  for (;;) {
    let job: ExportJob | null;
    try {
      await progress();
      job = await invoke<ExportJob | null>('export_render_next');
    } catch {
      return;
    }
    if (!job) {
      return;
    }

    const result = await run(job);
    try {
      await invoke('export_render_result', {
        jobId: job.jobId,
        result,
      });
    } catch {
      return;
    }
  }
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
    code: 'export.failed',
    message: error instanceof Error ? error.message : String(error),
    recoverable: true,
  };
}

void main();
