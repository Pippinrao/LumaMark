import { parser } from '@lezer/markdown';
import type {
  DiagramBlock,
  DiagramFormat,
  DiagramInput,
  RenderJob,
  RendererMessages,
  Report,
  RenderResult,
} from './types';

/**
 * Fence extraction lives in the page, next to the engines, so Markdown line
 * mapping keeps using the same Lezer parser as the editor.
 */
export function extractDiagrams(
  markdown: string,
  maxDiagrams: number,
  messages: RendererMessages,
): DiagramBlock[] {
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks: DiagramBlock[] = [];
  const lineStarts = [0];
  for (let index = 0; index < normalized.length; index++) {
    if (normalized[index] === '\n') lineStarts.push(index + 1);
  }

  const lineAt = (position: number): number => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (lineStarts[middle] <= position) low = middle;
      else high = middle;
    }
    return low + 1;
  };

  parser.parse(normalized).iterate({
    enter(reference) {
      if (reference.name !== 'FencedCode') return;
      const node = reference.node;
      const info = node.getChild('CodeInfo');
      const language = info
        ? normalized.slice(info.from, info.to).trim().split(/\s/)[0].toLowerCase()
        : '';
      if (language !== 'mermaid' && language !== 'plantuml') return false;

      const contentByLine = new Map<number, string>();
      for (const fragment of node.getChildren('CodeText')) {
        const text = normalized.slice(fragment.from, fragment.to).split('\n');
        text.forEach((content, offset) => {
          const line = lineAt(fragment.from) + offset;
          contentByLine.set(line, (contentByLine.get(line) ?? '') + content);
        });
      }

      // Lezer splits CodeText around blockquote marks; fragments that share a
      // source line must be joined, not turned into extra diagram lines.
      blocks.push({
        source: [...contentByLine.values()].join('\n'),
        format: language as DiagramFormat,
        blockLine: lineAt(node.from),
        sourceLines: [...contentByLine.keys()],
      });
      if (blocks.length > maxDiagrams) {
        throw new AutomationFailure(
          'input.too_many_diagrams',
          messages.tooMany,
        );
      }
      return false;
    },
  });

  return blocks;
}

/** Tool-owned failure that carries a stable diagnostic code. */
export class AutomationFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type DiagramRenderer = (input: DiagramInput) => Promise<RenderResult>;

/**
 * Runs one job and always answers with a report: a runtime failure can never
 * read as a successful syntax check.
 */
export async function runJob(
  job: RenderJob,
  render: DiagramRenderer,
  onProgress?: (completed: number) => void,
): Promise<Report> {
  try {
    validateSource(job.source, job.limits.sourceBytes, job.messages);
    if (job.format === 'markdown') {
      return await checkMarkdown(job, render, onProgress);
    }
    return await checkOne(job, job.format, render);
  } catch (error) {
    return errorReport(error);
  }
}

async function checkMarkdown(
  job: RenderJob,
  render: DiagramRenderer,
  onProgress?: (completed: number) => void,
): Promise<Report> {
  const blocks = extractDiagrams(job.source, job.limits.diagrams, job.messages);
  const report: Report = {
    schemaVersion: 1,
    ok: true,
    checked: 0,
    diagnostics: [],
  };

  for (const block of blocks) {
    const result = await render({ source: block.source, format: block.format });
    report.checked++;
    onProgress?.(report.checked);
    if (!result.ok) {
      report.ok = false;
      report.diagnostics.push({
        code: result.code,
        message: result.message,
        format: block.format,
        blockLine: block.blockLine,
        line:
          block.sourceLines[(result.line ?? 1) - 1] ?? block.blockLine,
      });
    }
  }

  return report;
}

async function checkOne(
  job: RenderJob,
  format: DiagramFormat,
  render: DiagramRenderer,
): Promise<Report> {
  const result = await render({ source: job.source, format });
  const report: Report = {
    schemaVersion: 1,
    ok: result.ok,
    checked: 1,
    diagnostics: [],
  };

  if (!result.ok) {
    report.diagnostics.push({
      code: result.code,
      message: result.message,
      format,
      line: result.line ?? 1,
      blockLine: 1,
    });
    return report;
  }

  // Only `render` returns the artifact; `check` answers with the diagnostics.
  if (job.mode === 'render') {
    report.svg = result.svg;
  }
  return report;
}

function validateSource(
  source: string,
  sourceBytes: number,
  messages: RendererMessages,
): void {
  if (new TextEncoder().encode(source).length > sourceBytes) {
    throw new AutomationFailure('input.too_large', messages.tooLarge);
  }
}

export function errorReport(error: unknown): Report {
  return {
    schemaVersion: 1,
    ok: false,
    checked: 0,
    diagnostics: [
      {
        code: error instanceof AutomationFailure ? error.code : 'automation.failed',
        message: error instanceof Error ? error.message : String(error),
      },
    ],
  };
}
