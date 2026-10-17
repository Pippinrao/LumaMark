import { describe, expect, it, vi, type Mock } from 'vitest';
import { renderExportDocument } from './renderExportDocument';
import type {
  ExportMathFormula,
  ExportRenderDeps,
  ExportRenderInput,
} from './exportTypes';

const messages = {
  diagramFailed: 'Diagram could not be rendered.',
  imageUnavailable: 'Image could not be embedded.',
  mathFailed: 'Formula could not be rendered.',
};

function input(markdown: string, overrides: Partial<ExportRenderInput> = {}): ExportRenderInput {
  return {
    documentPath: 'E:\\notes\\note.md',
    language: 'en',
    markdown,
    math: { numbering: 'none', physics: false, syntaxMode: 'pandoc' },
    messages,
    plantumlEnabled: true,
    ...overrides,
  };
}

type MockDeps = {
  embedImage: Mock<ExportRenderDeps['embedImage']>;
  renderDiagram: Mock<ExportRenderDeps['renderDiagram']>;
  renderMath: Mock<ExportRenderDeps['renderMath']>;
};

function deps(overrides: Partial<ExportRenderDeps> = {}): MockDeps {
  const renderMath = vi.fn(
    async (formulas: readonly ExportMathFormula[]) => ({
      formulas: new Map(
        formulas.map((formula) => [
          formula.id,
          `<mjx-container>${formula.source}</mjx-container>`,
        ]),
      ),
      kind: 'rendered' as const,
      stylesheet: '.mjx-container{display:inline-block}',
    }),
  );
  const renderDiagram = vi.fn(async () => ({
    kind: 'svg' as const,
    svg: '<svg data-testid="diagram"><text>diagram</text></svg>',
  }));
  const embedImage = vi.fn(async (source: string) =>
    source.includes('bad')
      ? {
          kind: 'error' as const,
          message: 'read failed',
          reason: 'export.image_read_failed' as const,
        }
      : {
          dataUri: 'data:image/png;base64,AAAA',
          kind: 'dataUri' as const,
          mimeType: 'image/png',
        },
  );

  return {
    embedImage: overrides.embedImage
      ? vi.fn(overrides.embedImage)
      : embedImage,
    renderDiagram: overrides.renderDiagram
      ? vi.fn(overrides.renderDiagram)
      : renderDiagram,
    renderMath: overrides.renderMath ? vi.fn(overrides.renderMath) : renderMath,
  };
}

describe('renderExportDocument', () => {
  it('renders headings, emphasis, code fences, and escapes raw HTML', async () => {
    const result = await renderExportDocument(
      input(
        [
          '# Title',
          '',
          'Hello **bold** and `inline`.',
          '',
          '<script>alert(1)</script>',
          '',
          '```ts',
          'const value = 1;',
          '```',
        ].join('\n'),
      ),
      deps(),
    );

    expect(result.title).toBe('note');
    expect(result.html).toContain('<h1>Title</h1>');
    expect(result.html).toContain('<strong>bold</strong>');
    expect(result.html).toContain('language-ts');
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).toContain('default-src \'none\'');
  });

  it('renders GFM tables and task lists', async () => {
    const result = await renderExportDocument(
      input(
        [
          '| A | B |',
          '| --- | --- |',
          '| 1 | 2 |',
          '',
          '- [x] done',
          '- [ ] todo',
        ].join('\n'),
      ),
      deps(),
    );

    expect(result.html).toContain('<table>');
    expect(result.html).toContain('<th>A</th>');
    expect(result.html).toContain('task-list-item-checkbox');
    expect(result.html).toContain('checked');
    expect(result.html).toContain('disabled');
  });

  it('renders inline and block math through the batch renderer', async () => {
    const depsValue = deps();
    const result = await renderExportDocument(
      input(
        [
          'Inline $a+b$ math.',
          '',
          '$$',
          'x^2',
          '$$',
        ].join('\n'),
      ),
      depsValue,
    );

    expect(depsValue.renderMath).toHaveBeenCalledTimes(1);
    expect(result.html).toContain('<mjx-container>a+b</mjx-container>');
    expect(result.html).toContain('<mjx-container>x^2</mjx-container>');
    expect(result.html).toContain('data-lm-export-math');
  });

  it('does not parse math inside code spans', async () => {
    const depsValue = deps();
    const result = await renderExportDocument(
      input('Use `$not-math$` literally.'),
      depsValue,
    );

    expect(depsValue.renderMath).not.toHaveBeenCalled();
    expect(result.html).toContain('<code>$not-math$</code>');
  });

  it('replaces mermaid fences with sanitized SVG figures', async () => {
    const depsValue = deps();
    const result = await renderExportDocument(
      input(['```mermaid', 'graph TD', '  A --> B', '```'].join('\n')),
      depsValue,
    );

    expect(depsValue.renderDiagram).toHaveBeenCalledWith(
      'graph TD\n  A --> B\n',
      'mermaid',
    );
    expect(result.html).toContain('class="lm-export-diagram"');
    expect(result.html).toContain('data-testid="diagram"');
  });

  it('keeps PlantUML fences as code when PlantUML is disabled', async () => {
    const depsValue = deps();
    const result = await renderExportDocument(
      input(['```plantuml', '@startuml', 'A -> B', '@enduml', '```'].join('\n'), {
        plantumlEnabled: false,
      }),
      depsValue,
    );

    expect(depsValue.renderDiagram).not.toHaveBeenCalled();
    expect(result.html).toContain('language-plantuml');
  });

  it('embeds images as data URIs and reports failures', async () => {
    const result = await renderExportDocument(
      input('![good](good.png)\n\n![broken](bad.png)'),
      deps(),
    );

    expect(result.html).toContain('src="data:image/png;base64,AAAA"');
    expect(result.html).toContain('lm-export-image-missing');
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'export.image_read_failed',
        source: 'bad.png',
      }),
    ]);
  });

  it('drops javascript link targets while keeping the link text', async () => {
    const result = await renderExportDocument(
      input('[click](javascript:alert(1))'),
      deps(),
    );

    expect(result.html).not.toContain('<a href="javascript:');
    expect(result.html).toContain('click');
  });

  it('falls back to a visible placeholder when math rendering fails', async () => {
    const depsValue = deps({
      renderMath: vi.fn(async () => ({
        kind: 'failed' as const,
        message: 'boom',
      })),
    });
    const result = await renderExportDocument(
      input('Inline $x$ math.'),
      depsValue,
    );

    expect(result.html).toContain('lm-export-math-error');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'export.math_failed', source: 'x' }),
    ]);
  });

  it('uses the document stem as title and supports an explicit title', async () => {
    const fileTitle = await renderExportDocument(input('# Heading'), deps());
    expect(fileTitle.title).toBe('note');

    const headingTitle = await renderExportDocument(
      input('# Heading', { documentPath: null }),
      deps(),
    );
    expect(headingTitle.title).toBe('Heading');

    const explicit = await renderExportDocument(
      input('# Heading', { title: 'Custom' }),
      deps(),
    );
    expect(explicit.title).toBe('Custom');
  });
});
