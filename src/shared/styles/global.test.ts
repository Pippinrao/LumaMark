import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(
  resolve(process.cwd(), 'src/shared/styles/global.css'),
  'utf8',
);

describe('global editor search styles', () => {
  it('keeps the top search panel compact on wide editors and near-full-width on narrow editors', () => {
    expect(styles).toMatch(
      /\.lm-editor-paper \.cm-panels-top \.cm-search\s*\{[\s\S]*?width:\s*min\(44rem,\s*calc\(100% - 16px\)\);[\s\S]*?max-width:\s*44rem;/,
    );
    expect(styles).toMatch(
      /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.lm-editor-paper \.cm-panels-top \.cm-search\s*\{[\s\S]*?width:\s*calc\(100% - 12px\);/,
    );
  });

  it('hides replacement controls whenever the editor enters reading mode', () => {
    expect(styles).toMatch(
      /\.lm-editor-reading-mode \.cm-search \[name=['"]replace['"]\],[\s\S]*?\.lm-editor-reading-mode \.cm-search \[name=['"]replaceAll['"]\]\s*\{[\s\S]*?display:\s*none;/,
    );
  });
});
