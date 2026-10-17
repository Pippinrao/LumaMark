import {
  renderDiagram,
  type DiagramRendererMessages,
} from '../../services/diagrams/diagramRenderer';
import type { ExportDiagramFormat } from './exportTypes';

const DIAGRAM_TIMEOUT_MS = 15_000;

const MESSAGES: DiagramRendererMessages = {
  empty: 'Diagram source is empty.',
  loadFailed: 'Diagram renderer is unavailable.',
  noSvg: 'Diagram renderer did not return SVG.',
  timeout: 'Diagram rendering timed out.',
};

export async function renderExportDiagram(
  source: string,
  format: ExportDiagramFormat,
): Promise<
  | { kind: 'error'; code: string; line?: number; message: string }
  | { kind: 'svg'; svg: string }
> {
  const result = await renderDiagram(
    { format, source },
    MESSAGES,
    DIAGRAM_TIMEOUT_MS,
  );

  return result.ok
    ? { kind: 'svg', svg: result.svg }
    : {
        code: result.code,
        kind: 'error',
        line: result.line,
        message: result.message,
      };
}
