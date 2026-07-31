import { describe, expect, it } from 'vitest';
import { searchPanelOpen } from '@codemirror/search';
import { createEditorApi } from '../core/editorApi';
import {
  createEditorCommandPort,
  createEditorDocumentPort,
} from './editorCommandPort';

describe('editor command port', () => {
  it('separates normalized editor text from exact serialized source', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = '\uFEFFfirst\r\nsecond\rthird\n';
    const editor = createEditorApi({ doc: source, parent });
    const documentPort = createEditorDocumentPort(editor);

    expect(documentPort.getText()).toBe('first\nsecond\nthird\n');
    expect(documentPort.serializeText()).toBe(source);
    expect(documentPort.captureSnapshot().serializedText).toBe(source);

    editor.destroy();
    parent.remove();
  });

  it('opens the built-in search panel through the command port', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'Find this Markdown text.',
      parent,
    });
    const commands = createEditorCommandPort(editor);

    commands.openSearch();

    expect(searchPanelOpen(editor.view.state)).toBe(true);

    editor.destroy();
    parent.remove();
  });

  it('undoes and redoes editor changes without exposing document state to the caller', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'plain',
      parent,
    });
    const commands = createEditorCommandPort(editor);

    commands.runFormat('bold');
    expect(editor.getDocumentText()).toBe('**bold**plain');

    commands.undo();
    expect(editor.getDocumentText()).toBe('plain');

    commands.redo();
    expect(editor.getDocumentText()).toBe('**bold**plain');

    editor.destroy();
    parent.remove();
  });

  it('inserts local image references without rewriting their markdown sources', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'before ',
      parent,
    });
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    const commands = createEditorCommandPort(editor);

    commands.insertImages([
      {
        alt: '魔法森林动漫.png',
        markdownSource: 'C:\\Users\\pippin\\Pictures\\魔法森林动漫.png',
      },
      {
        alt: '魔法森林真人.png',
        markdownSource: 'C:\\Users\\pippin\\Pictures\\魔法森林真人.png',
      },
    ]);

    expect(editor.getDocumentText()).toBe(
      'before ![魔法森林动漫.png](C:\\Users\\pippin\\Pictures\\魔法森林动漫.png)\n' +
        '![魔法森林真人.png](C:\\Users\\pippin\\Pictures\\魔法森林真人.png)',
    );

    editor.destroy();
    parent.remove();
  });

  it('ignores native image drops outside the editor', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'unchanged', parent });
    const commands = createEditorCommandPort(editor);

    commands.insertImages(
      [{ alt: 'outside.png', markdownSource: 'C:\\Pictures\\outside.png' }],
      { x: -100, y: -100 },
    );

    expect(editor.getDocumentText()).toBe('unchanged');

    editor.destroy();
    parent.remove();
  });

  it('exposes image preview invalidation through the document port', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '![Local](./pic.png)', parent });
    const documentPort = createEditorDocumentPort(editor);

    expect(documentPort.refreshImages).toBeTypeOf('function');

    editor.destroy();
    parent.remove();
  });
});
