import { undo } from '@codemirror/commands';
import { startCompletion } from '@codemirror/autocomplete';
import { openSearchPanel } from '@codemirror/search';
import { EditorSelection } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { createEditorApi } from './editorApi';
import { importFiles } from '../capabilities/image/imageInputExtension';

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

  it('preserves the selection and scroll position when reloading an externally changed document', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'before external change',
      parent,
    });
    const scroller = parent.querySelector<HTMLElement>('.cm-scroller');

    if (!scroller) {
      throw new Error('Expected CodeMirror scroller to be mounted.');
    }

    editor.view.dispatch({ selection: EditorSelection.cursor(8) });
    scroller.scrollTop = 240;
    scroller.scrollLeft = 18;

    editor.loadDocument('after external change with more text', {
      preserveView: true,
    });

    expect(editor.view.state.selection.main.head).toBe(8);
    expect(scroller.scrollTop).toBe(240);
    expect(scroller.scrollLeft).toBe(18);

    editor.destroy();
    parent.remove();
  });

  it('invalidates a pending image import when a different document is loaded', async () => {
    let resolveImport: ((value: { markdownSource: string }) => void) | undefined;
    const imageImportHandler = vi.fn(
      () =>
        new Promise<{ markdownSource: string }>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'old document',
      documentContext: {
        imageImportHandler,
        path: 'E:\\notes\\old.md',
      },
      parent,
    });
    const file = {
      arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
      name: 'old.png',
      type: 'image/png',
    } as File;

    const pending = importFiles(
      editor.view,
      [file],
      imageImportHandler,
      'E:\\notes\\old.md',
    );
    await Promise.resolve();
    editor.loadDocument('new document');
    editor.setDocumentContext({ path: 'E:\\notes\\new.md' });
    resolveImport?.({ markdownSource: 'old.assets/image-001.png' });
    await pending;

    expect(editor.getDocumentText()).toBe('new document');
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

  it('keeps the completion state available after an asynchronous blur and display-mode change', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'plain text',
      parent,
    });

    expect(startCompletion(editor.view)).toBe(true);

    editor.setDisplayMode('source');

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(startCompletion(editor.view)).toBe(true);

    editor.destroy();
    parent.remove();
  });

  it('updates search language without recreating the document, selection, or undo history', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'Find this Markdown text.',
      language: 'en',
      parent,
    });

    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: ' Updated.' },
      selection: EditorSelection.cursor(5),
    });
    const documentBeforeLanguageChange = editor.getDocumentText();
    const selectionBeforeLanguageChange = editor.view.state.selection.main;
    expect(openSearchPanel(editor.view)).toBe(true);
    expect(
      parent.querySelector<HTMLInputElement>('[name="search"]')?.placeholder,
    ).toBe('Find');

    editor.setLanguage('zh-CN');

    expect(editor.getDocumentText()).toBe(documentBeforeLanguageChange);
    expect(editor.view.state.selection.main).toEqual(selectionBeforeLanguageChange);
    expect(
      parent.querySelector<HTMLInputElement>('[name="search"]')?.placeholder,
    ).toBe('查找');
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDocumentText()).toBe('Find this Markdown text.');

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
