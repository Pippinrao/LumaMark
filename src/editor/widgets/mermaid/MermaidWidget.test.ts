import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { MermaidRenderScheduler } from './mermaidRenderScheduler';
import {
  collectMermaidBlocksInRanges,
  mermaidPreviewExtension,
} from './MermaidWidget';

function createView(doc: string, scheduler: MermaidRenderScheduler) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdownLanguage(), mermaidPreviewExtension({ scheduler })],
      selection: EditorSelection.cursor(doc.length),
    }),
  });

  return { parent, view };
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

  it('keeps mermaid source editable when the cursor is inside the block', () => {
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

    expect(parent.querySelector('.lm-mermaid-preview')).toBeNull();
    expect(parent.textContent).toContain('flowchart TD');

    view.destroy();
    parent.remove();
  });

  it('keeps mermaid source editable when the selection overlaps the block', () => {
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

    expect(parent.querySelector('.lm-mermaid-preview')).toBeNull();
    expect(parent.textContent).toContain('flowchart TD');

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

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('flowchart')),
    });

    expect(cancel).toHaveBeenCalledTimes(1);

    view.destroy();
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

    view.destroy();
    parent.remove();
  });

  it('moves the cursor into source when the error source action is clicked', async () => {
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

    expect(view.state.selection.main.head).toBe(doc.indexOf('broken'));
    expect(parent.querySelector('.lm-mermaid-preview')).toBeNull();

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
