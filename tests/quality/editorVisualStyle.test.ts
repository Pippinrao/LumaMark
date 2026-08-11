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

    expect(editorCss).toContain(
      'font-size: calc(16.5px * var(--lm-editor-font-scale, 1));',
    );
    expect(editorCss).toContain('line-height: 1.74;');
    expect(editorCss).toContain(
      'max-width: var(--lm-editor-page-width, 810px);',
    );
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
    expect(mermaidCss).toContain('margin: 0;');
    expect(mermaidCss).toContain(
      "Vertical margin on\n * replace widgets is invisible to CodeMirror's height map",
    );
    expect(mermaidCss).toContain('position: relative;');
    expect(mermaidCss).toContain('visibility: hidden;');
    expect(mermaidCss).toContain('.cm-content .lm-mermaid-preview:hover .lm-mermaid-actions');
    expect(mermaidCss).toContain('width: 30px;');
  });

  it('keeps focused code block visuals inside CodeMirror line geometry', async () => {
    const wysiwygCss = await readCss('src', 'editor', 'wysiwyg', 'wysiwyg.css');
    const lineRule = cssDeclarationBlock(
      wysiwygCss,
      '.cm-content .lm-md-code-block-line',
    );
    const activeRule = cssDeclarationBlock(
      wysiwygCss,
      '.cm-editor.cm-focused .cm-content .lm-md-code-block-active',
    );
    const languageRule = cssDeclarationBlock(
      wysiwygCss,
      '.cm-editor.cm-focused .cm-content .lm-md-code-block-start[data-lm-code-language]::after',
    );

    expect(lineRule).not.toBeNull();
    expect(lineRule).toContain('position: relative;');
    expect(lineRule).not.toMatch(/\b(?:margin|padding|line-height)\s*:/);
    expect(activeRule).toContain('--lm-code-block-border-color:');
    expect(activeRule).not.toMatch(/\b(?:margin|padding|line-height)\s*:/);
    expect(languageRule).toContain('content: attr(data-lm-code-language);');
    expect(languageRule).toContain('position: absolute;');
    expect(languageRule).toContain('pointer-events: none;');
  });
});

async function readCss(...segments: string[]): Promise<string> {
  return readFile(join(process.cwd(), ...segments), 'utf8');
}

function cssDeclarationBlock(css: string, selector: string): string | null {
  const start = css.indexOf(`${selector} {`);

  if (start < 0) {
    return null;
  }

  const declarationStart = css.indexOf('{', start) + 1;
  const declarationEnd = css.indexOf('}', declarationStart);

  return declarationEnd < 0
    ? null
    : css.slice(declarationStart, declarationEnd);
}
