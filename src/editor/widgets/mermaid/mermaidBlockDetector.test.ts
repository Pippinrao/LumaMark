import { describe, expect, it } from 'vitest';
import { detectMermaidBlocks } from './mermaidBlockDetector';

describe('detectMermaidBlocks', () => {
  it('detects a mermaid fenced block with source offsets', () => {
    const source = ['flowchart TD', '  A --> B'].join('\n');
    const markdown = ['before', '```mermaid', source, '```', 'after'].join(
      '\n',
    );

    const [block] = detectMermaidBlocks(markdown);

    expect(block).toMatchObject({
      content: source,
      fence: '```',
      info: 'mermaid',
      language: 'mermaid',
    });
    expect(markdown.slice(block.from, block.to)).toBe(
      ['```mermaid', source, '```'].join('\n'),
    );
    expect(markdown.slice(block.contentFrom, block.contentTo)).toBe(source);
  });

  it('supports tilde fences and ignores non-mermaid code blocks', () => {
    const markdown = [
      '```ts',
      'const mermaid = true',
      '```',
      '~~~mermaid',
      'sequenceDiagram',
      '  A->>B: hello',
      '~~~',
    ].join('\n');

    const blocks = detectMermaidBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      content: ['sequenceDiagram', '  A->>B: hello'].join('\n'),
      fence: '~~~',
      info: 'mermaid',
      language: 'mermaid',
    });
  });

  it('requires a matching closing fence with the same marker family', () => {
    const markdown = [
      '```mermaid',
      'flowchart TD',
      '~~~',
      '# still code',
      '```',
    ].join('\n');

    const [block] = detectMermaidBlocks(markdown);

    expect(block.content).toBe(['flowchart TD', '~~~', '# still code'].join('\n'));
  });
});
