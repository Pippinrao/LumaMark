import { describe, expect, it } from 'vitest';
import { parseMarkdownOutline } from './outlineParser';

describe('parseMarkdownOutline', () => {
  it('extracts ATX headings with levels, line numbers and document positions', () => {
    const markdown = [
      '# LumaMark',
      '',
      'Intro text',
      '',
      '## Editor Core',
      '',
      '### Mermaid Preview ###',
    ].join('\n');

    expect(parseMarkdownOutline(markdown)).toEqual([
      {
        from: 0,
        id: 'lumamark',
        level: 1,
        line: 1,
        text: 'LumaMark',
        to: 10,
      },
      {
        from: 24,
        id: 'editor-core',
        level: 2,
        line: 5,
        text: 'Editor Core',
        to: 38,
      },
      {
        from: 40,
        id: 'mermaid-preview',
        level: 3,
        line: 7,
        text: 'Mermaid Preview',
        to: 63,
      },
    ]);
  });

  it('ignores headings inside fenced code blocks', () => {
    const markdown = [
      '# Visible',
      '',
      '```markdown',
      '# Hidden',
      '```',
      '',
      '## Visible Again',
    ].join('\n');

    expect(parseMarkdownOutline(markdown).map((heading) => heading.text)).toEqual([
      'Visible',
      'Visible Again',
    ]);
  });

  it('does not close a fence when the marker line has trailing code text', () => {
    const markdown = [
      '# Visible',
      '',
      '```markdown',
      '```still-code',
      '# Still Hidden',
      '```',
      '',
      '## Visible Again',
    ].join('\n');

    expect(parseMarkdownOutline(markdown).map((heading) => heading.text)).toEqual([
      'Visible',
      'Visible Again',
    ]);
  });

  it('preserves a literal trailing hash without the required closing-sequence space', () => {
    expect(parseMarkdownOutline('# C#')).toMatchObject([
      { id: 'c', text: 'C#' },
    ]);
    expect(parseMarkdownOutline('# C #')).toMatchObject([
      { id: 'c', text: 'C' },
    ]);
  });

  it('keeps generated ids globally unique when explicit suffixes collide', () => {
    expect(
      parseMarkdownOutline('# Foo\n## Foo\n### Foo-2\n#### Foo').map(
        (heading) => heading.id,
      ),
    ).toEqual(['foo-1', 'foo-2', 'foo-2-2', 'foo-3']);
  });

  it('uses Markdown syntax nodes for indented ATX and Setext headings', () => {
    const markdown = [
      '   ## Indented ATX',
      '    ### Four-space code, not a heading',
      '',
      'Setext Level One',
      '================',
      '',
      'Setext Level Two',
      '----------------',
    ].join('\n');

    expect(
      parseMarkdownOutline(markdown).map(({ level, line, text }) => ({
        level,
        line,
        text,
      })),
    ).toEqual([
      { level: 2, line: 1, text: 'Indented ATX' },
      { level: 1, line: 4, text: 'Setext Level One' },
      { level: 2, line: 7, text: 'Setext Level Two' },
    ]);
  });

  it('derives visible heading text from formatted inline syntax', () => {
    const markdown = [
      '## [Editor *Core*](./editor.md) ![Diagram alt](diagram.png) `code span` &amp; \\#',
      '',
      'Setext [Guide][guide] ![Logo][logo] `sample` &#35; \\*',
      '---',
      '',
      '[guide]: ./guide.md',
      '[logo]: ./logo.png',
    ].join('\n');

    expect(
      parseMarkdownOutline(markdown).map(({ id, text }) => ({ id, text })),
    ).toEqual([
      {
        id: 'editor-core-diagram-alt-code-span',
        text: 'Editor Core Diagram alt code span & #',
      },
      {
        id: 'setext-guide-logo-sample',
        text: 'Setext Guide Logo sample # *',
      },
    ]);
  });
});
