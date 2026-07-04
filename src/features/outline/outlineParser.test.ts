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
});
