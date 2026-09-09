export type DiagramFormat = 'mermaid' | 'plantuml';
export type InputFormat = DiagramFormat | 'markdown';
export type Diagnostic = {
  code: string;
  message: string;
  format?: DiagramFormat;
  blockLine?: number;
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
export type DiagramInput = { source: string; format: DiagramFormat };
export type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; message: string; line?: number; code: string };

export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_DIAGRAMS = 100;

export class AutomationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function errorReport(error: unknown): Report {
  return {
    schemaVersion: 1, ok: false, checked: 0,
    diagnostics: [{
      code: error instanceof AutomationError ? error.code : 'automation.failed',
      message: error instanceof Error ? error.message : String(error),
    }],
  };
}
