import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MATHJAX_SAFE_OPTIONS,
  renderMathDocument,
} from './mathDocumentRenderer';
import { bundledNewcmFontUrls } from './mathjaxFontAssets';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderMathDocument', () => {
  it('uses a minimal MathJax safe profile for user-controlled attributes', () => {
    expect(MATHJAX_SAFE_OPTIONS).toEqual({
      allow: {
        URLs: 'safe',
        classes: 'none',
        cssIDs: 'safe',
        styles: 'none',
      },
      idPattern: /^mjx-eqn:\d+$/u,
      safeProtocols: {
        data: false,
        file: false,
        http: false,
        https: false,
        javascript: false,
      },
    });
  });

  it('renders an ordered formula batch to CHTML without browser DOM APIs', async () => {
    const result = await renderMathDocument({
      documentId: 'document-a',
      formulas: [{ display: false, id: 'formula-1', source: 'x^2' }],
      generation: 7,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'none', physics: false },
    });

    expect(result.documentId).toBe('document-a');
    expect(result.generation).toBe(7);
    expect(result.formulas).toHaveLength(1);
    expect(result.formulas[0]).toEqual(
      expect.objectContaining({ id: 'formula-1', labels: [] }),
    );
    expect(result.formulas[0]?.error).toBeUndefined();
    expect(result.formulas[0]?.chtml).toContain('<mjx-container');
    expect(result.stylesheet).toContain('@font-face');
    expect(result.stylesheet).toContain(
      `url("${bundledNewcmFontUrls['mjx-ncm-n.woff2']}")`,
    );
  });

  it('keeps AMS equation labels and references in one ordered document batch', async () => {
    const result = await renderMathDocument({
      documentId: 'document-with-labels',
      formulas: [
        {
          display: true,
          id: 'equation',
          source:
            '\\begin{equation}E = mc^2\\label{eq:mass-energy}\\end{equation}',
        },
        {
          display: false,
          id: 'reference',
          source: '\\eqref{eq:mass-energy}',
        },
      ],
      generation: 3,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'ams', physics: false },
    });

    expect(result.formulas[0]).toEqual(
      expect.objectContaining({ labels: ['eq:mass-energy'] }),
    );
    const tagId = result.formulas[0]?.chtml?.match(
      /id="(lm-math-[a-z0-9]+-mjx-eqn:1)"/u,
    )?.[1];
    expect(tagId).toBeTruthy();
    expect(result.formulas[1]?.chtml).toContain(
      `#${encodeURIComponent(tagId ?? '')}`,
    );
    expect(result.formulas[1]?.labels).toEqual([]);
    expect(result.documentLabels).toEqual({
      'eq:mass-energy': { formulaId: 'equation' },
    });
  });

  it('keeps a document label owned by its defining formula', async () => {
    const result = await renderMathDocument({
      documentId: 'document-label-owner',
      formulas: [
        {
          display: true,
          id: 'label-owner',
          source: '\\begin{equation}x=y\\label{eq:owned}\\end{equation}',
        },
        { display: true, id: 'later-formula', source: 'z=w' },
      ],
      generation: 1,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'ams', physics: false },
    });

    expect(result.formulas[0]?.labels).toEqual(['eq:owned']);
    expect(result.formulas[1]?.labels).toEqual([]);
    expect(result.documentLabels).toEqual({
      'eq:owned': { formulaId: 'label-owner' },
    });
  });

  it('resolves a forward reference after compiling the complete document batch', async () => {
    const result = await renderMathDocument({
      documentId: 'document-with-forward-reference',
      formulas: [
        {
          display: false,
          id: 'reference-before-definition',
          source: '\\eqref{eq:later}',
        },
        {
          display: true,
          id: 'later-equation',
          source: '\\begin{equation}x=y\\label{eq:later}\\end{equation}',
        },
      ],
      generation: 4,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'ams', physics: false },
    });

    expect(result.formulas[0]?.error).toBeUndefined();
    expect(result.formulas[0]?.chtml).not.toContain('???');
    const tagId = result.formulas[1]?.chtml?.match(
      /id="(lm-math-[a-z0-9]+-mjx-eqn:1)"/u,
    )?.[1];
    expect(tagId).toBeTruthy();
    expect(result.formulas[0]?.chtml).toContain(
      `#${encodeURIComponent(tagId ?? '')}`,
    );
    expect(result.documentLabels).toEqual({
      'eq:later': { formulaId: 'later-equation' },
    });
  });

  it('keeps user labels out of DOM ids and scopes equation fragments to the document session', async () => {
    const result = await renderMathDocument({
      documentId: 'C:\\notes\\session-owned-labels.md',
      formulas: [
        {
          display: false,
          id: 'reference',
          source: '\\eqref{eq:user-controlled}',
        },
        {
          display: true,
          id: 'definition',
          source:
            '\\begin{equation}x=y\\label{eq:user-controlled}\\end{equation}',
        },
      ],
      generation: 1,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'ams', physics: false },
    });

    const chtml = result.formulas.map(({ chtml }) => chtml ?? '').join('');
    expect(chtml).not.toContain('mjx-eqn:eq:user-controlled');
    expect(chtml).not.toContain('mjx-eqn%3Aeq%3Auser-controlled');
    expect(chtml).toMatch(/id="lm-math-[a-z0-9]+-mjx-eqn:1"/u);
    expect(chtml).toMatch(/href="#lm-math-[a-z0-9]+-mjx-eqn%3A1"/u);
    expect(result.documentLabels).toEqual({
      'eq:user-controlled': { formulaId: 'definition' },
    });
  });

  it('applies none, AMS, and all numbering modes to the same ordered formulas', async () => {
    const render = (numbering: 'none' | 'ams' | 'all') =>
      renderMathDocument({
        documentId: `numbering-${numbering}`,
        formulas: [
          { display: true, id: 'plain-display', source: 'x=y' },
          {
            display: true,
            id: 'ams-equation',
            source: '\\begin{equation}y=z\\end{equation}',
          },
        ],
        generation: 1,
        layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
        preferences: { numbering, physics: false },
      });

    const [none, ams, all] = await Promise.all([
      render('none'),
      render('ams'),
      render('all'),
    ]);

    expect(none.formulas.every(({ chtml }) => !chtml?.includes('mjx-label'))).toBe(true);
    expect(ams.formulas[0]?.chtml).not.toContain('mjx-label');
    expect(ams.formulas[1]?.chtml).toContain('mjx-label');
    expect(all.formulas.every(({ chtml }) => chtml?.includes('mjx-label'))).toBe(true);
  });

  it('restarts numbering from document order after an equation is deleted', async () => {
    const before = await renderMathDocument({
      documentId: 'renumbered-document',
      formulas: [
        {
          display: true,
          id: 'first',
          source: '\\begin{equation}x=y\\end{equation}',
        },
        {
          display: true,
          id: 'second',
          source: '\\begin{equation}y=z\\end{equation}',
        },
      ],
      generation: 1,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'ams', physics: false },
    });
    const after = await renderMathDocument({
      documentId: 'renumbered-document',
      formulas: [
        {
          display: true,
          id: 'second',
          source: '\\begin{equation}y=z\\end{equation}',
        },
      ],
      generation: 2,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'ams', physics: false },
    });

    expect(before.formulas[1]?.chtml).toContain('mjx-c32');
    expect(after.formulas[0]?.chtml).toContain('mjx-c31');
    expect(after.formulas[0]?.chtml).not.toContain('mjx-c32');
  });

  it('keeps new commands inside one document batch without leaking to another document', async () => {
    const firstDocument = await renderMathDocument({
      documentId: 'document-with-macro',
      formulas: [
        {
          display: false,
          id: 'macro-definition',
          source: '\\newcommand{\\vect}[1]{\\mathbf{#1}}',
        },
        { display: false, id: 'macro-use', source: '\\vect{x}' },
      ],
      generation: 1,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'none', physics: false },
    });
    const secondDocument = await renderMathDocument({
      documentId: 'isolated-document',
      formulas: [{ display: false, id: 'macro-use', source: '\\vect{x}' }],
      generation: 1,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'none', physics: false },
    });

    expect(firstDocument.formulas[1]?.error).toBeUndefined();
    expect(firstDocument.formulas[1]?.chtml).not.toContain('mjx-merror');
    expect(secondDocument.formulas[0]?.chtml).toBeUndefined();
    expect(secondDocument.formulas[0]?.error).toContain(
      'Undefined control sequence',
    );
  });

  it('applies document macros only to formulas after their definition', async () => {
    const result = await renderMathDocument({
      documentId: 'document-with-ordered-macro-scope',
      formulas: [
        { display: false, id: 'before-definition', source: '\\future{x}' },
        {
          display: false,
          id: 'macro-definition',
          source: '\\newcommand{\\future}[1]{\\mathbf{#1}}',
        },
        { display: false, id: 'after-definition', source: '\\future{y}' },
      ],
      generation: 1,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'none', physics: false },
    });

    expect(result.formulas[0]?.chtml).toBeUndefined();
    expect(result.formulas[0]?.error).toContain('Undefined control sequence');
    expect(result.formulas[2]?.error).toBeUndefined();
    expect(result.formulas[2]?.chtml).toContain('data-latex="\\future{y}"');
  });

  it('renders mhchem while gating Physics macros behind the preference', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const enabled = await renderMathDocument({
      documentId: 'extension-document',
      formulas: [
        { display: false, id: 'chemistry', source: '\\ce{H2O + CO2 -> H2CO3}' },
        { display: false, id: 'physics', source: '\\qty{x}' },
      ],
      generation: 1,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'none', physics: true },
    });
    const disabled = await renderMathDocument({
      documentId: 'physics-disabled',
      formulas: [{ display: false, id: 'physics', source: '\\qty{x}' }],
      generation: 1,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'none', physics: false },
    });

    expect(enabled.formulas[0]?.error).toBeUndefined();
    expect(enabled.formulas[0]?.chtml).toContain('data-latex="\\ce{H2O + CO2 -> H2CO3}"');
    expect(enabled.formulas[1]?.error).toBeUndefined();
    expect(enabled.formulas[1]?.chtml).toContain('data-latex="\\qty{x}"');
    expect(disabled.formulas[0]?.chtml).toBeUndefined();
    expect(disabled.formulas[0]?.error).toContain('Undefined control sequence');
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();
  });

  it('renders a tall aligned display formula without TeX errors', async () => {
    const result = await renderMathDocument({
      documentId: 'aligned-document',
      formulas: [
        {
          display: true,
          id: 'aligned',
          source: [
            '\\begin{aligned}',
            '\\frac{1}{\\frac{2}{\\frac{3}{4}}} &= x \\\\',
            '\\sum_{n=1}^{20} \\frac{n^2}{n+1} &= y \\\\',
            '\\int_0^1 \\frac{1}{1+t^2}\\,dt &= z',
            '\\end{aligned}',
          ].join('\n'),
        },
      ],
      generation: 1,
      layoutMetrics: { containerWidth: 640, em: 16, ex: 8 },
      preferences: { numbering: 'none', physics: false },
    });

    expect(result.formulas[0]?.error).toBeUndefined();
    expect(result.formulas[0]?.chtml).toContain('data-latex');
  });

  it('loads rare NewCM glyph data from bundled modules', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await renderMathDocument({
      documentId: 'rare-glyph-document',
      formulas: [{ display: false, id: 'accented', source: '\\text{é}' }],
      generation: 1,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'none', physics: false },
    });

    expect(warning).not.toHaveBeenCalled();
    expect(result.formulas[0]?.error).toBeUndefined();
    expect(result.formulas[0]?.chtml).toContain('é');

    const again = await renderMathDocument({
      documentId: 'rare-glyph-document-again',
      formulas: [{ display: false, id: 'accented', source: '\\text{éé}' }],
      generation: 2,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'none', physics: false },
    });
    expect(again.formulas[0]?.error).toBeUndefined();
    expect(again.formulas[0]?.chtml).toContain('éé');
    expect(warning).not.toHaveBeenCalled();
  });

  it('keeps rare glyphs available across sequential document renders', async () => {
    const layoutMetrics = { containerWidth: 960, em: 16, ex: 8 };
    const preferences = { numbering: 'none' as const, physics: false };
    const first = await renderMathDocument({
      documentId: 'rare-first',
      formulas: [
        { display: false, id: 'accent', source: '\\text{é}' },
        { display: false, id: 'water', source: '\\ce{H2O}' },
      ],
      generation: 1,
      layoutMetrics,
      preferences,
    });
    expect(first.formulas.every((formula) => formula.error === undefined)).toBe(
      true,
    );

    const second = await renderMathDocument({
      documentId: 'rare-second',
      formulas: [
        { display: false, id: 'accent', source: '\\text{éé}' },
        { display: false, id: 'carbon', source: '\\ce{CO2}' },
      ],
      generation: 2,
      layoutMetrics,
      preferences,
    });
    expect(second.formulas.map((formula) => formula.error)).toEqual([
      undefined,
      undefined,
    ]);
    expect(second.formulas[0]?.chtml).toContain('mjx-container');
  });

  it('rejects forbidden TeX loaders and strips every non-fragment URL', async () => {
    const result = await renderMathDocument({
      documentId: 'hostile-document',
      formulas: [
        { display: false, id: 'require', source: '\\require{html}x' },
        { display: false, id: 'autoload', source: '\\autoload{html}x' },
        { display: false, id: 'setoptions', source: '\\setOptions{html}{allow=true}x' },
        { display: false, id: 'html', source: '\\href{https://example.com}{x}' },
      ],
      generation: 1,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'none', physics: false },
    });

    expect(result.formulas.slice(0, 3).every(({ error }) =>
      error?.includes('Undefined control sequence'),
    )).toBe(true);
    expect(result.formulas[3]?.chtml ?? '').not.toMatch(
      /https?:|file:|data:|javascript:/i,
    );
  });

  it('rejects formula batches and sources beyond the worker safety limits', async () => {
    const baseRequest = {
      documentId: 'oversized-document',
      generation: 1,
      layoutMetrics: { containerWidth: 960, em: 16, ex: 8 },
      preferences: { numbering: 'none' as const, physics: false },
    };

    await expect(renderMathDocument({
      ...baseRequest,
      formulas: Array.from({ length: 1_001 }, (_, index) => ({
        display: false,
        id: `formula-${index}`,
        source: 'x',
      })),
    })).rejects.toThrow('exceeds 1000 formulas');
    await expect(renderMathDocument({
      ...baseRequest,
      formulas: [{ display: false, id: 'formula', source: 'x'.repeat(10 * 1024 + 1) }],
    })).rejects.toThrow('exceeds 10240 characters');
  });
});
