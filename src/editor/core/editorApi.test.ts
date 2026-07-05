import { undo } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { createEditorApi } from './editorApi';

describe('editorApi', () => {
  it('loads, reads, focuses, and destroys the editor document', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const editor = createEditorApi({
      doc: '# Initial\n',
      parent,
    });

    editor.loadDocument('# Loaded\n\nMarkdown body.\n');

    expect(editor.getDocumentText()).toBe('# Loaded\n\nMarkdown body.\n');

    editor.focus();

    expect(parent.contains(document.activeElement)).toBe(true);

    editor.destroy();
    parent.remove();
  });

  it('loads a new document at the beginning without scrolling to the end', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const editor = createEditorApi({
      doc: '# Initial\n\nBody',
      parent,
    });
    const scroller = parent.querySelector<HTMLElement>('.cm-scroller');

    if (!scroller) {
      throw new Error('Expected CodeMirror scroller to be mounted.');
    }

    scroller.scrollTop = 480;
    editor.loadDocument(
      Array.from({ length: 80 }, (_, index) => `# Heading ${index + 1}`).join(
        '\n\n',
      ),
    );

    expect(editor.view.state.selection.main.head).toBe(0);
    expect(scroller.scrollTop).toBe(0);

    editor.destroy();
    parent.remove();
  });

  it('switches source and live preview modes without changing text or undo history', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const editor = createEditorApi({
      doc: '# Initial\n',
      parent,
    });

    editor.view.dispatch({
      changes: {
        from: editor.view.state.doc.length,
        insert: '\n**Bold**',
      },
    });
    const changedText = editor.getDocumentText();

    editor.setDisplayMode('source');

    expect(editor.getDisplayMode()).toBe('source');
    expect(editor.getDocumentText()).toBe(changedText);
    expect(parent.querySelector('.lm-editor-source-mode')).not.toBeNull();

    editor.setDisplayMode('livePreview');

    expect(editor.getDisplayMode()).toBe('livePreview');
    expect(editor.getDocumentText()).toBe(changedText);

    expect(undo(editor.view)).toBe(true);
    expect(editor.getDocumentText()).toBe('# Initial\n');

    editor.destroy();
    parent.remove();
  });

  it('renders markdown tables with the mature live preview component by default', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const editor = createEditorApi({
      doc: ['intro', '', '| A | B |', '| - | - |', '| 1 | 2 |', '', 'after'].join('\n'),
      parent,
    });

    expect(parent.querySelector('.tbl-table-widget .tbl-table')).not.toBeNull();
    expect(parent.querySelector('.lm-table-widget')).toBeNull();
    expect(editor.getDocumentText()).toContain('| A | B |');

    editor.destroy();
    parent.remove();
  });

  it('updates live preview widgets when the current document path changes', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['![Alt](./assets/pic.png)', '', 'after'].join('\n');

    const editor = createEditorApi({
      doc,
      parent,
    });
    editor.view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('after')),
    });

    expect(parent.querySelector('.lm-image-preview-error')).not.toBeNull();

    editor.setDocumentContext({
      path: 'E:\\workspace\\notes\\doc.md',
    });

    expect(parent.querySelector('.lm-image-preview-error')).toBeNull();
    expect(
      parent.querySelector<HTMLImageElement>('.lm-image-preview img')?.src,
    ).toContain('assets');

    editor.destroy();
    parent.remove();
  });
});
