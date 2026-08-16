import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { BlockWidgetGeometryCache } from '../blockWidgetGeometry';
import {
  DEFAULT_EDITOR_MATH_PREFERENCES,
  editorMathPreferencesField,
  setEditorMathPreferencesEffect,
} from './mathPreferences';
import {
  indexMathRenderResults,
  mathPreviewExtension,
  shouldRebuildMathDecorations,
} from './mathPreviewExtension';
import type { MathWorkerLike } from './mathRenderSession';
import type {
  MathDocumentRenderResult,
  MathDocumentWorkerRequest,
  MathDocumentWorkerResponse,
} from './mathWorkerProtocol';

class FakeWorker implements MathWorkerLike {
  readonly messages: MathDocumentWorkerRequest[] = [];
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  onmessage: ((event: MessageEvent<MathDocumentWorkerResponse>) => unknown) | null = null;
  onmessageerror: ((event: MessageEvent) => unknown) | null = null;
  readonly terminate = vi.fn();

  postMessage(message: MathDocumentWorkerRequest): void {
    this.messages.push(message);
  }

  respond(result: MathDocumentRenderResult): void {
    this.onmessage?.(new MessageEvent('message', {
      data: { result, type: 'render-result' },
    }));
  }
}

function result(
  request: MathDocumentWorkerRequest,
  formulas: MathDocumentRenderResult['formulas'],
): MathDocumentRenderResult {
  return {
    documentId: request.request.documentId,
    documentLabels: {},
    formulas: formulas.map((formula) => {
      const input = request.request.formulas.find(({ id }) => id === formula.id);
      return {
        ...formula,
        sourceFingerprint: JSON.stringify([input?.display, input?.source]),
      };
    }),
    generation: request.request.generation,
    stylesheet: '.mjx-test { color: currentColor; }',
  };
}

function createView({
  doc,
  mode = 'livePreview',
  selection = doc.length,
}: {
  doc: string;
  mode?: 'livePreview' | 'reading';
  selection?: number;
}) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const worker = new FakeWorker();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownLanguage(),
        mathPreviewExtension({
          createWorker: () => worker,
          debounceMs: 0,
          documentId: 'test-document',
          mode,
        }),
      ],
      selection: EditorSelection.cursor(selection),
    }),
  });

  return { parent, view, worker };
}

async function flushRender(worker: FakeWorker): Promise<MathDocumentWorkerRequest> {
  await vi.advanceTimersByTimeAsync(0);
  const request = worker.messages.at(-1);
  if (!request) {
    throw new Error('Expected math worker request.');
  }
  return request;
}

describe('mathPreviewExtension', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    document.head.querySelectorAll('[data-lm-math-style]').forEach((node) => node.remove());
  });

  it('indexes 1000 formula results with one linear pass', () => {
    let idReads = 0;
    const formulas = Array.from({ length: 1_000 }, (_, index) => {
      const id = `math:inline:${index}`;
      return {
        chtml: `<mjx-container>${index}</mjx-container>`,
        get id() {
          idReads += 1;
          return id;
        },
        labels: [],
      };
    });

    const byId = indexMathRenderResults(formulas);

    expect(byId.size).toBe(1_000);
    expect(byId.get('math:inline:999')?.chtml).toContain('999');
    expect(idReads).toBe(1_000);
  });

  it('keeps decorations when a selection stays in the same formula owner', () => {
    expect(
      shouldRebuildMathDecorations({
        activeChanged: false,
        compositionChanged: false,
        docChanged: false,
        formulaSequenceChanged: false,
        renderChanged: false,
        selectionChanged: true,
      }),
    ).toBe(false);
    expect(
      shouldRebuildMathDecorations({
        activeChanged: true,
        compositionChanged: false,
        docChanged: false,
        formulaSequenceChanged: false,
        renderChanged: false,
        selectionChanged: true,
      }),
    ).toBe(true);
  });

  it('does not rebuild widgets for a selection move within one formula', async () => {
    vi.useFakeTimers();
    const retain = vi.spyOn(BlockWidgetGeometryCache.prototype, 'retain');
    const doc = '$xyz$ tail';
    const { view, worker } = createView({ doc, selection: 2 });
    const request = await flushRender(worker);
    worker.respond(
      result(request, [
        {
          chtml: '<mjx-container><mjx-math>xyz</mjx-math></mjx-container>',
          id: 'math:inline:0',
          labels: [],
        },
      ]),
    );
    await vi.runAllTicks();
    retain.mockClear();

    view.dispatch({ selection: EditorSelection.cursor(3) });

    expect(retain).not.toHaveBeenCalled();
    view.destroy();
  });

  it('stores rendering preferences in an editor-local state field', () => {
    const { view } = createView({ doc: 'plain text' });

    expect(view.state.field(editorMathPreferencesField)).toEqual(
      DEFAULT_EDITOR_MATH_PREFERENCES,
    );
    view.dispatch({
      effects: setEditorMathPreferencesEffect.of({
        equationNumbering: 'ams',
        physicsEnabled: true,
        syntaxMode: 'legacy',
      }),
    });
    expect(view.state.field(editorMathPreferencesField)).toEqual({
      equationNumbering: 'ams',
      physicsEnabled: true,
      syntaxMode: 'legacy',
    });

    view.destroy();
  });

  it('recollects formulas and rebuilds previews when the syntax preference changes', async () => {
    vi.useFakeTimers();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const worker = new FakeWorker();
    const markdownCompartment = new Compartment();
    const doc = 'legacy $ x $9 tail';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownCompartment.of(
            markdownLanguage({ math: { inlineMode: 'pandoc' } }),
          ),
          mathPreviewExtension({
            createWorker: () => worker,
            debounceMs: 0,
            documentId: 'preference-document',
            mode: 'livePreview',
          }),
        ],
        selection: EditorSelection.cursor(doc.length),
      }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.messages).toHaveLength(0);
    expect(parent.querySelector('[role="math"]')).toBeNull();

    view.dispatch({
      effects: [
        markdownCompartment.reconfigure(
          markdownLanguage({ math: { inlineMode: 'legacy' } }),
        ),
        setEditorMathPreferencesEffect.of({
          equationNumbering: 'none',
          physicsEnabled: false,
          syntaxMode: 'legacy',
        }),
      ],
    });
    const request = await flushRender(worker);

    expect(request.request.formulas).toEqual([
      expect.objectContaining({ display: false, source: ' x ' }),
    ]);
    worker.respond(result(request, [
      {
        chtml: '<mjx-container><mjx-math> x </mjx-math></mjx-container>',
        id: 'math:inline:0',
        labels: [],
      },
    ]));
    await vi.runAllTicks();
    expect(parent.querySelector('[role="math"]')).not.toBeNull();
    expect(parent.textContent).not.toContain('$ x $');
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
  });

  it('lazily renders ordered formulas and replaces inactive block and inline source', async () => {
    vi.useFakeTimers();
    const doc = ['$x$', '', '$$', 'y', '$$', '', 'tail'].join('\n');
    const { parent, view, worker } = createView({ doc, selection: doc.length });
    const request = await flushRender(worker);

    expect(request.request.formulas.map(({ display, source }) => ({ display, source }))).toEqual([
      { display: false, source: 'x' },
      { display: true, source: 'y' },
    ]);
    worker.respond(result(request, [
      { chtml: '<mjx-container><mjx-math>x</mjx-math></mjx-container>', id: 'math:inline:0', labels: [] },
      { chtml: '<mjx-container display="true"><mjx-math>y</mjx-math></mjx-container>', id: 'math:block:1', labels: [] },
    ]));
    await vi.runAllTicks();

    const rendered = [...parent.querySelectorAll<HTMLElement>('[role="math"]')];
    expect(rendered).toHaveLength(2);
    expect(rendered.map((node) => node.getAttribute('aria-label'))).toEqual(['x', 'y']);
    expect(parent.textContent).not.toContain('$x$');
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
  });

  it('renders nested quote and list blocks without sending container prefixes to MathJax', async () => {
    vi.useFakeTimers();
    const doc = [
      '> $$',
      '>   x + y',
      '> $$',
      '',
      '- $$',
      '    z + w',
      '  $$',
      '',
      'tail',
    ].join('\n');
    const { parent, view, worker } = createView({ doc, selection: doc.length });
    const request = await flushRender(worker);

    expect(request.request.formulas.map(({ display, source }) => ({ display, source }))).toEqual([
      { display: true, source: '  x + y' },
      { display: true, source: '  z + w' },
    ]);
    worker.respond(result(request, [
      {
        chtml: '<mjx-container display="true"><mjx-math>x+y</mjx-math></mjx-container>',
        id: 'math:block:0',
        labels: [],
      },
      {
        chtml: '<mjx-container display="true"><mjx-math>z+w</mjx-math></mjx-container>',
        id: 'math:block:1',
        labels: [],
      },
    ]));
    await vi.runAllTicks();

    expect(parent.querySelectorAll('.lm-math-block-render')).toHaveLength(2);
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
  });

  it('keeps active live-preview source visible and renders a block preview after it', async () => {
    vi.useFakeTimers();
    const doc = ['$$', 'x + y', '$$', '', 'tail'].join('\n');
    const { parent, view, worker } = createView({
      doc,
      selection: doc.indexOf('x'),
    });
    const request = await flushRender(worker);
    worker.respond(result(request, [
      { chtml: '<mjx-container display="true"><mjx-math>x+y</mjx-math></mjx-container>', id: 'math:block:0', labels: [] },
    ]));
    await vi.runAllTicks();

    expect(parent.textContent).toContain('x + y');
    expect(parent.querySelector('.lm-math-block-render')).not.toBeNull();

    view.dispatch({ selection: EditorSelection.cursor(doc.indexOf('tail')) });
    expect(parent.textContent).not.toContain('x + y');
    expect(parent.querySelector('.lm-math-block-render')).not.toBeNull();

    view.destroy();
  });

  it('reveals an empty closed block when its rendered widget is clicked', async () => {
    vi.useFakeTimers();
    const doc = ['$$', '$$', '', 'tail'].join('\n');
    const { parent, view, worker } = createView({ doc, selection: doc.length });
    const request = await flushRender(worker);
    worker.respond(result(request, [
      {
        chtml: '<mjx-container display="true"><mjx-math></mjx-math></mjx-container>',
        id: 'math:block:0',
        labels: [],
      },
    ]));
    await vi.runAllTicks();

    const widget = parent.querySelector<HTMLElement>('[role="math"]');
    expect(widget).not.toBeNull();
    widget?.click();

    expect(view.state.selection.main.head).toBeGreaterThan(0);
    expect(view.state.selection.main.head).toBeLessThan(doc.indexOf('tail'));
    expect(parent.textContent).toContain('$$');

    view.destroy();
  });

  it('reveals inline source when the caret enters it but reading mode stays rendered', async () => {
    vi.useFakeTimers();
    const doc = '$x$ tail';
    const live = createView({ doc, selection: doc.length });
    const liveRequest = await flushRender(live.worker);
    live.worker.respond(result(liveRequest, [
      { chtml: '<mjx-container><mjx-math>x</mjx-math></mjx-container>', id: 'math:inline:0', labels: [] },
    ]));
    await vi.runAllTicks();
    live.view.dispatch({ selection: EditorSelection.cursor(2) });
    expect(live.parent.textContent).toContain('$x$');
    expect(live.parent.querySelector('[role="math"]')).toBeNull();

    const reading = createView({ doc, mode: 'reading', selection: 2 });
    const readingRequest = await flushRender(reading.worker);
    reading.worker.respond(result(readingRequest, [
      { chtml: '<mjx-container><mjx-math>x</mjx-math></mjx-container>', id: 'math:inline:0', labels: [] },
    ]));
    await vi.runAllTicks();
    expect(reading.parent.textContent).not.toContain('$x$');
    expect(reading.parent.querySelector('[role="math"]')).not.toBeNull();

    live.view.destroy();
    reading.view.destroy();
  });

  it('keeps only the composing formula raw until composition ends', async () => {
    vi.useFakeTimers();
    const doc = '$x$ and $y$ tail';
    const { parent, view, worker } = createView({ doc, selection: doc.length });
    const request = await flushRender(worker);
    worker.respond(result(request, [
      { chtml: '<mjx-container><mjx-math>x</mjx-math></mjx-container>', id: 'math:inline:0', labels: [] },
      { chtml: '<mjx-container><mjx-math>y</mjx-math></mjx-container>', id: 'math:inline:1', labels: [] },
    ]));
    await vi.runAllTicks();

    view.dispatch({ selection: EditorSelection.cursor(2) });
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', {
      bubbles: true,
      data: '中',
    }));
    view.dispatch({ selection: EditorSelection.cursor(doc.length) });

    expect(parent.textContent).toContain('$x$');
    expect(parent.textContent).not.toContain('$y$');
    expect(parent.querySelectorAll('[role="math"]')).toHaveLength(1);

    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: '中',
    }));
    expect(parent.textContent).not.toContain('$x$');
    expect(parent.querySelectorAll('[role="math"]')).toHaveLength(2);

    view.destroy();
  });

  it('keeps source on first render error and preserves a prior preview on later errors', async () => {
    vi.useFakeTimers();
    const first = createView({ doc: '$broken$ tail' });
    const firstRequest = await flushRender(first.worker);
    first.worker.respond(result(firstRequest, [
      { error: 'Undefined control sequence', id: 'math:inline:0', labels: [] },
    ]));
    await vi.runAllTicks();
    expect(first.parent.textContent).toContain('$broken$');
    expect(first.parent.textContent).toContain('Undefined control sequence');

    const recovered = createView({ doc: '$x$ tail' });
    const successRequest = await flushRender(recovered.worker);
    recovered.worker.respond(result(successRequest, [
      { chtml: '<mjx-container><mjx-math>x</mjx-math></mjx-container>', id: 'math:inline:0', labels: [] },
    ]));
    await vi.runAllTicks();
    const sourceFrom = recovered.view.state.doc.toString().indexOf('x');
    recovered.view.dispatch({ changes: { from: sourceFrom, to: sourceFrom + 1, insert: 'broken' } });
    const errorRequest = await flushRender(recovered.worker);
    recovered.worker.respond(result(errorRequest, [
      { error: 'Undefined control sequence', id: 'math:inline:0', labels: [] },
    ]));
    await vi.runAllTicks();
    expect(recovered.parent.querySelector('[role="math"]')?.textContent).toContain('x');
    expect(recovered.parent.textContent).toContain('Undefined control sequence');

    first.view.destroy();
    recovered.view.destroy();
  });

  it('retains the last successful CHTML stylesheet through worker failure and removes it on destroy', async () => {
    vi.useFakeTimers();
    const { view, worker } = createView({ doc: '$x$ tail' });
    const successRequest = await flushRender(worker);
    worker.respond({
      ...result(successRequest, [
        {
          chtml: '<mjx-container><mjx-math>x</mjx-math></mjx-container>',
          id: 'math:inline:0',
          labels: [],
        },
      ]),
      stylesheet: '.last-success { color: currentColor; }',
    });
    await vi.runAllTicks();

    const style = document.head.querySelector<HTMLStyleElement>(
      '[data-lm-math-style="test-document"]',
    );
    expect(style?.textContent).toBe('.last-success { color: currentColor; }');

    view.dispatch({ changes: { from: 1, to: 2, insert: 'y' } });
    await flushRender(worker);
    worker.onerror?.(
      new ErrorEvent('error', { message: 'Math rendering worker failed.' }),
    );
    await vi.runAllTicks();

    expect(style?.textContent).toBe('.last-success { color: currentColor; }');

    view.destroy();
    expect(document.head.contains(style)).toBe(false);
  });

  it('does not mount executable markup returned across the render boundary', async () => {
    vi.useFakeTimers();
    const { parent, view, worker } = createView({ doc: '$x$ tail' });
    const request = await flushRender(worker);
    worker.respond(result(request, [
      {
        chtml: [
          '<mjx-container>',
          '<script>globalThis.pwned=true</script>',
          '<mjx-math>',
          '<a id="app-shell" href="#app-shell">unsafe</a>',
          '<a id="lm-math-test-mjx-eqn:1" href="#lm-math-test-mjx-eqn%3A1">safe</a>',
          'x',
          '</mjx-math>',
          '</mjx-container>',
        ].join(''),
        id: 'math:inline:0',
        labels: [],
      },
    ]));
    await vi.runAllTicks();

    expect(parent.querySelector('script')).toBeNull();
    expect(parent.querySelector('[href="#app-shell"]')).toBeNull();
    expect(parent.querySelector('#app-shell')).toBeNull();
    expect(
      parent.querySelector('[href="#lm-math-test-mjx-eqn%3A1"]'),
    ).not.toBeNull();
    expect(parent.querySelector('mjx-math')?.textContent).toBe('unsafesafex');

    view.destroy();
  });

  it('preserves MathJax layout classes while dropping active markup attributes', async () => {
    vi.useFakeTimers();
    const { parent, view, worker } = createView({ doc: '$x$ tail' });
    const request = await flushRender(worker);
    const rendered = result(request, [
      {
        chtml: [
          '<mjx-container class="MathJax lm-app-shell" ',
          'style="position:relative;width:1em">',
          '<base href="https://example.com/">',
          '<mjx-math class="NCM-N NCM-B-a">',
          '<mjx-box style="position:absolute;transform:translateX(1em) skewX(0.2rad)">',
          '<a xlink:href="#app-shell" ping="https://evil.example">x</a>',
          '</mjx-box>',
          '</mjx-math>',
          '</mjx-container>',
        ].join(''),
        id: 'math:inline:0',
        labels: [],
      },
    ]);
    worker.respond(rendered);
    await vi.runAllTicks();

    const widget = parent.querySelector<HTMLElement>('[role="math"]');
    const container = widget?.querySelector<HTMLElement>('mjx-container');
    expect(container?.classList.contains('lm-app-shell')).toBe(false);
    expect(container?.querySelector('mjx-math')?.classList.contains('NCM-N')).toBe(true);
    expect(container?.querySelector('mjx-math')?.classList.contains('NCM-B-a')).toBe(true);
    expect(container?.style.position).toBe('relative');
    expect(container?.style.zIndex).toBe('');
    const box = container?.querySelector<HTMLElement>('mjx-box');
    expect(box?.style.position).toBe('absolute');
    expect(box?.style.transform).toContain('skewX');
    expect(container?.querySelector('base')).toBeNull();
    expect(container?.querySelector('[xlink\\:href]')).toBeNull();
    expect(container?.querySelector('[ping]')).toBeNull();

    view.destroy();
  });

  it('retains measured block geometry with the same key used by the widget', async () => {
    vi.useFakeTimers();
    const retain = vi.spyOn(BlockWidgetGeometryCache.prototype, 'retain');
    const doc = ['$$', 'x + y', '$$', '', 'tail'].join('\n');
    const { view, worker } = createView({ doc, selection: doc.length });
    const request = await flushRender(worker);
    retain.mockClear();
    worker.respond(result(request, [
      {
        chtml: '<mjx-container display="true"><mjx-math>x+y</mjx-math></mjx-container>',
        id: 'math:block:0',
        labels: [],
      },
    ]));
    await vi.runAllTicks();

    const retainedKeys = [...(retain.mock.calls.at(-1)?.[0] ?? [])];
    expect(retainedKeys).toHaveLength(1);
    expect(retainedKeys[0]).toMatch(/^math:/u);
    expect(retainedKeys[0]).not.toBe('math:block:0');

    view.destroy();
  });

  it('does not let an error generation sparse stylesheet replace a successful CHTML font face set', async () => {
    vi.useFakeTimers();
    const doc = ['$$', '\\mathcal{B}', '$$'].join('\n');
    const { view, worker } = createView({ doc, selection: 0 });
    const successRequest = await flushRender(worker);
    const rareStylesheet =
      '@font-face{font-family:MJXZERO;src:url("mjx-ncm-b.woff2")}mjx-container{display:inline-block}';
    worker.respond({
      ...result(successRequest, [
        {
          chtml: '<mjx-container jax="CHTML" class="NCM-B-a">B</mjx-container>',
          id: 'math:block:0',
          labels: [],
        },
      ]),
      stylesheet: rareStylesheet,
    });
    await vi.runAllTicks();

    const style = document.head.querySelector('[data-lm-math-style="test-document"]');
    expect(style?.textContent).toBe(rareStylesheet);

    view.dispatch({
      changes: {
        from: 0,
        insert: ['$$', '\\bad', '$$'].join('\n'),
        to: view.state.doc.length,
      },
    });
    const errorRequest = await flushRender(worker);
    worker.respond({
      ...result(errorRequest, [
        {
          error: 'TeX parse error',
          id: 'math:block:0',
          labels: [],
        },
      ]),
      stylesheet: 'mjx-container{display:inline-block}',
    });
    await vi.runAllTicks();

    expect(style?.textContent).toBe(rareStylesheet);
    expect(style?.textContent).toContain('mjx-ncm-b.woff2');

    view.destroy();
  });
});
