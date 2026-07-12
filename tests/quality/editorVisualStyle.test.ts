import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('editor visual style contract', () => {
  it('uses system-first typography tokens for the app and editor', async () => {
    const tokens = await readCss('src', 'shared', 'styles', 'tokens.css');

    expect(tokens).toContain('--lm-font-sans: "Aptos"');
    expect(tokens).toContain('"Segoe UI Variable"');
    expect(tokens).toContain('"MiSans"');
    expect(tokens).toContain('"HarmonyOS Sans SC"');
    expect(tokens).toContain('--lm-font-display: "Aptos Display"');
    expect(tokens).toContain('--lm-font-mono: "Cascadia Code"');
    expect(tokens).not.toContain('Inter,');
  });

  it('keeps the CodeMirror document surface paper-grade instead of default editor-like', async () => {
    const editorCss = await readCss('src', 'editor', 'core', 'editor.css');

    expect(editorCss).toContain('font-size: 16.5px;');
    expect(editorCss).toContain('line-height: 1.74;');
    expect(editorCss).toContain('max-width: 810px;');
    expect(editorCss).toContain('font-feature-settings: "kern" 1');
    expect(editorCss).toContain('font-variant-east-asian: proportional-width;');
  });

  it('styles Markdown blocks with document-grade rhythm and surfaces', async () => {
    const wysiwygCss = await readCss('src', 'editor', 'wysiwyg', 'wysiwyg.css');
    const mermaidCss = await readCss(
      'src',
      'editor',
      'capabilities',
      'mermaid',
      'mermaid.css',
    );

    expect(wysiwygCss).toContain('font-family: var(--lm-font-display);');
    expect(wysiwygCss).toContain('.cm-content .lm-md-blockquote');
    expect(wysiwygCss).toContain('border-left: 3px solid var(--lm-color-accent);');
    expect(wysiwygCss).toContain('box-decoration-break: clone;');
    expect(wysiwygCss).toContain('.cm-content .lm-md-table');
    expect(wysiwygCss).toContain('.cm-content .lm-md-table-row');
    expect(wysiwygCss).toContain('.cm-content .lm-md-code-block-line');
    expect(mermaidCss).toContain('border: 1px solid var(--lm-color-border-subtle);');
    expect(mermaidCss).toContain('margin: 26px 0 34px;');
    expect(mermaidCss).toContain('position: relative;');
    expect(mermaidCss).toContain('visibility: hidden;');
    expect(mermaidCss).toContain('.cm-content .lm-mermaid-preview:hover .lm-mermaid-actions');
    expect(mermaidCss).toContain('width: 30px;');
  });
});

async function readCss(...segments: string[]): Promise<string> {
  return readFile(join(process.cwd(), ...segments), 'utf8');
}
