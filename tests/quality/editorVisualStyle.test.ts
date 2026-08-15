import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const codeSyntaxTokenVariables = {
  atom: '--lm-code-syntax-number-atom',
  comment: '--lm-code-syntax-comment',
  definition: '--lm-code-syntax-function-definition',
  function: '--lm-code-syntax-function-definition',
  keyword: '--lm-code-syntax-keyword',
  meta: '--lm-code-syntax-meta',
  number: '--lm-code-syntax-number-atom',
  operator: '--lm-code-syntax-operator',
  property: '--lm-code-syntax-property',
  punctuation: '--lm-code-syntax-punctuation',
  string: '--lm-code-syntax-string',
  type: '--lm-code-syntax-type',
  variable: '--lm-code-syntax-variable',
} as const;
const codeBlockThemeVariables = [
  '--lm-code-block-surface',
  '--lm-code-block-surface-active',
  '--lm-code-block-border',
  '--lm-code-block-border-active',
  '--lm-code-block-text',
  '--lm-code-block-badge',
] as const;

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
    const codeBlockCss = await readCss(
      'src',
      'editor',
      'capabilities',
      'code-block',
      'codeBlock.css',
    );

    expect(wysiwygCss).toContain('font-family: var(--lm-font-display);');
    expect(wysiwygCss).toContain('.cm-content .lm-md-blockquote');
    expect(wysiwygCss).toContain('border-left: 3px solid var(--lm-color-accent);');
    expect(wysiwygCss).toContain('box-decoration-break: clone;');
    expect(wysiwygCss).toContain('.cm-content .lm-md-table');
    expect(wysiwygCss).toContain('.cm-content .lm-md-table-row');
    expect(wysiwygCss).not.toContain('.lm-md-code-block-');
    expect(wysiwygCss).not.toContain('.lm-code-token-');
    expect(codeBlockCss).toContain('.lm-md-code-block-line');
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
    const codeBlockCss = await readCss(
      'src',
      'editor',
      'capabilities',
      'code-block',
      'codeBlock.css',
    );
    const lineRule = cssDeclarationBlock(
      codeBlockCss,
      '.lm-codemirror .cm-content .lm-md-code-block-line',
    );
    const surfaceRule = cssDeclarationBlock(
      codeBlockCss,
      '.cm-content .lm-md-code-block-line::before',
    );
    const startRule = cssDeclarationBlock(
      codeBlockCss,
      '.cm-content .lm-md-code-block-start::before',
    );
    const endRule = cssDeclarationBlock(
      codeBlockCss,
      '.cm-content .lm-md-code-block-end::before',
    );
    const singleLineRule = cssDeclarationBlock(
      codeBlockCss,
      '.cm-content .lm-md-code-block-start.lm-md-code-block-end::before',
    );
    const activeRule = cssDeclarationBlock(
      codeBlockCss,
      '.cm-editor.cm-focused .cm-content .lm-md-code-block-active',
    );
    const languageRule = cssDeclarationBlock(
      codeBlockCss,
      '.cm-editor.cm-focused .cm-content .lm-md-code-block-active.lm-md-code-block-start[data-lm-code-language]::after',
    );

    expect(lineRule).not.toBeNull();
    expect(lineRule).toContain('position: relative;');
    expect(lineRule).toContain('padding-inline: var(--lm-space-3);');
    expect(lineRule).not.toMatch(
      /\b(?:margin(?:-[a-z-]+)?|padding(?!-inline\b)(?:-[a-z-]+)?|line-height|transform|filter|overflow)\s*:/,
    );
    expect(surfaceRule).toContain("content: '';");
    expect(surfaceRule).toContain('position: absolute;');
    expect(surfaceRule).toContain('pointer-events: none;');
    expect(surfaceRule).toContain('background: var(--lm-code-block-current-surface);');
    expect(startRule).toContain('inset-block-start: 50%;');
    expect(startRule).toContain('inset-block-end: 0;');
    expect(endRule).toContain('inset-block-start: 0;');
    expect(endRule).toContain('inset-block-end: 50%;');
    expect(singleLineRule).toContain('inset-block: 25%;');
    expect(activeRule).toContain('--lm-code-block-current-border:');
    expect(activeRule).toContain('--lm-code-block-current-surface:');
    expect(activeRule).not.toMatch(
      /\b(?:background|box-shadow|margin(?:-[a-z-]+)?|padding(?:-[a-z-]+)?|line-height|transform|filter|overflow)\s*:/,
    );
    for (const declaration of activeRule
      ?.split(';')
      .map((value) => value.trim())
      .filter(Boolean) ?? []) {
      expect(declaration).toMatch(/^--[a-z0-9-]+\s*:/);
    }
    expect(languageRule).toContain('content: attr(data-lm-code-language);');
    expect(languageRule).toContain('position: absolute;');
    expect(languageRule).toContain('pointer-events: none;');
    expect(codeBlockCss).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
    for (const [tokenClass, syntaxVariable] of Object.entries(
      codeSyntaxTokenVariables,
    )) {
      const tokenRule = cssDeclarationBlockForSelector(
        codeBlockCss,
        `.cm-content .lm-code-token-${tokenClass}`,
      );

      expect(tokenRule).not.toBeNull();
      expect(tokenRule).toContain(`color: var(${syntaxVariable});`);
    }
  });

  it('defines every code block theme token for light and dark surfaces', async () => {
    const tokensCss = await readCss('src', 'shared', 'styles', 'tokens.css');
    const lightTokens = cssDeclarationBlock(tokensCss, ':root');
    const darkTokens = cssDeclarationBlock(tokensCss, ":root[data-theme='dark']");
    const requiredVariables = new Set([
      ...codeBlockThemeVariables,
      ...Object.values(codeSyntaxTokenVariables),
    ]);

    expect(lightTokens).not.toBeNull();
    expect(darkTokens).not.toBeNull();
    for (const variable of requiredVariables) {
      expect(lightTokens).toMatch(new RegExp(`${variable}\\s*:`));
      expect(darkTokens).toMatch(new RegExp(`${variable}\\s*:`));
    }
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

function cssDeclarationBlockForSelector(
  css: string,
  selector: string,
): string | null {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((value) => value.trim());

    if (selectors.includes(selector)) {
      return match[2];
    }
  }

  return null;
}
