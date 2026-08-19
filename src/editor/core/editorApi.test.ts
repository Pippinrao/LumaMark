import {
  deleteCharBackward,
  insertNewlineAndIndent,
  redo,
  undo,
  undoDepth,
} from '@codemirror/commands';
import { startCompletion } from '@codemirror/autocomplete';
import { openSearchPanel } from '@codemirror/search';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { createEditorApi } from './editorApi';
import { importFiles } from '../capabilities/image/imageInputExtension';
import { editorMathPreferencesField } from '../capabilities/math/mathPreferences';
import { isDocumentDirty } from './createEditorState';
import { parseDocumentSource } from './documentSourceFormat';
import { getEditorSearchPhrases } from '../../shared/i18n/editorSearchPhrases';
import {
  editorDisplayModeCompartment,
  editorDisplayModeExtension,
} from './editorDisplayMode';

describe('editorApi', () => {
  it('atomically applies math syntax and renderer preferences without changing document state', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const updates: { readonly docChanged: boolean; readonly transactionCount: number }[] = [];
    const editor = createEditorApi({
      displayMode: 'source',
      doc: 'Inline $ x $9 tail',
      extensions: [
        EditorView.updateListener.of((update) => {
          updates.push({
            docChanged: update.docChanged,
            transactionCount: update.transactions.length,
          });
        }),
      ],
      parent,
    });
    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: '\nDraft' },
      selection: EditorSelection.cursor(3),
    });
    expect(syntaxTree(editor.view.state).toString()).not.toContain('InlineMath');
    const documentBefore = editor.getSerializedDocumentText();
    const selectionBefore = editor.view.state.selection;
    const historyBefore = undoDepth(editor.view.state);
    const dirtyBefore = isDocumentDirty(editor.view.state);
    updates.length = 0;

    editor.setMathPreferences({
      equationNumbering: 'ams',
      physicsEnabled: true,
      syntaxMode: 'legacy',
    });

    expect(updates).toEqual([{ docChanged: false, transactionCount: 1 }]);
    expect(syntaxTree(editor.view.state).toString()).toContain('InlineMath');
    expect(editor.view.state.field(editorMathPreferencesField)).toEqual({
      equationNumbering: 'ams',
      physicsEnabled: true,
      syntaxMode: 'legacy',
    });
    expect(editor.getSerializedDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(selectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    expect(isDocumentDirty(editor.view.state)).toBe(dirtyBefore);

    editor.destroy();
    parent.remove();
  });

  it('does not dispatch when math preferences are unchanged', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const updateListener = vi.fn();
    const editor = createEditorApi({
      displayMode: 'source',
      extensions: [EditorView.updateListener.of(updateListener)],
      parent,
    });
    const preferences = {
      equationNumbering: 'all' as const,
      physicsEnabled: true,
      syntaxMode: 'legacy' as const,
    };
    editor.setMathPreferences(preferences);
    updateListener.mockClear();

    editor.setMathPreferences({ ...preferences });

    expect(updateListener).not.toHaveBeenCalled();

    editor.destroy();
    parent.remove();
  });

  it('retains math preferences across document load, context, and display changes', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      displayMode: 'source',
      doc: 'Initial',
      parent,
    });
    const preferences = {
      equationNumbering: 'ams' as const,
      physicsEnabled: true,
      syntaxMode: 'legacy' as const,
    };
    editor.setMathPreferences(preferences);

    editor.loadDocument('Loaded $ x $9');
    editor.setDocumentContext({
      documentId: 'document:next',
      path: 'E:\\notes\\next.md',
    });
    editor.setDisplayMode('livePreview');

    expect(editor.view.state.field(editorMathPreferencesField)).toEqual(preferences);
    expect(syntaxTree(editor.view.state).toString()).toContain('InlineMath');

    editor.setDisplayMode('reading');
    expect(editor.view.state.field(editorMathPreferencesField)).toEqual(preferences);
    editor.setDisplayMode('source');
    expect(editor.view.state.field(editorMathPreferencesField)).toEqual(preferences);
    expect(syntaxTree(editor.view.state).toString()).toContain('InlineMath');

    editor.destroy();
    parent.remove();
  });

  it('keeps adjacent inserted logical line endings distinct after serialization', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: '\uFEFFa\nb\r\nc\r\nd\ne\nf\ng\rh\ni',
      parent,
    });

    editor.view.dispatch({
      changes: {
        from: 15,
        insert: 'x\n\ny',
      },
    });
    const normalizedText = editor.view.state.doc.toString();
    const serializedText = editor.captureDocumentSnapshot().serializedText;

    expect(parseDocumentSource(serializedText).text).toBe(normalizedText);
    expect(undo(editor.view)).toBe(true);
    expect(editor.captureDocumentSnapshot().serializedText).toBe(
      '\uFEFFa\nb\r\nc\r\nd\ne\nf\ng\rh\ni',
    );
    expect(redo(editor.view)).toBe(true);
    expect(
      parseDocumentSource(
        editor.captureDocumentSnapshot().serializedText,
      ).text,
    ).toBe(normalizedText);

    editor.destroy();
    parent.remove();
  });

  it('restores the original mixed line ending after deleting it and undoing', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = '\uFEFFone\r\ntwo\rthree\nfour';
    const editor = createEditorApi({ doc: source, parent });
    const firstLineEnding = editor.view.state.doc.line(1).to;

    editor.view.dispatch({
      changes: {
        from: firstLineEnding,
        to: firstLineEnding + 1,
      },
    });
    expect(editor.captureDocumentSnapshot().serializedText).toBe(
      '\uFEFFonetwo\rthree\nfour',
    );
    expect(isDocumentDirty(editor.view.state)).toBe(true);

    expect(undo(editor.view)).toBe(true);

    expect(editor.captureDocumentSnapshot().serializedText).toBe(source);
    expect(isDocumentDirty(editor.view.state)).toBe(false);

    editor.destroy();
    parent.remove();
  });

  it.each([
    {
      insertAt: (editor: ReturnType<typeof createEditorApi>) =>
        editor.view.state.doc.line(1).to,
      name: 'before',
    },
    {
      insertAt: (editor: ReturnType<typeof createEditorApi>) =>
        editor.view.state.doc.line(2).from,
      name: 'after',
    },
  ])(
    'keeps one exact marker per newline when inserting $name an existing newline',
    ({ insertAt }) => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const editor = createEditorApi({
        doc: 'left\r\nright\rthird',
        parent,
      });

      editor.view.dispatch({
        changes: {
          from: insertAt(editor),
          insert: '\n',
        },
      });

      expect(editor.captureDocumentSnapshot().serializedText).toBe(
        'left\r\n\r\nright\rthird',
      );

      editor.destroy();
      parent.remove();
    },
  );

  it.each([
    {
      at: 4,
      expected: 'a\nbb\r\rc\nd\ne',
      insert: '\n',
      name: 'immediately before local CR',
      source: 'a\nbb\rc\nd\ne',
    },
    {
      at: 5,
      expected: 'a\nbb\r\rc\nd\ne',
      insert: '\n',
      name: 'immediately after local CR',
      source: 'a\nbb\rc\nd\ne',
    },
    {
      at: 4,
      expected: 'a\nbb\r\n\r\nc\nd\ne',
      insert: '\n',
      name: 'immediately before local CRLF',
      source: 'a\nbb\r\nc\nd\ne',
    },
    {
      at: 5,
      expected: 'a\nbb\r\n\r\nc\nd\ne',
      insert: '\n',
      name: 'immediately after local CRLF',
      source: 'a\nbb\r\nc\nd\ne',
    },
    {
      at: 5,
      expected: 'a\nbb\r\n\r\n\r\n\nc\nd\ne',
      insert: '\n\n\n',
      name: 'multi-line paste between local CRLF and LF',
      source: 'a\nbb\r\nc\nd\ne',
    },
    {
      at: 3,
      expected: 'a\r\nb\r\nd\nx\ny',
      insert: '\n',
      name: 'equal-distance replacement preferring the previous CRLF',
      source: 'a\r\nbcd\nx\ny',
      to: 4,
    },
  ])(
    'uses the closest preserved line ending for $name',
    ({ at, expected, insert, source, to = at }) => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const editor = createEditorApi({ doc: source, parent });

      editor.view.dispatch({
        changes: {
          from: at,
          insert,
          to,
        },
      });

      expect(editor.captureDocumentSnapshot().serializedText).toBe(expected);

      editor.destroy();
      parent.remove();
    },
  );

  it.each([
    {
      insert: 'x',
      lineEnding: 'CR',
      source: 'a\nb\r',
      expected: 'a\nbx',
    },
    {
      insert: 'x',
      lineEnding: 'CRLF',
      source: 'a\nb\r\n',
      expected: 'a\nbx',
    },
    {
      insert: 'x\n',
      lineEnding: 'CR',
      source: 'a\nb\r',
      expected: 'a\nbx\n',
    },
    {
      insert: 'x\n',
      lineEnding: 'CRLF',
      source: 'a\nb\r\n',
      expected: 'a\nbx\n',
    },
    {
      insert: '\n',
      lineEnding: 'CR',
      source: 'a\nb\r',
      expected: 'a\nb\n',
    },
    {
      insert: '\n',
      lineEnding: 'CRLF',
      source: 'a\nb\r\n',
      expected: 'a\nb\n',
    },
  ])(
    'drops a replaced non-dominant $lineEnding override for insert $insert and restores it through history',
    ({ expected, insert, source }) => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const editor = createEditorApi({ doc: source, parent });

      editor.view.dispatch({
        changes: {
          from: 3,
          insert,
          to: 4,
        },
      });
      const savedSnapshot = editor.captureDocumentSnapshot();
      expect(savedSnapshot.serializedText).toBe(expected);
      editor.markDocumentSaved(savedSnapshot);
      expect(isDocumentDirty(editor.view.state)).toBe(false);

      expect(undo(editor.view)).toBe(true);
      expect(editor.captureDocumentSnapshot().serializedText).toBe(source);
      expect(isDocumentDirty(editor.view.state)).toBe(true);

      expect(redo(editor.view)).toBe(true);
      expect(editor.captureDocumentSnapshot().serializedText).toBe(expected);
      expect(isDocumentDirty(editor.view.state)).toBe(false);

      editor.destroy();
      parent.remove();
    },
  );

  it('tracks the saved snapshot across undo and redo', () => {
    const dirtyStates: boolean[] = [];
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: '# Initial\n',
      onDocumentChanged: (event) => dirtyStates.push(event.dirty),
      parent,
    });

    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: 'saved' },
    });
    editor.markDocumentSaved(editor.captureDocumentSnapshot());
    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: ' draft' },
    });
    expect(undo(editor.view)).toBe(true);
    expect(redo(editor.view)).toBe(true);

    expect(dirtyStates).toEqual([true, false, true, false, true]);

    editor.destroy();
    parent.remove();
  });

  it('keeps a restored unsaved document dirty when undo returns to its restored text', () => {
    const dirtyStates: boolean[] = [];
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: '# Initial\n',
      onDocumentChanged: (event) => dirtyStates.push(event.dirty),
      parent,
    });

    editor.loadDocument('# Recovered\n', { saved: false });
    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: 'draft' },
    });
    expect(undo(editor.view)).toBe(true);

    expect(editor.getDocumentText()).toBe('# Recovered\n');
    expect(dirtyStates.at(-1)).toBe(true);

    editor.destroy();
    parent.remove();
  });

  it('keeps CRLF serialization while using normalized editor text', () => {
    const dirtyStates: boolean[] = [];
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: '# Initial',
      onDocumentChanged: (event) => dirtyStates.push(event.dirty),
      parent,
    });

    editor.loadDocument('# First\r\nSecond');
    expect(editor.getDocumentText()).toBe('# First\nSecond');
    expect(editor.captureDocumentSnapshot().serializedText).toBe(
      '# First\r\nSecond',
    );
    expect(dirtyStates.at(-1)).toBe(false);

    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: ' saved' },
    });
    editor.markDocumentSaved(editor.captureDocumentSnapshot());
    expect(dirtyStates.at(-1)).toBe(false);

    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: ' draft' },
    });
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDocumentText()).toBe('# First\nSecond saved');
    expect(dirtyStates.at(-1)).toBe(false);

    editor.destroy();
    parent.remove();
  });

  it('keeps a missing disk document dirty after edit and undo', () => {
    const dirtyStates: boolean[] = [];
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: '# Saved',
      onDocumentChanged: (event) => dirtyStates.push(event.dirty),
      parent,
    });

    editor.markDocumentUnsaved();
    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: ' draft' },
    });
    expect(undo(editor.view)).toBe(true);

    expect(editor.getDocumentText()).toBe('# Saved');
    expect(dirtyStates.at(-1)).toBe(true);

    editor.destroy();
    parent.remove();
  });

  it('does not undo into the previous document after loading another document', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '# Document A', parent });

    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: ' edited' },
    });
    editor.loadDocument('# Document B');

    expect(undo(editor.view)).toBe(false);
    expect(editor.getDocumentText()).toBe('# Document B');

    editor.destroy();
    parent.remove();
  });

  it('does not undo into the previous document after loading a new empty document', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '# Existing', parent });

    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: ' edited' },
    });
    editor.loadDocument('');

    expect(undo(editor.view)).toBe(false);
    expect(editor.getDocumentText()).toBe('');

    editor.destroy();
    parent.remove();
  });

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

  it('makes reading mode reject edits while keeping the rendered view', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const editor = createEditorApi({
      doc: '# Initial\n\n**Bold**\n',
      parent,
    });

    editor.setDisplayMode('reading');

    expect(editor.getDisplayMode()).toBe('reading');
    expect(editor.view.state.readOnly).toBe(true);
    expect(parent.querySelector('.lm-editor-reading-mode')).not.toBeNull();
    expect(parent.querySelector('.lm-editor-source-mode')).toBeNull();
    expect(parent.textContent).not.toContain('**Bold**');
    // User-facing edit commands refuse while readOnly is set. Programmatic
    // loadDocument still writes through dispatch, which is intentional.
    expect(deleteCharBackward(editor.view)).toBe(false);
    expect(insertNewlineAndIndent(editor.view)).toBe(false);
    expect(editor.getDocumentText()).toBe('# Initial\n\n**Bold**\n');

    editor.destroy();
    parent.remove();
  });

  it('keeps read-only state in an independent compartment while switching modes', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '# Initial\n', parent });

    expect(editor.view.state.readOnly).toBe(false);

    editor.setDisplayMode('reading');

    expect(editor.view.state.readOnly).toBe(true);

    editor.view.dispatch({
      effects: editorDisplayModeCompartment.reconfigure(
        editorDisplayModeExtension('source'),
      ),
    });

    expect(editor.view.state.readOnly).toBe(true);
    expect(parent.querySelector('.lm-editor-source-mode')).not.toBeNull();

    editor.destroy();
    parent.remove();
  });

  it('rejects programmatic document changes while reading and reports one attempt', () => {
    const onReadOnlyEditAttempt = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: '# Initial\n',
      onReadOnlyEditAttempt,
      parent,
    });
    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: 'draft' },
    });
    expect(undoDepth(editor.view.state)).toBe(1);
    editor.setDisplayMode('reading');
    const documentBeforeAttempt = editor.getDocumentText();
    const selectionBeforeAttempt = editor.view.state.selection;
    const historyBeforeAttempt = undoDepth(editor.view.state);

    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: 'blocked' },
    });

    expect(editor.getDocumentText()).toBe(documentBeforeAttempt);
    expect(editor.view.state.selection.eq(selectionBeforeAttempt)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBeforeAttempt);
    expect(onReadOnlyEditAttempt).toHaveBeenCalledTimes(1);

    editor.destroy();
    parent.remove();
  });

  it('allows effects-only transactions while reading', () => {
    const onReadOnlyEditAttempt = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: '# Initial\n',
      onReadOnlyEditAttempt,
      parent,
    });
    editor.setDisplayMode('reading');

    editor.markDocumentUnsaved();

    expect(isDocumentDirty(editor.view.state)).toBe(true);
    expect(onReadOnlyEditAttempt).not.toHaveBeenCalled();

    editor.destroy();
    parent.remove();
  });

  it('loads controlled document refreshes while reading without reporting an edit attempt', () => {
    const onReadOnlyEditAttempt = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: '# Initial\n',
      onReadOnlyEditAttempt,
      parent,
    });
    editor.setDisplayMode('reading');

    editor.loadDocument('# Refreshed\r\n\r\nBody', {
      preserveView: true,
      resetHistory: false,
    });

    expect(editor.getDocumentText()).toBe('# Refreshed\n\nBody');
    expect(editor.getSerializedDocumentText()).toBe('# Refreshed\r\n\r\nBody');
    expect(editor.view.state.readOnly).toBe(true);
    expect(onReadOnlyEditAttempt).not.toHaveBeenCalled();

    editor.destroy();
    parent.remove();
  });

  it('restores editing when leaving reading mode', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const editor = createEditorApi({ doc: '# Initial\n', parent });

    editor.setDisplayMode('reading');
    editor.setDisplayMode('livePreview');

    expect(editor.view.state.readOnly).toBe(false);
    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: 'tail' },
    });

    expect(editor.getDocumentText()).toBe('# Initial\ntail');

    editor.destroy();
    parent.remove();
  });

  it('does not rebuild live-preview widgets when locking a document transition', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      displayMode: 'livePreview',
      doc: [
        'intro $E=mc^2$',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        'after',
      ].join('\n'),
      parent,
    });
    const tableBefore = parent.querySelector('.tbl-table-widget');
    const displayBefore = editorDisplayModeCompartment.get(editor.view.state);
    expect(tableBefore).not.toBeNull();
    expect(editor.view.state.readOnly).toBe(false);

    editor.setDocumentTransitionLocked(true);

    expect(editor.view.state.readOnly).toBe(true);
    expect(deleteCharBackward(editor.view)).toBe(false);
    expect(editorDisplayModeCompartment.get(editor.view.state)).toBe(
      displayBefore,
    );
    expect(parent.querySelector('.tbl-table-widget')).toBe(tableBefore);

    editor.setDocumentTransitionLocked(false);

    expect(editor.view.state.readOnly).toBe(false);
    expect(editorDisplayModeCompartment.get(editor.view.state)).toBe(
      displayBefore,
    );
    expect(parent.querySelector('.tbl-table-widget')).toBe(tableBefore);

    editor.destroy();
    parent.remove();
  });

  it('keeps transition-lock dispatch cheaper than rebuilding live preview', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      displayMode: 'livePreview',
      doc: [
        'intro $E=mc^2$',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        'after',
      ].join('\n'),
      parent,
    });
    editor.setDocumentTransitionLocked(true);
    editor.setDocumentTransitionLocked(false);

    const lockSamples: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      editor.setDocumentTransitionLocked(true);
      editor.setDocumentTransitionLocked(false);
      lockSamples.push(performance.now() - started);
    }

    const rebuildSamples: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      editor.setDisplayMode('source');
      editor.setDisplayMode('livePreview');
      rebuildSamples.push(performance.now() - started);
    }

    const lockP80 = [...lockSamples].sort((left, right) => left - right)[3] ?? 0;
    const rebuildP80 =
      [...rebuildSamples].sort((left, right) => left - right)[3] ?? 0;
    expect(lockP80).toBeLessThan(Math.max(2, rebuildP80 / 4));

    editor.destroy();
    parent.remove();
  });

  it('keeps a document transition read-only across display-mode changes and restores the mode policy after release', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const editor = createEditorApi({ doc: '# Initial\n', parent });

    editor.setDocumentTransitionLocked(true);
    expect(editor.view.state.readOnly).toBe(true);
    expect(deleteCharBackward(editor.view)).toBe(false);

    editor.setDisplayMode('source');
    expect(editor.view.state.readOnly).toBe(true);

    editor.setDocumentTransitionLocked(false);
    expect(editor.view.state.readOnly).toBe(false);

    editor.setDisplayMode('reading');
    editor.setDocumentTransitionLocked(true);
    editor.setDocumentTransitionLocked(false);
    expect(editor.view.state.readOnly).toBe(true);

    editor.setDisplayMode('livePreview');
    expect(editor.view.state.readOnly).toBe(false);

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
    const english = getEditorSearchPhrases('en');
    const chinese = getEditorSearchPhrases('zh-CN');
    const controls = {
      all: parent.querySelector<HTMLButtonElement>('.cm-search button[name="select"]'),
      byWord: parent.querySelector<HTMLInputElement>('.cm-search input[name="word"]')
        ?.closest('label'),
      close: parent.querySelector<HTMLButtonElement>('.cm-search button[name="close"]'),
      find: parent.querySelector<HTMLInputElement>('.cm-search input[name="search"]'),
      matchCase: parent.querySelector<HTMLInputElement>('.cm-search input[name="case"]')
        ?.closest('label'),
      next: parent.querySelector<HTMLButtonElement>('.cm-search button[name="next"]'),
      previous: parent.querySelector<HTMLButtonElement>('.cm-search button[name="prev"]'),
      regexp: parent.querySelector<HTMLInputElement>('.cm-search input[name="re"]')
        ?.closest('label'),
      replace: parent.querySelector<HTMLInputElement>('.cm-search input[name="replace"]'),
      replaceAll: parent.querySelector<HTMLButtonElement>(
        '.cm-search button[name="replaceAll"]',
      ),
      replaceOne: parent.querySelector<HTMLButtonElement>(
        '.cm-search button[name="replace"]',
      ),
    };
    expect(controls.find?.placeholder).toBe(english.Find);
    expect(controls.find?.getAttribute('aria-label')).toBe(english.Find);
    expect(controls.replace?.placeholder).toBe(english.Replace);
    expect(controls.replace?.getAttribute('aria-label')).toBe(english.Replace);
    expect(controls.next?.textContent).toBe(english.next);
    expect(controls.previous?.textContent).toBe(english.previous);
    expect(controls.all?.textContent).toBe(english.all);
    expect(controls.matchCase?.textContent).toBe(english['match case']);
    expect(controls.regexp?.textContent).toBe(english.regexp);
    expect(controls.byWord?.textContent).toBe(english['by word']);
    expect(controls.replaceOne?.textContent).toBe(english.replace);
    expect(controls.replaceAll?.textContent).toBe(english['replace all']);
    expect(controls.close?.getAttribute('aria-label')).toBe(english.close);

    editor.setLanguage('zh-CN');

    expect(editor.getDocumentText()).toBe(documentBeforeLanguageChange);
    expect(editor.view.state.selection.main).toEqual(selectionBeforeLanguageChange);
    expect(controls.find?.placeholder).toBe(chinese.Find);
    expect(controls.find?.getAttribute('aria-label')).toBe(chinese.Find);
    expect(controls.replace?.placeholder).toBe(chinese.Replace);
    expect(controls.replace?.getAttribute('aria-label')).toBe(chinese.Replace);
    expect(controls.next?.textContent).toBe(chinese.next);
    expect(controls.previous?.textContent).toBe(chinese.previous);
    expect(controls.all?.textContent).toBe(chinese.all);
    expect(controls.matchCase?.textContent).toBe(chinese['match case']);
    expect(controls.regexp?.textContent).toBe(chinese.regexp);
    expect(controls.byWord?.textContent).toBe(chinese['by word']);
    expect(controls.replaceOne?.textContent).toBe(chinese.replace);
    expect(controls.replaceAll?.textContent).toBe(chinese['replace all']);
    expect(controls.close?.getAttribute('aria-label')).toBe(chinese.close);
    expect(parent.querySelector('.cm-search button[name="select"]')).toBe(controls.all);
    expect(parent.querySelector('.cm-search input[name="word"]')?.closest('label')).toBe(
      controls.byWord,
    );
    expect(parent.querySelector('.cm-search button[name="close"]')).toBe(controls.close);
    expect(parent.querySelector('.cm-search input[name="search"]')).toBe(controls.find);
    expect(parent.querySelector('.cm-search input[name="case"]')?.closest('label')).toBe(
      controls.matchCase,
    );
    expect(parent.querySelector('.cm-search button[name="next"]')).toBe(controls.next);
    expect(parent.querySelector('.cm-search button[name="prev"]')).toBe(controls.previous);
    expect(parent.querySelector('.cm-search input[name="re"]')?.closest('label')).toBe(
      controls.regexp,
    );
    expect(parent.querySelector('.cm-search input[name="replace"]')).toBe(controls.replace);
    expect(parent.querySelector('.cm-search button[name="replaceAll"]')).toBe(
      controls.replaceAll,
    );
    expect(parent.querySelector('.cm-search button[name="replace"]')).toBe(
      controls.replaceOne,
    );
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDocumentText()).toBe('Find this Markdown text.');

    editor.destroy();
    parent.remove();
  });

  it('relabels an existing task checkbox without recreating editor state or DOM', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['- [ ] task', '', 'after'].join('\n');
    const editor = createEditorApi({ doc, language: 'en', parent });
    editor.view.dispatch({
      changes: { from: doc.length, insert: ' updated' },
      selection: EditorSelection.cursor(doc.indexOf('after')),
    });
    const checkbox = parent.querySelector<HTMLInputElement>('.lm-md-task-checkbox');
    const documentBefore = editor.getDocumentText();
    const selectionBefore = editor.view.state.selection;
    const historyBefore = undoDepth(editor.view.state);

    expect(checkbox?.getAttribute('aria-label')).toBe(
      getEditorSearchPhrases('en')['Toggle task completion'],
    );

    editor.setLanguage('zh-CN');

    expect(checkbox?.getAttribute('aria-label')).toBe(
      getEditorSearchPhrases('zh-CN')['Toggle task completion'],
    );
    expect(checkbox?.isConnected).toBe(true);
    expect(parent.querySelector('.lm-md-task-checkbox')).toBe(checkbox);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(selectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);

    editor.destroy();
    parent.remove();
  });

  it('owns a mutable copy of custom search phrases', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const customPhrases = Object.freeze({ Find: 'Frozen find' });
    const editor = createEditorApi({
      doc: 'text',
      language: 'en',
      parent,
      searchPhrases: customPhrases,
    });

    expect(editor.view.state.phrase('Find')).toBe('Frozen find');
    expect(() => editor.setLanguage('zh-CN')).not.toThrow();
    expect(customPhrases).toEqual({ Find: 'Frozen find' });
    expect(editor.view.state.phrase('Find')).toBe(
      getEditorSearchPhrases('zh-CN').Find,
    );

    editor.destroy();
    parent.remove();
  });

  it('updates reading appearance without changing source, selection, or undo history', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      appearance: {
        fontZoomPercent: 100,
        pageWidthPx: 810,
      },
      doc: '# Initial\n',
      parent,
    });

    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: '\nDraft' },
      selection: EditorSelection.cursor(3),
    });
    const sourceBeforeAppearanceChange = editor.getSerializedDocumentText();
    const selectionBeforeAppearanceChange = editor.view.state.selection.main;

    editor.setAppearance({
      fontZoomPercent: 120,
      pageWidthPx: 1040,
    });

    expect(editor.getSerializedDocumentText()).toBe(sourceBeforeAppearanceChange);
    expect(editor.view.state.selection.main).toEqual(selectionBeforeAppearanceChange);
    expect(editor.view.dom.style.getPropertyValue('--lm-editor-font-scale')).toBe(
      '1.2',
    );
    expect(editor.view.dom.style.getPropertyValue('--lm-editor-page-width')).toBe(
      '1040px',
    );
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

  it('keeps everyday table widgets mounted across path-only document context updates', async () => {
    const doc = [
      '# Everyday GFM',
      '',
      '| Name | Score |',
      '| --- | --- |',
      '| Alice | 1 |',
      '',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: '',
      parent,
    });

    editor.loadDocument(doc);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const widgetBefore = parent.querySelector('.tbl-table-widget');
    expect(widgetBefore).not.toBeNull();
    const previewExtensionBefore = editorDisplayModeCompartment.get(
      editor.view.state,
    );

    editor.setDocumentContext({ path: 'E:\\notes\\everyday.md' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const widgetAfter = parent.querySelector('.tbl-table-widget');
    expect(widgetAfter).toBe(widgetBefore);
    expect(editorDisplayModeCompartment.get(editor.view.state)).toBe(
      previewExtensionBefore,
    );
    expect(parent.querySelectorAll('.tbl-table-widget')).toHaveLength(1);
    expect(editor.getDocumentText()).toBe(doc);

    editor.destroy();
    parent.remove();
  });

  it('syncs local image watch targets when only the document path changes', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const syncLocalSources = vi.fn().mockResolvedValue(undefined);
    const imageAssetResolver = Object.assign(
      async () =>
        ({
          kind: 'resolved',
          src: 'asset://localhost/pic.png',
        }) as const,
      { syncLocalSources },
    );
    const editor = createEditorApi({
      documentContext: {
        imageAssetResolver,
        path: null,
      },
      doc: '![Alt](./assets/pic.png)\n',
      parent,
    });

    await Promise.resolve();
    syncLocalSources.mockClear();

    editor.setDocumentContext({ path: 'E:\\notes\\doc.md' });
    await Promise.resolve();

    expect(syncLocalSources).toHaveBeenCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./assets/pic.png'],
    });

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
