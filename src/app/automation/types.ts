/**
 * Wire types shared by the automation host page and the Rust side.
 *
 * Limits, localized text and the job identifier all arrive from Rust, so the
 * page owns no copy of the contract and cannot drift from `--help`.
 */

export type DiagramFormat = 'mermaid' | 'plantuml';
export type InputFormat = DiagramFormat | 'markdown';

/**
 * `check` only proves a diagram renders; `render` also returns the SVG.
 * Keeping the mode in the job keeps the CLI and the MCP tools identical.
 */
export type JobMode = 'check' | 'render';

export type RendererMessages = {
  tooLarge: string;
  tooMany: string;
  empty: string;
  timeout: string;
  noSvg: string;
  loadFailed: string;
};

export type RendererLimits = {
  sourceBytes: number;
  diagrams: number;
  timeoutMs: number;
};

export type RenderJob = {
  jobId: number;
  mode: JobMode;
  source: string;
  format: InputFormat;
  limits: RendererLimits;
  messages: RendererMessages;
};

export type Diagnostic = {
  code: string;
  message: string;
  format?: DiagramFormat;
  /** One-based line of the opening fence. */
  blockLine?: number;
  /** One-based error line mapped back to the document. */
  line?: number;
};

export type Report = {
  schemaVersion: 1;
  ok: boolean;
  checked: number;
  diagnostics: Diagnostic[];
  svg?: string;
  output?: string;
};

export type DiagramInput = {
  source: string;
  format: DiagramFormat;
};

export type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; code: string; message: string; line?: number };

export type DiagramBlock = {
  source: string;
  format: DiagramFormat;
  /** One-based line of the opening fence. */
  blockLine: number;
  /** Document line for each line of `source`. */
  sourceLines: number[];
};
