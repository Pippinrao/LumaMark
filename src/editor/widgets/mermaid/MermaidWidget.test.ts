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

  function ensureRangeMeasurement() {
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  }

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
    expect(
      parent.querySelector<HTMLElement>('.lm-mermaid-editor')?.hidden,
    ).toBe(false);
    expect(parent.querySelector('.lm-mermaid-editor .cm-content')?.textContent)
      .toContain('broken');

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
    expect(
      parent.querySelector<HTMLElement>(
        '.lm-mermaid-preview[data-status="error"] .lm-mermaid-editor',
      )?.hidden,
    ).toBe(false);
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

    const { parent, view } = createView(doc, scheduler);
    await vi.runAllTimersAsync();

    const editButton = parent.querySelector<HTMLButtonElement>(
      '.lm-mermaid-edit-source',
    );
    const deleteButton = parent.querySelector<HTMLButtonElement>(
      '.lm-mermaid-delete',
    );

    expect(editButton?.getAttribute('aria-label')).toBe('编辑源码');
    expect(deleteButton?.getAttribute('aria-label')).toBe('删除');
    expect(editButton?.textContent?.trim()).toBe('');
    expect(deleteButton?.textContent?.trim()).toBe('');
    expect(editButton?.querySelector('svg')).not.toBeNull();
    expect(deleteButton?.querySelector('svg')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('opens an inline mermaid editor that writes changes back to the fenced block', async () => {
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
    ensureRangeMeasurement();
    const editorContent = parent.querySelector<HTMLElement>(
      '.lm-mermaid-editor .cm-content',
    );

    if (!editorContent) {
      throw new Error('Expected inline Mermaid editor to open.');
    }

    editorContent.focus();
    editorContent.textContent = ['flowchart TD', '  A --> C'].join('\n');
    editorContent.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
    );
    await vi.runAllTimersAsync();

    expect(view.state.doc.toString()).toBe(doc);
    editorContent.dispatchEvent(
      new FocusEvent('focusout', {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
    await vi.runAllTimersAsync();

    expect(view.state.doc.toString()).toContain('A --> C');
    expect(view.state.doc.toString()).toContain('```mermaid');

    view.destroy();
    parent.remove();
  });

  it('keeps the inline mermaid editor mounted while validating invalid edits', async () => {
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
    ensureRangeMeasurement();

    const editorHost = parent.querySelector<HTMLElement>('.lm-mermaid-editor');
    const editorContent = parent.querySelector<HTMLElement>(
      '.lm-mermaid-editor .cm-content',
    );

    if (!editorHost || !editorContent) {
      throw new Error('Expected inline Mermaid editor to open.');
    }

    editorContent.focus();
    editorContent.textContent = 'not valid mermaid';
    editorContent.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
    );
    await vi.runAllTimersAsync();

    expect(parent.querySelector<HTMLElement>('.lm-mermaid-editor')).toBe(
      editorHost,
    );
    expect(editorHost.hidden).toBe(false);
    expect(parent.querySelector('.lm-mermaid-preview-editing')).not.toBeNull();
    expect(view.state.selection.main.from).toBe(doc.length);
    expect(view.state.doc.toString()).toBe(doc);
    expect(parent.querySelector('.lm-mermaid-error')?.textContent).toContain(
      'Mermaid 渲染失败',
    );

    view.destroy();
    parent.remove();
  });

  it('keeps the inline mermaid editor mounted when the parent selection changes', async () => {
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
    ensureRangeMeasurement();

    const editorHost = parent.querySelector<HTMLElement>('.lm-mermaid-editor');
    const editorContent = parent.querySelector<HTMLElement>(
      '.lm-mermaid-editor .cm-content',
    );

    if (!editorHost || !editorContent) {
      throw new Error('Expected inline Mermaid editor to open.');
    }

    editorContent.focus();
    editorContent.textContent = 'not valid mermaid';
    editorContent.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
    );
    await vi.runAllTimersAsync();

    view.dispatch({
      selection: EditorSelection.cursor(0),
    });
    await vi.runAllTimersAsync();

    expect(parent.querySelector<HTMLElement>('.lm-mermaid-editor')).toBe(
      editorHost,
    );
    expect(editorHost.hidden).toBe(false);
    expect(parent.querySelector('.lm-mermaid-editor .cm-content')?.textContent)
      .toContain('not valid mermaid');

    view.destroy();
    parent.remove();
  });

  it('closes the inline mermaid editor after focus leaves the preview widget', async () => {
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
    ensureRangeMeasurement();

    const editorHost = parent.querySelector<HTMLElement>('.lm-mermaid-editor');
    const editorContent = parent.querySelector<HTMLElement>(
      '.lm-mermaid-editor .cm-content',
    );

    if (!editorHost || !editorContent) {
      throw new Error('Expected inline Mermaid editor to open.');
    }

    editorContent.dispatchEvent(
      new FocusEvent('focusout', {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
    await vi.runAllTimersAsync();

    expect(editorHost.hidden).toBe(true);
    expect(parent.querySelector('.lm-mermaid-preview-editing')).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('keeps the inline mermaid editor open when focus moves to a preview action', async () => {
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
    ensureRangeMeasurement();

    const editorHost = parent.querySelector<HTMLElement>('.lm-mermaid-editor');
    const editorContent = parent.querySelector<HTMLElement>(
      '.lm-mermaid-editor .cm-content',
    );
    const deleteButton = parent.querySelector<HTMLButtonElement>(
      '.lm-mermaid-delete',
    );

    if (!editorHost || !editorContent || !deleteButton) {
      throw new Error('Expected inline Mermaid editor and actions to exist.');
    }

    editorContent.dispatchEvent(
      new FocusEvent('focusout', {
        bubbles: true,
        relatedTarget: deleteButton,
      }),
    );
    await vi.runAllTimersAsync();

    expect(editorHost.hidden).toBe(false);
    expect(parent.querySelector('.lm-mermaid-preview-editing')).not.toBeNull();

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
