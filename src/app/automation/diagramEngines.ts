import DOMPurify from 'dompurify';
import { renderWithMermaid } from '../../editor/capabilities/mermaid/mermaidRenderAdapter';
import {
  getPlantumlEngine,
  renderPlantumlOnThread,
} from '../../editor/capabilities/plantuml/plantumlEngine';
import { isPlantumlSyntaxErrorSvg } from '../../editor/capabilities/plantuml/plantumlErrorSvg';
import type { DiagramInput, RenderResult, RendererMessages } from './types';

/**
 * Exported SVG has to stay self-contained. With HTML labels enabled mermaid
 * emits `foreignObject` content that sanitization removes, so the export path
 * renders text labels while keeping the editor's engine and security level.
 */
export const MERMAID_EXPORT_CONFIG: Record<string, unknown> = {
  htmlLabels: false,
  flowchart: { htmlLabels: false },
};

/** The official PlantUML engine reports a syntax error through a rendered page. */
const PLANTUML_ERROR_LINE = /\[From (?:textarea|string) \(line (\d+)\)\]/;

class EngineFailure extends Error {
  readonly code: string;
  readonly line: number | undefined;

  constructor(code: string, message: string, line?: number) {
    super(message);
    this.name = 'EngineFailure';
    this.code = code;
    this.line = line;
  }
}

export async function renderDiagram(
  input: DiagramInput,
  messages: RendererMessages,
  timeoutMs: number,
): Promise<RenderResult> {
  if (!input.source.trim()) {
    return { ok: false, code: 'diagram.empty', message: messages.empty };
  }

  try {
    const svg = await withDeadline(
      renderEngine(input.source, input.format, messages),
      timeoutMs,
      messages,
    );
    return { ok: true, svg: sanitize(svg, messages) };
  } catch (error) {
    if (error instanceof EngineFailure) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
        line: error.line,
      };
    }
    return { ok: false, code: 'diagram.invalid', message: errorMessage(error) };
  }
}

async function renderEngine(
  source: string,
  format: DiagramInput['format'],
  messages: RendererMessages,
): Promise<string> {
  return format === 'mermaid'
    ? renderMermaid(source, messages)
    : renderPlantuml(source, messages);
}

async function renderMermaid(
  source: string,
  messages: RendererMessages,
): Promise<string> {
  const mermaid = await loadMermaid(messages);
  try {
    // Parsing first keeps precise engine line locations for diagnostics.
    await mermaid.parse(source);
  } catch (error) {
    throw new EngineFailure(
      'diagram.invalid',
      errorMessage(error),
      mermaidErrorLine(error),
    );
  }

  try {
    return await renderWithMermaid({
      config: MERMAID_EXPORT_CONFIG,
      source,
      theme: 'default',
    });
  } catch (error) {
    throw new EngineFailure(
      'diagram.invalid',
      errorMessage(error),
      mermaidErrorLine(error),
    );
  }
}

async function loadMermaid(
  messages: RendererMessages,
): Promise<{ parse: (source: string) => Promise<unknown> }> {
  try {
    const module = (await import('mermaid')) as unknown as {
      default: { parse: (source: string) => Promise<unknown> };
    };
    return module.default;
  } catch (error) {
    throw new EngineFailure(
      'renderer.unavailable',
      `${messages.loadFailed} ${errorMessage(error)}`,
    );
  }
}

async function renderPlantuml(
  source: string,
  messages: RendererMessages,
): Promise<string> {
  try {
    await getPlantumlEngine();
  } catch (error) {
    throw new EngineFailure(
      'renderer.unavailable',
      `${messages.loadFailed} ${errorMessage(error)}`,
    );
  }

  let svg: string;
  try {
    svg = await renderPlantumlOnThread(source);
  } catch (error) {
    throw new EngineFailure('diagram.invalid', errorMessage(error));
  }

  // The engine can answer through its success callback with an error page.
  const syntaxErrorLine = isPlantumlSyntaxErrorSvg(svg)
    ? PLANTUML_ERROR_LINE.exec(svg)
    : null;
  if (syntaxErrorLine) {
    const line = Number(syntaxErrorLine[1]);
    throw new EngineFailure(
      'diagram.invalid',
      plantumlErrorText(svg),
      Number.isFinite(line) && line > 0 ? line : undefined,
    );
  }

  return svg;
}

function sanitize(svg: string, messages: RendererMessages): string {
  const safe = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
  if (!safe.includes('<svg')) {
    throw new EngineFailure('renderer.unavailable', messages.noSvg);
  }
  return safe;
}

function plantumlErrorText(svg: string): string {
  const document_ = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return Array.from(document_.querySelectorAll('text'))
    .map((node) => node.textContent ?? '')
    .join('\n');
}

function withDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
  messages: RendererMessages,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new EngineFailure('renderer.timeout', messages.timeout)),
      timeoutMs,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mermaidErrorLine(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const hash = (error as { hash?: { loc?: { first_line?: unknown } } }).hash;
  const line = hash?.loc?.first_line;
  return typeof line === 'number' && Number.isFinite(line) ? line : undefined;
}
