import { describe, expect, it, vi } from 'vitest';
import { extractDiagrams, runJob } from './diagramReport';
import type { RenderJob, RenderResult, RendererLimits, RendererMessages } from './types';

const messages: RendererMessages = {
  tooLarge: 'too large',
  tooMany: 'too many',
  empty: 'empty',
  timeout: 'timeout',
  noSvg: 'no svg',
  loadFailed: 'load failed',
};

const limits: RendererLimits = {
  sourceBytes: 2 * 1024 * 1024,
  diagrams: 100,
  timeoutMs: 30_000,
};

function job(overrides: Partial<RenderJob> = {}): RenderJob {
  return {
    jobId: 1,
    mode: 'check',
    source: '',
    format: 'markdown',
    limits,
    messages,
    ...overrides,
  };
}

function renderer(result: RenderResult): (input: { source: string }) => Promise<RenderResult> {
  return vi.fn(async () => result);
}

describe('automation fence extraction', () => {
  it('extracts mermaid and plantuml fences with document lines and ignores other languages', () => {
    const markdown = [
      '# Title',
      '',
      '```mermaid',
      'graph TD',
      'A --> B',
      '```',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      '~~~plantuml',
      '@startuml',
      'Alice -> Bob',
      '@enduml',
      '~~~',
      '',
    ].join('\n');

    const blocks = extractDiagrams(markdown, 100, messages);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ format: 'mermaid', blockLine: 3 });
    expect(blocks[0].source).toContain('A --> B');
    expect(blocks[1]).toMatchObject({ format: 'plantuml', blockLine: 12 });
    expect(blocks[1].source).toContain('@enduml');
  });

  it('maps content lines back through blockquote containers', () => {
    const markdown = ['> quote', '>', '> ```mermaid', '> graph TD', '> A --> B', '> ```', ''].join(
      '\n',
    );

    const blocks = extractDiagrams(markdown, 100, messages);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockLine).toBe(3);
    expect(blocks[0].source).toContain('graph TD');
    expect(blocks[0].source).toContain('A --> B');
    // The diagram media lines must still point at real document lines.
    expect(blocks[0].sourceLines[0]).toBe(4);
  });

  it('accepts a byte order mark and windows line endings', () => {
    const markdown = '\uFEFF```mermaid\r\ngraph TD\r\n```\r\n';

    const blocks = extractDiagrams(markdown, 100, messages);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ format: 'mermaid', blockLine: 1 });
  });
});

describe('automation job execution', () => {
  it('reports one diagram with a mapped error line', async () => {
    const markdown = ['intro', '', '```mermaid', 'graph TD', 'A --> B', '```', ''].join('\n');
    const render = renderer({ ok: false, code: 'diagram.invalid', message: 'bad', line: 2 });

    const report = await runJob(job({ source: markdown }), render);

    expect(report).toMatchObject({ schemaVersion: 1, ok: false, checked: 1 });
    expect(report.diagnostics[0]).toMatchObject({
      code: 'diagram.invalid',
      format: 'mermaid',
      blockLine: 3,
      line: 5,
    });
  });

  it('keeps checking after one diagram fails', async () => {
    const markdown = [
      '```mermaid',
      'broken',
      '```',
      '',
      '```plantuml',
      '@startuml',
      '@enduml',
      '```',
      '',
    ].join('\n');
    const render = vi
      .fn<(input: { source: string }) => Promise<RenderResult>>()
      .mockResolvedValueOnce({ ok: false, code: 'diagram.invalid', message: 'bad', line: 1 })
      .mockResolvedValueOnce({ ok: true, svg: '<svg/>' });

    const report = await runJob(job({ source: markdown }), render);

    expect(report.checked).toBe(2);
    expect(report.ok).toBe(false);
    expect(report.diagnostics).toHaveLength(1);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('counts an empty fence as checked and fails it instead of skipping it', async () => {
    const markdown = '```mermaid\n```\n';
    const render = renderer({ ok: false, code: 'diagram.empty', message: 'empty' });

    const report = await runJob(job({ source: markdown }), render);

    expect(report.checked).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'diagram.empty',
      format: 'mermaid',
      blockLine: 1,
      line: 1,
    });
  });

  it('succeeds with checked 0 when the document has no supported fence', async () => {
    const render = renderer({ ok: true, svg: '<svg/>' });

    const report = await runJob(job({ source: '# nothing here\n' }), render);

    expect(report).toEqual({ schemaVersion: 1, ok: true, checked: 0, diagnostics: [] });
    expect(render).not.toHaveBeenCalled();
  });

  it('reports every completed diagram through the progress callback', async () => {
    const markdown = '```mermaid\ngraph TD\n```\n\n```mermaid\ngraph LR\n```\n';
    const progress: number[] = [];

    await runJob(job({ source: markdown }), renderer({ ok: true, svg: '<svg/>' }), (completed) =>
      progress.push(completed),
    );

    expect(progress).toEqual([1, 2]);
  });

  it('rejects oversized sources before rendering', async () => {
    const render = renderer({ ok: true, svg: '<svg/>' });

    const report = await runJob(
      job({ source: 'x'.repeat(11), limits: { ...limits, sourceBytes: 10 } }),
      render,
    );

    expect(report).toMatchObject({ ok: false, checked: 0 });
    expect(report.diagnostics[0].code).toBe('input.too_large');
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects too many diagrams before rendering any of them', async () => {
    const markdown = '```mermaid\ngraph TD\n```\n'.repeat(3);
    const render = renderer({ ok: true, svg: '<svg/>' });

    const report = await runJob(
      job({ source: markdown, limits: { ...limits, diagrams: 2 } }),
      render,
    );

    expect(report.diagnostics[0].code).toBe('input.too_many_diagrams');
    expect(render).not.toHaveBeenCalled();
  });

  it('renders a single diagram and returns its svg in render mode', async () => {
    const render = renderer({ ok: true, svg: '<svg>ok</svg>' });

    const report = await runJob(job({ source: 'graph TD', format: 'mermaid', mode: 'render' }), render);

    expect(report).toEqual({
      schemaVersion: 1,
      ok: true,
      checked: 1,
      diagnostics: [],
      svg: '<svg>ok</svg>',
    });
  });

  it('checks a single diagram without returning its svg', async () => {
    const render = renderer({ ok: true, svg: '<svg>ok</svg>' });

    const report = await runJob(job({ source: 'graph TD', format: 'mermaid' }), render);

    expect(report).toEqual({
      schemaVersion: 1,
      ok: true,
      checked: 1,
      diagnostics: [],
    });
  });

  it('defaults a single-diagram failure to the first line', async () => {
    const render = renderer({ ok: false, code: 'diagram.invalid', message: 'bad' });

    const report = await runJob(
      job({ source: 'graph TD', format: 'mermaid', mode: 'render' }),
      render,
    );

    expect(report.diagnostics[0]).toMatchObject({
      code: 'diagram.invalid',
      format: 'mermaid',
      blockLine: 1,
      line: 1,
    });
  });

  it('turns an unexpected renderer failure into a failing report', async () => {
    const render = vi.fn(async () => {
      throw new Error('renderer exploded');
    });

    const report = await runJob(job({ source: 'graph TD', format: 'mermaid' }), render);

    expect(report).toMatchObject({ ok: false, checked: 0 });
    expect(report.diagnostics[0]).toEqual({
      code: 'automation.failed',
      message: 'renderer exploded',
    });
  });
});
