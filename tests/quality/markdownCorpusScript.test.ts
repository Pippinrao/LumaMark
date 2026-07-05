import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const requiredCorpusNodes = [
  'ATXHeading1',
  'Autolink',
  'Blockquote',
  'BulletList',
  'Emphasis',
  'FencedCode',
  'HardBreak',
  'HTMLBlock',
  'InlineCode',
  'Link',
  'OrderedList',
  'Strikethrough',
  'Table',
  'Task',
  'URL',
] as const;

describe('markdown corpus parser script', () => {
  it('requires parser coverage for CommonMark and GFM syntax nodes', async () => {
    const script = await readFile(
      join(process.cwd(), 'scripts', 'quality', 'test-markdown-corpus.mjs'),
      'utf8',
    );

    for (const nodeName of requiredCorpusNodes) {
      expect(script).toContain(`'${nodeName}'`);
    }

    expect(script).toContain('markdownFixtureManifest');
    expect(script).toContain('tests/fixtures/markdown');
  });
});
