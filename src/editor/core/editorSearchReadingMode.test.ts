import {
  isolateHistory,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import {
  getSearchQuery,
  openSearchPanel,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import { EditorSelection } from '@codemirror/state';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEditorApi } from './editorApi';

let editorStyleElement: HTMLStyleElement | null = null;

beforeAll(() => {
  const editorCssUrl = new URL('./editor.css', import.meta.url);
  const editorCssPath =
    editorCssUrl.protocol === 'file:'
      ? fileURLToPath(editorCssUrl)
      : resolve(process.cwd(), editorCssUrl.pathname.replace(/^\/+/, ''));
  editorStyleElement = document.createElement('style');
  editorStyleElement.textContent = readFileSync(editorCssPath, 'utf8');
  document.head.appendChild(editorStyleElement);
});

afterAll(() => {
  editorStyleElement?.remove();
  editorStyleElement = null;
});

describe('editor search in reading mode', () => {
  it('hides only replace controls when an existing search panel enters reading mode', () => {
    const parent = document.createElement('div');
    parent.className = 'lm-codemirror';
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'needle one needle two',
      parent,
    });

    editor.view.dispatch({
      annotations: isolateHistory.of('full'),
      changes: { from: editor.view.state.doc.length, insert: '!' },
    });
    editor.view.dispatch({
      annotations: isolateHistory.of('full'),
      changes: { from: editor.view.state.doc.length, insert: '?' },
    });
    expect(undo(editor.view)).toBe(true);
    editor.view.dispatch({ selection: EditorSelection.cursor(7) });
    expect(openSearchPanel(editor.view)).toBe(true);
    const query = new SearchQuery({
      caseSensitive: true,
      search: 'needle',
      wholeWord: true,
    });
    editor.view.dispatch({ effects: setSearchQuery.of(query) });

    const searchPanel = parent.querySelector<HTMLElement>('.cm-search');
    const controls = {
      byWord: parent
        .querySelector<HTMLInputElement>('.cm-search input[name="word"]')
        ?.closest<HTMLElement>('label'),
      close: parent.querySelector<HTMLButtonElement>(
        '.cm-search button[name="close"]',
      ),
      find: parent.querySelector<HTMLInputElement>(
        '.cm-search input[name="search"]',
      ),
      matchCase: parent
        .querySelector<HTMLInputElement>('.cm-search input[name="case"]')
        ?.closest<HTMLElement>('label'),
      next: parent.querySelector<HTMLButtonElement>(
        '.cm-search button[name="next"]',
      ),
      previous: parent.querySelector<HTMLButtonElement>(
        '.cm-search button[name="prev"]',
      ),
      regexp: parent
        .querySelector<HTMLInputElement>('.cm-search input[name="re"]')
        ?.closest<HTMLElement>('label'),
      replaceAll: parent.querySelector<HTMLButtonElement>(
        '.cm-search button[name="replaceAll"]',
      ),
      replaceInput: parent.querySelector<HTMLInputElement>(
        '.cm-search input[name="replace"]',
      ),
      replaceOne: parent.querySelector<HTMLButtonElement>(
        '.cm-search button[name="replace"]',
      ),
      select: parent.querySelector<HTMLButtonElement>(
        '.cm-search button[name="select"]',
      ),
    };
    const findControls = [
      controls.find,
      controls.next,
      controls.previous,
      controls.select,
      controls.matchCase,
      controls.regexp,
      controls.byWord,
      controls.close,
    ];
    const replaceControls = [
      controls.replaceInput,
      controls.replaceOne,
      controls.replaceAll,
    ];
    expect(searchPanel).not.toBeNull();
    expect(findControls.every(Boolean)).toBe(true);
    expect(replaceControls.every(Boolean)).toBe(true);
    for (const control of [...findControls, ...replaceControls]) {
      expect(getComputedStyle(control!).display).not.toBe('none');
    }
    expect(controls.find?.value).toBe(query.search);
    expect(controls.matchCase?.querySelector('input')?.checked).toBe(true);
    expect(controls.byWord?.querySelector('input')?.checked).toBe(true);
    expect(parent.querySelectorAll('.cm-searchMatch').length).toBeGreaterThan(0);

    const documentBefore = editor.getDocumentText();
    const selectionBefore = editor.view.state.selection;
    const undoBefore = undoDepth(editor.view.state);
    const redoBefore = redoDepth(editor.view.state);
    const highlightCountBefore = parent.querySelectorAll('.cm-searchMatch').length;
    expect(undoBefore).toBeGreaterThan(0);
    expect(redoBefore).toBeGreaterThan(0);

    editor.setDisplayMode('reading');

    expect(parent.querySelector('.cm-search')).toBe(searchPanel);
    expect(getSearchQuery(editor.view.state).eq(query)).toBe(true);
    expect(controls.find?.value).toBe(query.search);
    for (const control of findControls) {
      expect(getComputedStyle(control!).display).not.toBe('none');
    }
    for (const control of replaceControls) {
      expect(getComputedStyle(control!).display).toBe('none');
    }
    expect(parent.querySelectorAll('.cm-searchMatch')).toHaveLength(
      highlightCountBefore,
    );
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(selectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(undoBefore);
    expect(redoDepth(editor.view.state)).toBe(redoBefore);

    editor.destroy();
    parent.remove();
  });
});
