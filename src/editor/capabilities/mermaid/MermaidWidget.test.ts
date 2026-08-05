import { history, undo, undoDepth } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { type DecorationSet, EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../shared/i18n';
import { createEditorApi } from '../../core/editorApi';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import type { EditorMediaPreviewRequestHandler } from '../../core/editorEvents';
import { MermaidBlockWidget } from './MermaidBlockWidget';
import { MermaidRenderScheduler } from './mermaidRenderScheduler';
import {
  collectMermaidBlocksInRanges,
  mermaidPreviewExtension,
} from './mermaidPreviewExtension';

const collectMermaidBlocksSpy = vi.hoisted(() => vi.fn());

vi.mock('./mermaidBlockDetection', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('./mermaidBlockDetection')
  >();

  return {
    ...actual,
    collectMermaidBlocksInRanges: (
      ...args: Parameters<typeof actual.collectMermaidBlocksInRanges>
    ) => {
      collectMermaidBlocksSpy(...args);
      return actual.collectMermaidBlocksInRanges(...args);
    },
  };
});

function createView(
  doc: string,
  scheduler: MermaidRenderScheduler,
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler,
) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownLanguage(),
        history(),
        mermaidPreviewExtension({ onMediaPreviewRequest, scheduler }),
      ],
      selection: EditorSelection.cursor(doc.length),
    }),
  });

  return { parent, view };
}

function mermaidDecorationSet(view: EditorView): DecorationSet {
  for (const source of view.state.facet(EditorView.decorations)) {
    const decorations = typeof source === 'function' ? source(view) : source;
    let includesMermaidWidget = false;

    decorations.between(0, view.state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof MermaidBlockWidget) {
        includesMermaidWidget = true;
      }
    });

    if (includesMermaidWidget) {
      return decorations;
    }
  }

  throw new Error('Expected a Mermaid decoration set.');
}

function mermaidWidgets(view: EditorView): MermaidBlockWidget[] {
  const widgets: MermaidBlockWidget[] = [];

  mermaidDecorationSet(view).between(
    0,
    view.state.doc.length,
    (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof MermaidBlockWidget) {
        widgets.push(decoration.spec.widget);
      }
    },
  );

  return widgets;
}

describe('mermaidPreviewExtension', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('collects only mermaid blocks that intersect requested ranges', () => {
    const doc = [
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      'text',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  A->>B: hello',
      '```',
    ].join('\n');
    const secondBlockStart = doc.lastIndexOf('```mermaid');
    const state = EditorState.create({
      doc,
      extensions: [markdownLanguage()],
    });

    const blocks = collectMermaidBlocksInRanges(state, [
      {
        from: secondBlockStart,
        to: doc.length,
      },
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toContain('sequenceDiagram');
  });

  it('collects mermaid blocks with uppercase and metadata info strings', () => {
    const doc = [
      '```MERMAID',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      '```mermaid {theme: "neutral"}',
      'sequenceDiagram',
      '  A->>B: hello',
      '```',
      '',
      '```typescript',
      'const mermaid = false;',
      '```',
    ].join('\n');
    const state = EditorState.create({
      doc,
      extensions: [markdownLanguage()],
    });

    const blocks = collectMermaidBlocksInRanges(state, [
      {
        from: 0,
        to: doc.length,
      },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.info)).toEqual([
      'MERMAID',
      'mermaid {theme: "neutral"}',
    ]);
  });

  it('does not recollect or recreate mermaid widgets for a selection-only transaction', () => {
    const doc = ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join(
      '\n',
    );
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler, vi.fn());
    const initialDecorations = mermaidDecorationSet(view);
    const initialWidget = mermaidWidgets(view)[0];
    collectMermaidBlocksSpy.mockClear();

    view.dispatch({ selection: EditorSelection.cursor(0) });

    expect(collectMermaidBlocksSpy).not.toHaveBeenCalled();
    expect(mermaidDecorationSet(view)).toBe(initialDecorations);
    expect(mermaidWidgets(view)[0]).toBe(initialWidget);

    view.destroy();
    parent.remove();
  });

  it('maps existing widgets without recollecting after a non-mermaid edit at the document end', () => {
    const tail = Array.from({ length: 2_000 }, (_, index) => `plain ${index}`).join(
      '\n',
    );
    const doc = [
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      tail,
    ].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);
    const initialWidget = mermaidWidgets(view)[0];
    collectMermaidBlocksSpy.mockClear();

    view.dispatch({ changes: { from: doc.length, insert: '!' } });

    expect(collectMermaidBlocksSpy).toHaveBeenCalledTimes(1);
    expect(collectMermaidBlocksSpy.mock.calls[0][1]).toEqual([
      { from: doc.length, to: doc.length + 1 },
    ]);
    expect(mermaidWidgets(view)[0]).toBe(initialWidget);

    view.destroy();
    parent.remove();
  });

  it('creates a preview when a non-mermaid fence is edited into mermaid', () => {
    const doc = ['```text', 'flowchart TD', '  A --> B', '```'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);

    expect(parent.querySelector('.lm-mermaid-preview')).toBeNull();

    view.dispatch({
      changes: {
        from: doc.indexOf('text'),
        insert: 'mermaid',
        to: doc.indexOf('text') + 'text'.length,
      },
    });

    expect(parent.querySelector('.lm-mermaid-preview')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('keeps widget actions aligned after text is inserted before a mermaid block', () => {
    const doc = [
      'before',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      'after',
    ].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);

    view.dispatch({ changes: { from: 0, insert: 'new\n' } });
    parent.querySelector<HTMLButtonElement>('.lm-mermaid-delete')?.click();

    expect(view.state.doc.toString()).toBe(['new', 'before', 'after'].join('\n'));

    view.destroy();
    parent.remove();
  });

  it('removes a preview when an earlier closing fence is edited open', () => {
    const doc = [
      '```md',
      'code',
      '```',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
    ].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);
    const closingFenceFrom = doc.indexOf('```', '```md'.length);

    expect(parent.querySelector('.lm-mermaid-preview')).not.toBeNull();

    view.dispatch({
      changes: {
        from: closingFenceFrom,
        insert: 'abc',
        to: closingFenceFrom + 3,
      },
    });

    expect(parent.querySelector('.lm-mermaid-preview')).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('creates a preview when an earlier edit closes the surrounding fence', () => {
    const doc = [
      '```md',
      'code',
      'abc',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
    ].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);
    const closingFenceFrom = doc.indexOf('abc');

    expect(parent.querySelector('.lm-mermaid-preview')).toBeNull();

    view.dispatch({
      changes: {
        from: closingFenceFrom,
        insert: '```',
        to: closingFenceFrom + 3,
      },
    });

    expect(parent.querySelector('.lm-mermaid-preview')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('renders a mermaid preview widget without changing source text', async () => {
    vi.useFakeTimers();
    const doc = [
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      'after',
    ].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg role="img"></svg>'),
    });

    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();

    expect(view.state.doc.toString()).toBe(doc);
    expect(parent.querySelector('.lm-mermaid-preview')).not.toBeNull();
    expect(parent.querySelector('.lm-mermaid-svg')?.innerHTML).toContain(
      '<svg role="img"></svg>',
    );

    view.destroy();
    parent.remove();
  });

  it('opens the existing successful SVG without rerendering or changing editor state', async () => {
    vi.useFakeTimers();
    const svg = '<svg data-render="exact"><title>Flow</title></svg>';
    const doc = ['```mermaid', 'flowchart TD', '```', '', 'after'].join('\n');
    const render = vi.fn().mockResolvedValue(svg);
    const scheduler = new MermaidRenderScheduler({ debounceMs: 0, render });
    const onMediaPreviewRequest = vi.fn();
    const { parent, view } = createView(
      doc,
      scheduler,
      onMediaPreviewRequest,
    );
    const selectionBefore = view.state.selection;
    const historyBefore = undoDepth(view.state);

    expect(parent.querySelector('.lm-media-preview-expand:not([hidden])')).toBeNull();
    await vi.runAllTimersAsync();
    const expand = parent.querySelector<HTMLButtonElement>(
      '.lm-media-preview-expand:not([hidden])',
    );
    expect(expand).not.toBeNull();
    expand?.click();

    expect(onMediaPreviewRequest).toHaveBeenCalledWith({
      kind: 'mermaid',
      svg,
    });
    expect(render).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.eq(selectionBefore)).toBe(true);
    expect(undoDepth(view.state)).toBe(historyBefore);

    view.destroy();
    parent.remove();
  });

  it('relabels an existing Mermaid expand action without rerendering or changing editor state', async () => {
    vi.useFakeTimers();
    await i18n.changeLanguage('zh-CN');
    const eqSpy = vi.spyOn(MermaidBlockWidget.prototype, 'eq');
    const toDOMSpy = vi.spyOn(MermaidBlockWidget.prototype, 'toDOM');
    const svg = '<svg data-render="exact"><title>Flow</title></svg>';
    const doc = ['```mermaid', 'flowchart TD', '```', '', 'after'].join('\n');
    const render = vi.fn().mockResolvedValue(svg);
    const scheduler = new MermaidRenderScheduler({ debounceMs: 0, render });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      displayMode: 'source',
      doc,
      extensions: [
        mermaidPreviewExtension({
          onMediaPreviewRequest: vi.fn(),
          scheduler,
        }),
      ],
      language: 'zh-CN',
      parent,
    });
    editor.view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('after')),
    });
    await vi.runAllTimersAsync();
    const expand = parent.querySelector<HTMLButtonElement>(
      '.lm-media-preview-expand:not([hidden])',
    );
    const selectionBefore = editor.view.state.selection;
    const historyBefore = undoDepth(editor.view.state);
    const widgetCallsBeforeLanguageChange = {
      eq: eqSpy.mock.calls.length,
      toDOM: toDOMSpy.mock.calls.length,
    };

    expect(expand?.getAttribute('aria-label')).toBe('展开查看');
    expect(expand?.getAttribute('title')).toBe('展开查看');

    editor.setLanguage('en');

    expect({
      eq: eqSpy.mock.calls.length,
      toDOM: toDOMSpy.mock.calls.length,
    }).toEqual(widgetCallsBeforeLanguageChange);
    expect(expand?.getAttribute('aria-label')).toBe('Expand preview');
    expect(expand?.getAttribute('title')).toBe('Expand preview');
    expect(expand?.isConnected).toBe(true);
    expect(
      parent.querySelector<HTMLButtonElement>('[data-lm-media-preview-button]'),
    ).toBe(expand);
    expect(editor.view.state.doc.toString()).toBe(doc);
    expect(editor.view.state.selection.eq(selectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    expect(render).toHaveBeenCalledTimes(1);

    editor.destroy();
    parent.remove();
  });

  it('uses the initial editor language for Mermaid labels when global i18n differs', async () => {
    vi.useFakeTimers();
    await i18n.changeLanguage('zh-CN');
    const render = vi
      .fn()
      .mockResolvedValue('<svg data-render="exact"><title>Flow</title></svg>');
    const scheduler = new MermaidRenderScheduler({ debounceMs: 0, render });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['```mermaid', 'flowchart TD', '```', '', 'after'].join('\n');
    const editor = createEditorApi({
      displayMode: 'source',
      doc,
      extensions: [
        mermaidPreviewExtension({
          onMediaPreviewRequest: vi.fn(),
          scheduler,
        }),
      ],
      language: 'en',
      parent,
    });
    editor.view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('after')),
    });

    await vi.runAllTimersAsync();
    const expand = parent.querySelector<HTMLButtonElement>(
      '.lm-media-preview-expand:not([hidden])',
    );

    expect(expand?.getAttribute('aria-label')).toBe('Expand preview');
    expect(expand?.getAttribute('title')).toBe('Expand preview');
    expect(render).toHaveBeenCalledTimes(1);

    editor.destroy();
    parent.remove();
  });

  it('keeps mermaid preview visible when the editor cursor is inside the block', () => {
    const doc = ['```mermaid', 'flowchart TD', '  A --> B', '```'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), mermaidPreviewExtension({ scheduler })],
        selection: EditorSelection.cursor(doc.indexOf('flowchart')),
      }),
    });

    expect(parent.querySelector('.lm-mermaid-preview')).not.toBeNull();
    expect(parent.textContent).not.toContain('flowchart TD');

    view.destroy();
    parent.remove();
  });

  it('keeps mermaid preview visible when the editor selection overlaps the block', () => {
    const doc = [
      'before',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      'after',
    ].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), mermaidPreviewExtension({ scheduler })],
        selection: EditorSelection.range(0, doc.indexOf('after')),
      }),
    });

    expect(parent.querySelector('.lm-mermaid-preview')).not.toBeNull();
    expect(parent.textContent).not.toContain('flowchart TD');

    view.destroy();
    parent.remove();
  });

  it('cancels rendering when the preview widget is destroyed', () => {
    const doc = [
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      'after',
    ].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const cancel = vi.fn();
    vi.spyOn(scheduler, 'request').mockReturnValue({ cancel });
    const { parent, view } = createView(doc, scheduler);

    view.destroy();

    expect(cancel).toHaveBeenCalledTimes(1);

    parent.remove();
  });

  it('shows a localized error state when rendering fails', async () => {
    vi.useFakeTimers();
    const doc = ['```mermaid', 'broken', '```', '', 'after'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockRejectedValue(new Error('bad syntax')),
    });

    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();

    expect(parent.querySelector('.lm-mermaid-error')?.textContent).toContain(
      'Mermaid 渲染失败',
    );
    expect(parent.querySelector('.lm-mermaid-edit-source')).not.toBeNull();
    expect(parent.querySelector('.lm-mermaid-editor')).toBeNull();
    expect(parent.querySelector('.lm-media-preview-expand:not([hidden])')).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('keeps a failed mermaid block isolated from a successful block', async () => {
    vi.useFakeTimers();
    const doc = [
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      '```mermaid',
      'broken',
      '```',
      '',
      'after',
    ].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn(async ({ source }) => {
        if (source.includes('broken')) {
          throw new Error('bad syntax');
        }

        return '<svg role="img"></svg>';
      }),
    });

    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();

    expect(parent.querySelectorAll('.lm-mermaid-preview[data-status="success"]')).toHaveLength(1);
    expect(parent.querySelectorAll('.lm-mermaid-preview[data-status="error"]')).toHaveLength(1);
    expect(parent.querySelector('.lm-mermaid-edit-source')).not.toBeNull();
    expect(parent.querySelector('.lm-mermaid-editor')).toBeNull();
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
    parent.remove();
  });

  it('uses compact icon actions with accessible labels instead of visible text', async () => {
    vi.useFakeTimers();
    const doc = ['```mermaid', 'flowchart TD', '  A --> B', '```'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });

    const { parent, view } = createView(doc, scheduler, vi.fn());
    await vi.runAllTimersAsync();

    const editButton = parent.querySelector<HTMLButtonElement>(
      '.lm-mermaid-edit-source',
    );
    const deleteButton = parent.querySelector<HTMLButtonElement>(
      '.lm-mermaid-delete',
    );
    const expandButton = parent.querySelector<HTMLButtonElement>(
      '.lm-media-preview-expand',
    );

    expect(expandButton?.getAttribute('aria-label')).toBe('展开查看');
    expect(editButton?.getAttribute('aria-label')).toBe('编辑源码');
    expect(deleteButton?.getAttribute('aria-label')).toBe('删除');
    expect(editButton?.textContent?.trim()).toBe('');
    expect(deleteButton?.textContent?.trim()).toBe('');
    expect(expandButton?.textContent?.trim()).toBe('');
    expect(editButton?.querySelector('svg')).not.toBeNull();
    expect(deleteButton?.querySelector('svg')).not.toBeNull();
    expect(expandButton?.querySelector('svg')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('reveals the fenced source in the main editor when edit is requested', async () => {
    vi.useFakeTimers();
    const doc = ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n');
    const contentFrom = doc.indexOf('flowchart TD');
    const contentTo = doc.indexOf('\n```', contentFrom);
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();

    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();

    expect(parent.querySelector('.lm-mermaid-editor')).toBeNull();
    expect(view.contentDOM.textContent).toContain('flowchart TD');
    expect(view.state.selection.main.from).toBe(contentFrom);
    expect(view.state.selection.main.to).toBe(contentTo);

    view.destroy();
    parent.remove();
  });

  it('moves source editing from one mermaid block to another', async () => {
    vi.useFakeTimers();
    const doc = [
      '```mermaid',
      'flowchart TD',
      '```',
      '',
      '```mermaid',
      'sequenceDiagram',
      '```',
    ].join('\n');
    const secondContentFrom = doc.indexOf('sequenceDiagram');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();

    parent
      .querySelectorAll<HTMLButtonElement>('.lm-mermaid-edit-source')[0]
      ?.click();
    parent
      .querySelectorAll<HTMLButtonElement>('.lm-mermaid-edit-source')[1]
      ?.click();

    expect(view.state.selection.main.from).toBe(secondContentFrom);
    expect(view.contentDOM.textContent).toContain('sequenceDiagram');
    expect(view.contentDOM.textContent).not.toContain('flowchart TD');
    expect(parent.querySelectorAll('.lm-mermaid-preview-editing')).toHaveLength(
      1,
    );

    view.destroy();
    parent.remove();
  });

  it('writes each source edit directly into the main document and one undo restores it', async () => {
    vi.useFakeTimers();
    const doc = ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n');
    const replacement = ['flowchart TD', '  A --> C'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();

    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();
    view.dispatch({
      ...view.state.replaceSelection(replacement),
      userEvent: 'input.mermaid',
    });

    expect(view.state.doc.toString()).toContain('A --> C');
    expect(view.state.doc.toString()).not.toContain('A --> B');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
    parent.remove();
  });

  it('does not replay stale mermaid coordinates after the document is replaced', async () => {
    vi.useFakeTimers();
    const doc = ['before', '```mermaid', 'flowchart TD', '```', 'after'].join('\n');
    const replacementDocument = ['# Other document', '', 'untouched'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();

    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();
    expect(parent.querySelector('.lm-mermaid-editor')).toBeNull();
    view.dispatch({
      ...view.state.replaceSelection('flowchart TD\n  A --> C'),
      userEvent: 'input.mermaid',
    });
    view.dispatch({
      changes: {
        from: 0,
        insert: replacementDocument,
        to: view.state.doc.length,
      },
    });
    await vi.runAllTimersAsync();

    expect(view.state.doc.toString()).toBe(replacementDocument);

    view.destroy();
    parent.remove();
  });

  it('places the live preview after the main-editor source while editing', async () => {
    vi.useFakeTimers();
    const doc = ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();

    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();

    const closingFence = [...view.contentDOM.querySelectorAll('.cm-line')]
      .find((line) => line.textContent === '```');
    const preview = parent.querySelector('.lm-mermaid-preview');
    expect(closingFence).toBeDefined();
    expect(preview).not.toBeNull();
    expect(
      closingFence && preview
        ? closingFence.compareDocumentPosition(preview) &
            Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).not.toBe(0);

    view.destroy();
    parent.remove();
  });

  it('keeps failed source editable in the main editor', async () => {
    vi.useFakeTimers();
    const doc = ['```mermaid', 'broken', '```', '', 'after'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockRejectedValue(new Error('bad syntax')),
    });
    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();

    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();
    await vi.runAllTimersAsync();

    expect(view.contentDOM.textContent).toContain('broken');
    expect(view.state.selection.main.from).toBe(doc.indexOf('broken'));
    expect(view.state.selection.main.to).toBe(
      doc.indexOf('broken') + 'broken'.length,
    );
    expect(parent.querySelector('.lm-mermaid-preview[data-status="error"]'))
      .not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('rebuilds when an equal-length HTML block boundary hides or reveals a following mermaid fence', () => {
    const mermaid = ['```mermaid', 'flowchart TD', '```'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const visibleDoc = ['plain', mermaid].join('\n');
    const visible = createView(visibleDoc, scheduler);

    expect(visible.parent.querySelector('.lm-mermaid-preview')).not.toBeNull();
    visible.view.dispatch({
      changes: { from: 0, insert: '<div>', to: 'plain'.length },
    });
    expect(visible.parent.querySelector('.lm-mermaid-preview')).toBeNull();
    visible.view.destroy();
    visible.parent.remove();

    const hiddenDoc = ['<div>', mermaid].join('\n');
    const hidden = createView(hiddenDoc, scheduler);
    expect(hidden.parent.querySelector('.lm-mermaid-preview')).toBeNull();
    hidden.view.dispatch({
      changes: { from: 0, insert: 'plain', to: '<div>'.length },
    });
    expect(hidden.parent.querySelector('.lm-mermaid-preview')).not.toBeNull();
    hidden.view.destroy();
    hidden.parent.remove();
  });

  it('rebuilds when an equal-length HTML block kind changes its parsing span', () => {
    const mermaid = ['```mermaid', 'flowchart TD', '```'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const visibleDoc = ['<pre>', '</pre>', mermaid].join('\n');
    const visible = createView(visibleDoc, scheduler);

    expect(visible.parent.querySelector('.lm-mermaid-preview')).not.toBeNull();
    visible.view.dispatch({
      changes: { from: 0, insert: '<div>', to: '<pre>'.length },
    });
    expect(visible.parent.querySelector('.lm-mermaid-preview')).toBeNull();
    visible.view.destroy();
    visible.parent.remove();

    const hiddenDoc = ['<div>', '</pre>', mermaid].join('\n');
    const hidden = createView(hiddenDoc, scheduler);
    expect(hidden.parent.querySelector('.lm-mermaid-preview')).toBeNull();
    hidden.view.dispatch({
      changes: { from: 0, insert: '<pre>', to: '<div>'.length },
    });
    expect(hidden.parent.querySelector('.lm-mermaid-preview')).not.toBeNull();
    hidden.view.destroy();
    hidden.parent.remove();
  });

  it('rebuilds when a blockquote fence changes the span containing a mermaid fence', () => {
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const visibleDoc = [
      '> ````md',
      '> code',
      '> ````',
      '> ```mermaid',
      '> flowchart TD',
      '> ```',
    ].join('\n');
    const visibleClosingFence = visibleDoc.indexOf(
      '> ````',
      '> ````md'.length,
    );
    const visible = createView(visibleDoc, scheduler);

    expect(visible.parent.querySelector('.lm-mermaid-preview')).not.toBeNull();
    visible.view.dispatch({
      changes: {
        from: visibleClosingFence + 2,
        insert: 'xxxx',
        to: visibleClosingFence + 6,
      },
    });
    expect(visible.parent.querySelector('.lm-mermaid-preview')).toBeNull();
    visible.view.destroy();
    visible.parent.remove();

    const hiddenDoc = [
      '> ````md',
      '> code',
      '> xxxx',
      '> ```mermaid',
      '> flowchart TD',
      '> ```',
    ].join('\n');
    const hiddenClosingFence = hiddenDoc.indexOf('> xxxx');
    const hidden = createView(hiddenDoc, scheduler);
    expect(hidden.parent.querySelector('.lm-mermaid-preview')).toBeNull();
    hidden.view.dispatch({
      changes: {
        from: hiddenClosingFence + 2,
        insert: '````',
        to: hiddenClosingFence + 6,
      },
    });
    expect(hidden.parent.querySelector('.lm-mermaid-preview')).not.toBeNull();
    hidden.view.destroy();
    hidden.parent.remove();
  });

  it('maps a block after ordinary preceding input without rescanning or rerendering it', async () => {
    vi.useFakeTimers();
    const doc = ['before', '', '```mermaid', 'flowchart TD', '```', '', 'after'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const requestSpy = vi.spyOn(scheduler, 'request');
    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();
    const initialWidget = mermaidWidgets(view)[0];
    requestSpy.mockClear();
    collectMermaidBlocksSpy.mockClear();

    view.dispatch({
      changes: { from: 'before'.length, insert: '!' },
      userEvent: 'input.type',
    });
    await vi.runAllTimersAsync();

    expect(collectMermaidBlocksSpy).toHaveBeenCalledTimes(1);
    expect(collectMermaidBlocksSpy.mock.calls[0][1]).toEqual([
      { from: 'before'.length, to: 'before'.length + 1 },
    ]);
    expect(mermaidWidgets(view)[0]).toBe(initialWidget);
    expect(requestSpy).not.toHaveBeenCalled();

    view.destroy();
    parent.remove();
  });

  it('updates the live preview from source already stored in the main document', async () => {
    vi.useFakeTimers();
    const doc = ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n');
    const render = vi.fn().mockResolvedValue('<svg></svg>');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render,
    });

    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();
    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();
    view.dispatch({
      ...view.state.replaceSelection('flowchart TD\n  A --> C'),
      userEvent: 'input.mermaid',
    });

    expect(view.state.doc.toString()).toContain('A --> C');
    await vi.runAllTimersAsync();

    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'flowchart TD\n  A --> C' }),
    );
    expect(parent.querySelector('.lm-mermaid-preview[data-status="success"]'))
      .not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('rebuilds only the active Mermaid block while its source changes', () => {
    const doc = [
      '# Before',
      '',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      'ordinary text',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  A->>B: hello',
      '```',
      '',
      '# After',
    ].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);

    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();
    const inactiveWidget = mermaidWidgets(view)[1];
    collectMermaidBlocksSpy.mockClear();

    view.dispatch({
      ...view.state.replaceSelection('flowchart TD\n  A --> C'),
      userEvent: 'input.mermaid',
    });

    const scannedRanges = collectMermaidBlocksSpy.mock.calls.flatMap(
      (call) => call[1],
    );
    expect(scannedRanges.length).toBeGreaterThan(0);
    expect(scannedRanges).not.toContainEqual({
      from: 0,
      to: view.state.doc.length,
    });
    expect(mermaidWidgets(view)[1]).toBe(inactiveWidget);

    view.destroy();
    parent.remove();
  });

  it('rebuilds all Mermaid blocks when one transaction changes active and inactive sources', () => {
    const doc = [
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  A->>B: hello',
      '```',
    ].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const { parent, view } = createView(doc, scheduler);

    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();
    const inactiveWidget = mermaidWidgets(view)[1];
    const activeInsertPosition = view.state.selection.main.to;
    const inactiveInsertPosition = view.state.doc
      .toString()
      .indexOf('hello') + 'hello'.length;
    collectMermaidBlocksSpy.mockClear();

    view.dispatch({
      changes: [
        { from: activeInsertPosition, insert: '\n  B --> C' },
        { from: inactiveInsertPosition, insert: ' world' },
      ],
      userEvent: 'input.mermaid',
    });

    const scannedRanges = collectMermaidBlocksSpy.mock.calls.flatMap(
      (call) => call[1],
    );
    expect(scannedRanges).toContainEqual({
      from: 0,
      to: view.state.doc.length,
    });
    expect(mermaidWidgets(view)[1]).not.toBe(inactiveWidget);

    view.destroy();
    parent.remove();
  });

  it('keeps main-editor source active while validating an invalid edit', async () => {
    vi.useFakeTimers();
    const doc = ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn(async ({ source }) => {
        if (source.includes('not valid')) {
          throw new Error('bad syntax');
        }

        return '<svg></svg>';
      }),
    });

    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();
    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();
    view.dispatch({
      ...view.state.replaceSelection('not valid mermaid'),
      userEvent: 'input.mermaid',
    });
    await vi.runAllTimersAsync();

    expect(parent.querySelector('.lm-mermaid-editor')).toBeNull();
    expect(parent.querySelector('.lm-mermaid-preview-editing')).not.toBeNull();
    expect(view.contentDOM.textContent).toContain('not valid mermaid');
    expect(view.state.doc.toString()).toContain('not valid mermaid');
    expect(parent.querySelector('.lm-mermaid-error')?.textContent).toContain(
      'Mermaid 渲染失败',
    );

    view.destroy();
    parent.remove();
  });

  it('returns to preview-only mode when the main selection leaves the block', async () => {
    vi.useFakeTimers();
    const doc = ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });

    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();
    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();
    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('after')),
    });

    expect(parent.querySelector('.lm-mermaid-preview-editing')).toBeNull();
    expect(view.contentDOM.textContent).not.toContain('flowchart TD');
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
    parent.remove();
  });

  it('returns to preview-only mode when Escape is pressed', async () => {
    vi.useFakeTimers();
    const doc = ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });

    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();
    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Escape',
      }),
    );

    expect(parent.querySelector('.lm-mermaid-preview-editing')).toBeNull();
    expect(view.contentDOM.textContent).not.toContain('flowchart TD');
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
    parent.remove();
  });

  it('maps the active source and selection through ordinary input before the block', async () => {
    vi.useFakeTimers();
    const doc = ['before', '', '```mermaid', 'flowchart TD', '```', '', 'after'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });

    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();
    parent
      .querySelector<HTMLButtonElement>('.lm-mermaid-edit-source')
      ?.click();
    const selectionBefore = view.state.selection.main;

    view.dispatch({
      changes: { from: 'before'.length, insert: '!' },
      userEvent: 'input.type',
    });

    expect(parent.querySelector('.lm-mermaid-preview-editing')).not.toBeNull();
    expect(view.contentDOM.textContent).toContain('flowchart TD');
    expect(view.state.selection.main.from).toBe(selectionBefore.from + 1);
    expect(view.state.selection.main.to).toBe(selectionBefore.to + 1);

    view.destroy();
    parent.remove();
  });

  it('deletes the complete mermaid fenced block from the preview action', async () => {
    vi.useFakeTimers();
    const doc = ['before', '```mermaid', 'flowchart TD', '  A --> B', '```', 'after'].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });

    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();
    parent.querySelector<HTMLButtonElement>('.lm-mermaid-delete')?.click();

    expect(view.state.doc.toString()).toBe(['before', 'after'].join('\n'));

    view.destroy();
    parent.remove();
  });

  it('requests a new render when the application theme changes', async () => {
    document.documentElement.dataset.theme = 'light';
    const doc = [
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      'after',
    ].join('\n');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn().mockResolvedValue('<svg></svg>'),
    });
    const requestSpy = vi.spyOn(scheduler, 'request');

    const { parent, view } = createView(doc, scheduler);
    document.documentElement.dataset.theme = 'dark';
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark' }),
    );

    view.destroy();
    parent.remove();
  });
});
