import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'codeBlock.css'),
  'utf8',
);

describe('code block fence chrome', () => {
  it('paints start and end chrome above hidden fence glyphs', () => {
    expect(css).toMatch(
      /\.lm-md-code-block-start:not\(:has\(\.lm-md-source-mark-block\)\)::before[\s\S]*z-index:\s*1/,
    );
    expect(css).toMatch(
      /\.lm-md-code-block-end:not\(:has\(\.lm-md-source-mark-block\)\)::before[\s\S]*z-index:\s*1/,
    );
  });

  it('paints live-preview selection above the opaque code surface', () => {
    expect(css).toMatch(
      /\.cm-content \.lm-md-code-block-line ::selection[\s\S]*background:/,
    );
  });
});
