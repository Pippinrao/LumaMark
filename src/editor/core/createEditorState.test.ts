import { describe, expect, it, vi } from 'vitest';
import { redo, undo } from '@codemirror/commands';
import { openSearchPanel, searchPanelOpen } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { createEditorState } from './createEditorState';
import type { EditorDocumentChangedEvent } from './editorEvents';

describe('createEditorState', () => {
  it('creates a readable editor document from Markdown text', () => {
    const markdown = '# LumaMark\n\nStart writing.\n';

    const state = createEditorState({ doc: markdown });

    expect(state.doc.toString()).toBe(markdown);
  });

  it('emits lightweight document change events without Markdown source text', () => {
    const events: EditorDocumentChangedEvent[] = [];
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
      parent,
      state: createEditorState({
        doc: '# Initial\n',
        onDocumentChanged: (event) => {
          events.push(event);
        },
      }),
    });

    view.dispatch({
      changes: {
        from: view.state.doc.length,
        insert: '\nUpdated body.',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      dirty: true,
      docVersion: 1,
      documentLength: view.state.doc.length,
      type: 'documentChanged',
    });
    expect(JSON.stringify(events)).not.toContain('Updated body');

    view.destroy();
    parent.remove();
  });

  it('reports clean when undo returns to the saved document and dirty when redo leaves it', () => {
    const events: EditorDocumentChangedEvent[] = [];
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: createEditorState({
        doc: '# Saved\n',
        onDocumentChanged: (event) => events.push(event),
      }),
    });

    view.dispatch({ changes: { from: view.state.doc.length, insert: 'draft' } });
    expect(undo(view)).toBe(true);
    expect(redo(view)).toBe(true);

    expect(events.map((event) => event.dirty)).toEqual([true, false, true]);

    view.destroy();
    parent.remove();
  });

  it('does not compare document text for a selection-only update', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: createEditorState({ doc: '# Saved\n' }),
    });
    const eqSpy = vi.spyOn(view.state.doc, 'eq');

    view.dispatch({ selection: { anchor: 1 } });

    expect(eqSpy).not.toHaveBeenCalled();

    view.destroy();
    parent.remove();
  });

  it('opens the built-in search panel from the registered search command', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: createEditorState({ doc: 'Find this Markdown text.' }),
    });

    expect(searchPanelOpen(view.state)).toBe(false);
    expect(openSearchPanel(view)).toBe(true);
    expect(searchPanelOpen(view.state)).toBe(true);
    expect(parent.querySelector('.cm-search')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('localizes the built-in search panel with the requested editor language', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: createEditorState({
        doc: 'Find this Markdown text.',
        language: 'zh-CN',
      }),
    });

    expect(openSearchPanel(view)).toBe(true);
    expect(
      parent.querySelector<HTMLInputElement>('[name="search"]')?.placeholder,
    ).toBe('查找');
    expect(parent.querySelector<HTMLButtonElement>('[name="next"]')?.textContent).toBe(
      '下一个',
    );
    expect(
      parent.querySelector<HTMLButtonElement>('[name="replaceAll"]')?.textContent,
    ).toBe('全部替换');

    view.destroy();
    parent.remove();
  });
});
