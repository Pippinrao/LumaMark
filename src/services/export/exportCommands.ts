import {
  invokeCommand,
  type CommandResult,
  type InvokeCommandFunction,
} from '../tauri/invokeCommand';
import type { ExportKind } from '../../features/export/exportTypes';

export type ExportPdfMode = 'direct' | 'print-dialog';

export type ExportCapabilities = {
  maxAssetBytes: number;
  maxHtmlBytes: number;
  pdfMode: ExportPdfMode;
};

export type EmbeddedExportImage = {
  byteLength: number;
  dataUri: string;
  mimeType: string;
};

export type WrittenExportHtml = {
  byteLength: number;
  path: string;
};

export type PrintedExportPdf = {
  byteLength: number;
  path: string;
};

type ExportCommandOptions = {
  invokeFn?: InvokeCommandFunction;
};

export type E2EExportCommandClient = {
  capabilities?: () => Promise<CommandResult<ExportCapabilities>>;
  embedImage?: (
    input: { documentPath: string | null; source: string },
  ) => Promise<CommandResult<EmbeddedExportImage>>;
  printPdf?: (path: string) => Promise<CommandResult<PrintedExportPdf>>;
  showSaveDialog?: (
    input: {
      documentPath: string | null;
      kind: ExportKind;
      suggestedDirectory: string | null;
      suggestedName: string;
    },
  ) => Promise<CommandResult<string | null>>;
  writeHtml?: (
    input: { force: boolean; html: string; path: string },
  ) => Promise<CommandResult<WrittenExportHtml>>;
};

declare global {
  interface Window {
    __LUMAMARK_E2E_EXPORT__?: E2EExportCommandClient;
  }
}

function e2eClient(): E2EExportCommandClient | undefined {
  if (
    !(import.meta.env.DEV || import.meta.env.MODE === 'test') ||
    typeof window === 'undefined'
  ) {
    return undefined;
  }
  return window.__LUMAMARK_E2E_EXPORT__;
}

export async function getExportCapabilities(
  options: ExportCommandOptions = {},
): Promise<CommandResult<ExportCapabilities>> {
  const client = options.invokeFn ? undefined : e2eClient();
  if (client?.capabilities) {
    return client.capabilities();
  }

  return invokeCommand<ExportCapabilities>(
    'export_capabilities',
    undefined,
    options.invokeFn,
  );
}

export async function showExportSaveDialog(
  input: {
    documentPath: string | null;
    kind: ExportKind;
    suggestedDirectory: string | null;
    suggestedName: string;
  },
  options: ExportCommandOptions = {},
): Promise<CommandResult<string | null>> {
  const client = options.invokeFn ? undefined : e2eClient();
  if (client?.showSaveDialog) {
    return client.showSaveDialog(input);
  }

  return invokeCommand<string | null>(
    'export_show_save_dialog',
    input,
    options.invokeFn,
  );
}

export async function writeExportHtml(
  input: { force?: boolean; html: string; path: string },
  options: ExportCommandOptions = {},
): Promise<CommandResult<WrittenExportHtml>> {
  const client = options.invokeFn ? undefined : e2eClient();
  if (client?.writeHtml) {
    return client.writeHtml({
      force: input.force ?? false,
      html: input.html,
      path: input.path,
    });
  }

  return invokeCommand<WrittenExportHtml>(
    'export_write_html',
    { force: input.force ?? false, html: input.html, path: input.path },
    options.invokeFn,
  );
}

export async function embedExportImage(
  input: { documentPath: string | null; source: string },
  options: ExportCommandOptions = {},
): Promise<CommandResult<EmbeddedExportImage>> {
  const client = options.invokeFn ? undefined : e2eClient();
  if (client?.embedImage) {
    return client.embedImage(input);
  }

  return invokeCommand<EmbeddedExportImage>(
    'export_embed_image',
    input,
    options.invokeFn,
  );
}

export async function printExportPdf(
  path: string,
  options: ExportCommandOptions = {},
): Promise<CommandResult<PrintedExportPdf>> {
  const client = options.invokeFn ? undefined : e2eClient();
  if (client?.printPdf) {
    return client.printPdf(path);
  }

  return invokeCommand<PrintedExportPdf>(
    'export_print_pdf',
    { path },
    options.invokeFn,
  );
}
