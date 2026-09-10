import { beforeEach, describe, expect, it, vi } from 'vitest';

const mermaidMock = vi.hoisted(() => ({
  parse: vi.fn(),
  initialize: vi.fn(),
  render: vi.fn(),
}));

const plantumlMock = vi.hoisted(() => ({
  getPlantumlEngine: vi.fn(),
  renderPlantumlOnThread: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaidMock }));
vi.mock('../../editor/capabilities/plantuml/plantumlEngine', () => ({
  getPlantumlEngine: plantumlMock.getPlantumlEngine,
  renderPlantumlOnThread: plantumlMock.renderPlantumlOnThread,
}));

import { renderDiagram } from './diagramEngines';
import type { RendererMessages } from './types';

const messages: RendererMessages = {
  tooLarge: 'too large',
  tooMany: 'too many',
  empty: 'empty',
  timeout: 'timeout',
  noSvg: 'no svg',
  loadFailed: 'load failed',
};

const TIMEOUT_MS = 1_000;

beforeEach(() => {
  vi.clearAllMocks();
  plantumlMock.getPlantumlEngine.mockResolvedValue({});
});

describe('automation diagram engines', () => {
  it('renders mermaid through the editor adapter and sanitizes the result', async () => {
    mermaidMock.parse.mockResolvedValue(undefined);
    mermaidMock.render.mockResolvedValue({
      svg: '<svg><script>alert(1)</script><text>OutputMarker</text></svg>',
    });

    const result = await renderDiagram(
      { source: 'graph TD\nA[OutputMarker] --> B', format: 'mermaid' },
      messages,
      TIMEOUT_MS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toContain('OutputMarker');
    expect(result.svg).not.toContain('<script');
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ htmlLabels: false, securityLevel: 'strict' }),
    );
  });

  it('maps a mermaid parse failure to a diagram diagnostic with its engine line', async () => {
    mermaidMock.parse.mockRejectedValue(
      Object.assign(new Error('Parse error on line 2'), {
        hash: { loc: { first_line: 2 } },
      }),
    );

    const result = await renderDiagram(
      { source: 'graph TD\nA -->', format: 'mermaid' },
      messages,
      TIMEOUT_MS,
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'diagram.invalid',
      message: 'Parse error on line 2',
      line: 2,
    });
  });

  it('maps a mermaid render failure to a diagram diagnostic', async () => {
    mermaidMock.parse.mockResolvedValue(undefined);
    mermaidMock.render.mockRejectedValue(new Error('render exploded'));

    const result = await renderDiagram({ source: 'graph TD', format: 'mermaid' }, messages, TIMEOUT_MS);

    expect(result).toMatchObject({ ok: false, code: 'diagram.invalid', message: 'render exploded' });
  });

  it('treats an engine that returns no svg as a runtime failure, not a syntax error', async () => {
    mermaidMock.parse.mockResolvedValue(undefined);
    mermaidMock.render.mockResolvedValue({ svg: 'no diagram here' });

    const result = await renderDiagram({ source: 'graph TD', format: 'mermaid' }, messages, TIMEOUT_MS);

    expect(result).toMatchObject({ ok: false, code: 'renderer.unavailable', message: 'no svg' });
  });

  it('reports a missing PlantUML engine as unavailable', async () => {
    plantumlMock.getPlantumlEngine.mockRejectedValue(new Error('chunk missing'));

    const result = await renderDiagram(
      { source: '@startuml\nA -> B\n@enduml', format: 'plantuml' },
      messages,
      TIMEOUT_MS,
    );

    expect(result).toMatchObject({ ok: false, code: 'renderer.unavailable' });
    expect(result.ok === false && result.message).toContain('load failed');
  });

  it('reads a PlantUML engine error page as a diagram diagnostic with its line', async () => {
    plantumlMock.renderPlantumlOnThread.mockResolvedValue(
      '<svg><text>Syntax Error?</text><text>[From string (line 3)]</text></svg>',
    );

    const result = await renderDiagram(
      { source: '@startuml\nA ->\n@enduml', format: 'plantuml' },
      messages,
      TIMEOUT_MS,
    );

    expect(result).toMatchObject({ ok: false, code: 'diagram.invalid', line: 3 });
    expect(result.ok === false && result.message).toContain('Syntax Error?');
  });

  it('keeps a legitimate title that merely mentions a syntax error renderable', async () => {
    plantumlMock.renderPlantumlOnThread.mockResolvedValue(
      '<svg><text>Syntax Error?</text><text>Alice -> Bob</text></svg>',
    );

    const result = await renderDiagram(
      { source: '@startuml\ntitle Syntax Error?\nAlice -> Bob\n@enduml', format: 'plantuml' },
      messages,
      TIMEOUT_MS,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects empty source without touching an engine', async () => {
    const result = await renderDiagram({ source: '   \n', format: 'mermaid' }, messages, TIMEOUT_MS);

    expect(result).toMatchObject({ ok: false, code: 'diagram.empty', message: 'empty' });
    expect(plantumlMock.renderPlantumlOnThread).not.toHaveBeenCalled();
    expect(mermaidMock.parse).not.toHaveBeenCalled();
  });

  it('fails a diagram that exceeds the rendering deadline', async () => {
    plantumlMock.renderPlantumlOnThread.mockImplementation(() => new Promise(() => undefined));

    const result = await renderDiagram({ source: '@startuml\nA -> B\n@enduml', format: 'plantuml' }, messages, 5);

    expect(result).toMatchObject({ ok: false, code: 'renderer.timeout', message: 'timeout' });
  });

  it('reports a missing mermaid chunk as unavailable instead of an invalid diagram', async () => {
    vi.resetModules();
    vi.doMock('mermaid', () => {
      throw new Error('chunk missing');
    });

    const isolated = await import('./diagramEngines');
    const result = await isolated.renderDiagram({ source: 'graph TD', format: 'mermaid' }, messages, TIMEOUT_MS);

    expect(result).toMatchObject({ ok: false, code: 'renderer.unavailable' });

    vi.doUnmock('mermaid');
    vi.resetModules();
  });
});
