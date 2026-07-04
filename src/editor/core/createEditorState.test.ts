import { describe, expect, it } from 'vitest';
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
});
