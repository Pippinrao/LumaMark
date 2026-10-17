export type ExportKind = 'html' | 'package' | 'pdf';

export type ExportMathPreferences = {
  numbering: 'none' | 'ams' | 'all';
  physics: boolean;
  syntaxMode: 'disabled' | 'legacy' | 'pandoc';
};

export type ExportDiagramFormat = 'mermaid' | 'plantuml';

export type ExportImageWarningCode =
  | 'export.image_relative_without_document'
  | 'export.image_read_failed'
  | 'export.image_too_large'
  | 'export.image_remote_failed'
  | 'export.image_unsupported';

export type PackageExportWarningCode =
  | 'export.package_blob_unsupported'
  | 'export.package_html_image_unsupported'
  | 'export.package_image_too_large'
  | 'export.package_image_unavailable'
  | 'export.package_image_unsupported'
  | 'export.package_remote_skipped'
  | 'export.package_unsupported_source';

export type ExportWarning =
  | {
      code:
        | 'export.diagram_failed'
        | 'export.diagram_timeout'
        | 'export.diagram_unavailable';
      format: ExportDiagramFormat;
      line?: number;
      message: string;
    }
  | {
      code: ExportImageWarningCode;
      message: string;
      source: string;
    }
  | {
      code: PackageExportWarningCode;
      message: string;
      source: string;
    }
  | {
      code: 'export.math_failed';
      message: string;
      source: string;
    };

export type ExportMessages = {
  diagramFailed: string;
  imageUnavailable: string;
  mathFailed: string;
};

export type ExportRenderInput = {
  documentPath: string | null;
  language: 'en' | 'zh-CN';
  markdown: string;
  math: ExportMathPreferences;
  messages: ExportMessages;
  plantumlEnabled: boolean;
  title?: string | null;
};

export type ExportRenderDeps = {
  embedImage: (
    source: string,
    documentPath: string | null,
  ) => Promise<
    | { dataUri: string; kind: 'dataUri'; mimeType: string }
    | { kind: 'error'; message: string; reason: ExportImageWarningCode }
  >;
  renderDiagram: (
    source: string,
    format: ExportDiagramFormat,
  ) => Promise<
    | { kind: 'error'; code: string; line?: number; message: string }
    | { kind: 'svg'; svg: string }
  >;
  renderMath: (
    formulas: readonly ExportMathFormula[],
    preferences: ExportMathPreferences,
  ) => Promise<
    | {
        formulas: ReadonlyMap<string, string>;
        kind: 'rendered';
        stylesheet: string;
      }
    | { kind: 'failed'; message: string }
  >;
};

export type ExportMathFormula = {
  display: boolean;
  id: string;
  source: string;
};

export type ExportRenderResult = {
  bytes: number;
  html: string;
  title: string;
  warnings: ExportWarning[];
};
