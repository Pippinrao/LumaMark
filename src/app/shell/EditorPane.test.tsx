import '@testing-library/jest-dom/vitest';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EDITOR_APPEARANCE } from '../../editor/core/editorAppearance';
import type { EditorApi } from '../../editor/core/editorApi';
import type { EditorContextTarget } from '../../editor/interaction';
import { EditorPane } from './EditorPane';
import type { ShellMenuNode } from './shellTypes';

afterEach(() => cleanup());

function renderEditorPane(
  onLinkNavigationRequest: (href: string) => void = vi.fn(),
) {
  let editor: EditorApi | null = null;
  const closeContextMenu = vi.fn();
  const getContextMenuNodes = vi.fn(
    (_target: EditorContextTarget): ShellMenuNode[] => [],
  );
  const prepareContextMenu = vi.fn();

  render(
    <EditorPane
      accessibleTitle="note.md"
      appearance={DEFAULT_EDITOR_APPEARANCE}
      ariaLabel="Editor"
      closeContextMenu={closeContextMenu}
      getContextMenuNodes={getContextMenuNodes}
      language="en"
      mathPreferences={{
        equationNumbering: 'none',
        physicsEnabled: false,
        syntaxMode: 'pandoc',
      }}
      onDocumentChanged={vi.fn()}
      onEditorReady={(readyEditor) => {
        editor = readyEditor;
      }}
      onInvoke={vi.fn()}
      onLinkNavigationRequest={onLinkNavigationRequest}
      onMediaPreviewRequest={vi.fn()}
      onZoomRequested={vi.fn()}
      prepareContextMenu={prepareContextMenu}
      visibleDocumentTitle="note.md"
    />,
  );

  return {
    closeContextMenu,
    getContextMenuNodes,
    prepareContextMenu,
    readEditor: () => editor,
  };
}

describe('EditorPane link navigation wiring', () => {
  it('forwards one completed Ctrl primary link gesture without moving the selection', async () => {
    const onLinkNavigationRequest = vi.fn();
    const { readEditor } = renderEditorPane(onLinkNavigationRequest);
    await waitFor(() => expect(readEditor()).not.toBeNull());
    const editor = readEditor();
    if (!editor) {
      throw new Error('editor should be ready');
    }

    act(() => {
      editor.loadDocument('[docs](https://example.com)');
      editor.view.dispatch({ selection: { anchor: 0 } });
    });
    const selectionBefore = editor.view.state.selection.main;
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(2);

    fireEvent.mouseDown(editor.view.contentDOM, {
      button: 0,
      clientX: 40,
      clientY: 40,
      ctrlKey: true,
    });
    fireEvent.mouseUp(document, {
      button: 0,
      clientX: 40,
      clientY: 40,
      ctrlKey: true,
    });

    expect(onLinkNavigationRequest).toHaveBeenCalledOnce();
    expect(onLinkNavigationRequest).toHaveBeenCalledWith('https://example.com');
    expect(editor.view.state.selection.main).toEqual(selectionBefore);
  });
});

describe('EditorPane context menu targeting', () => {
  it('uses the stable outer EditorApi when the event target belongs to a nested CodeMirror', async () => {
    const { getContextMenuNodes, prepareContextMenu, readEditor } =
      renderEditorPane();
    await waitFor(() => expect(readEditor()).not.toBeNull());
    const editor = readEditor();
    if (!editor) {
      throw new Error('outer editor should be ready');
    }

    act(() => {
      editor.loadDocument('[outer](https://outer.test)');
      editor.view.dispatch({ selection: { anchor: 4 } });
    });
    const selectionBefore = editor.view.state.selection.main;
    const outerPosAtCoords = vi
      .spyOn(editor.view, 'posAtCoords')
      .mockReturnValue(2);

    const nestedParent = document.createElement('div');
    const editorPaper = document.querySelector('.lm-editor-paper');
    if (!editorPaper) {
      throw new Error('editor paper should exist');
    }
    editorPaper.appendChild(nestedParent);
    const nestedView = new EditorView({
      parent: nestedParent,
      state: EditorState.create({ doc: 'nested plain text' }),
    });
    const nestedPosAtCoords = vi
      .spyOn(nestedView, 'posAtCoords')
      .mockReturnValue(1);

    fireEvent.contextMenu(nestedView.contentDOM, {
      clientX: 24,
      clientY: 32,
    });

    expect(outerPosAtCoords).toHaveBeenCalledWith({ x: 24, y: 32 });
    expect(nestedPosAtCoords).not.toHaveBeenCalled();
    expect(prepareContextMenu).toHaveBeenCalledWith(
      nestedView.contentDOM,
      { x: 24, y: 32 },
      'pointer',
    );
    expect(getContextMenuNodes).toHaveBeenCalledWith({
      from: 0,
      href: 'https://outer.test',
      kind: 'link',
      rawHref: 'https://outer.test',
      to: 27,
    });
    expect(editor.view.state.selection.main).toEqual(selectionBefore);

    nestedView.destroy();
    nestedParent.remove();
  });

  it('resolves the exact outer table range from a nested table cell without moving selection', async () => {
    const { getContextMenuNodes, prepareContextMenu, readEditor } =
      renderEditorPane();
    await waitFor(() => expect(readEditor()).not.toBeNull());
    const editor = readEditor();
    if (!editor) {
      throw new Error('outer editor should be ready');
    }
    const secondTable = ['| X | Y |', '| - | - |', '| 3 | 4 |'].join('\n');
    const source = [
      'before',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      secondTable,
      '',
      'after',
    ].join('\n');
    act(() => {
      editor.loadDocument(source);
      editor.view.dispatch({ selection: { anchor: 0 } });
    });
    const selectionBefore = editor.view.state.selection.main;
    const secondWidget = await waitFor(() => {
      const widgets = document.querySelectorAll('.tbl-table-widget');
      expect(widgets).toHaveLength(2);
      return widgets[1];
    });
    const secondCell = secondWidget?.querySelector('.tbl-data-cell');
    if (!(secondCell instanceof HTMLElement)) {
      throw new Error('second table data cell should be rendered');
    }
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);

    fireEvent.contextMenu(secondCell, { clientX: 24, clientY: 32 });

    const tableRanges: { from: number; to: number }[] = [];
    syntaxTree(editor.view.state).iterate({
      enter(node) {
        if (node.name === 'Table') {
          tableRanges.push({ from: node.from, to: node.to });
        }
      },
    });
    expect(tableRanges).toHaveLength(2);
    const secondRange = tableRanges[1];
    expect(getContextMenuNodes).toHaveBeenCalledWith({
      from: secondRange?.from,
      kind: 'table',
      to: secondRange?.to,
    });
    expect(prepareContextMenu).toHaveBeenCalledWith(
      secondCell,
      { x: 24, y: 32 },
      'pointer',
    );
    expect(editor.view.state.selection.main).toEqual(selectionBefore);
  });

  it('does not open from the document title outside the real editor surface', async () => {
    const { getContextMenuNodes, readEditor } = renderEditorPane();
    await waitFor(() => expect(readEditor()).not.toBeNull());

    fireEvent.contextMenu(screen.getByText('note.md', { selector: '.lm-editor-title' }));

    expect(getContextMenuNodes).not.toHaveBeenCalled();
  });

  it.each([
    { key: 'F10', shiftKey: true },
    { key: 'ContextMenu', shiftKey: false },
  ])('opens from the keyboard path $key', async ({ key, shiftKey }) => {
    const { getContextMenuNodes, prepareContextMenu, readEditor } =
      renderEditorPane();
    await waitFor(() => expect(readEditor()).not.toBeNull());
    const editor = readEditor();
    if (!editor) {
      throw new Error('editor should be ready');
    }
    act(() => {
      editor.loadDocument('plain');
      editor.view.dispatch({ selection: { anchor: 2 } });
      editor.focus();
    });
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);

    fireEvent.keyDown(editor.view.contentDOM, { key, shiftKey });

    await waitFor(() =>
      expect(getContextMenuNodes).toHaveBeenCalledWith({
        at: 2,
        kind: 'plain',
      }),
    );
    expect(prepareContextMenu).toHaveBeenCalledWith(
      editor.view.contentDOM,
      undefined,
      'keyboard',
    );
    expect(await screen.findByRole('menu')).toHaveAttribute(
      'data-lm-window-interactive',
      'true',
    );
  });

  it.each([
    { key: 'F10', shiftKey: true },
    { key: 'ContextMenu', shiftKey: false },
  ])(
    'targets the current caret instead of the editor top-left for $key',
    async ({ key, shiftKey }) => {
      const { getContextMenuNodes, readEditor } = renderEditorPane();
      await waitFor(() => expect(readEditor()).not.toBeNull());
      const editor = readEditor();
      if (!editor) {
        throw new Error('editor should be ready');
      }
      const source = ['top paragraph', '', '[later](https://later.test)'].join(
        '\n',
      );
      const caret = source.indexOf('later') + 2;
      act(() => {
        editor.loadDocument(source);
        editor.view.dispatch({ selection: { anchor: caret } });
        editor.focus();
      });
      const coordsAtPos = vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
        bottom: 96,
        left: 140,
        right: 141,
        top: 80,
      });
      vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(1);

      fireEvent.keyDown(editor.view.contentDOM, { key, shiftKey });

      await waitFor(() =>
        expect(getContextMenuNodes).toHaveBeenCalledWith({
          from: source.indexOf('[later]'),
          href: 'https://later.test',
          kind: 'link',
          rawHref: 'https://later.test',
          to: source.length,
        }),
      );
      expect(coordsAtPos).toHaveBeenCalledWith(caret);
    },
  );

  it.each([
    { key: 'F10', shiftKey: true },
    { key: 'ContextMenu', shiftKey: false },
  ])(
    'keeps a non-empty selection intact for the keyboard path $key',
    async ({ key, shiftKey }) => {
      const { getContextMenuNodes, prepareContextMenu, readEditor } =
        renderEditorPane();
      await waitFor(() => expect(readEditor()).not.toBeNull());
      const editor = readEditor();
      if (!editor) {
        throw new Error('editor should be ready');
      }
      act(() => {
        editor.loadDocument('selected rest');
        editor.view.dispatch({ selection: { anchor: 0, head: 8 } });
        editor.focus();
      });
      const selectionBefore = editor.view.state.selection;

      fireEvent.keyDown(editor.view.contentDOM, { key, shiftKey });

      await waitFor(() =>
        expect(getContextMenuNodes).toHaveBeenCalledWith({
          from: 0,
          kind: 'selection',
          to: 8,
        }),
      );
      expect(prepareContextMenu).toHaveBeenCalledWith(
        editor.view.contentDOM,
        undefined,
        'keyboard',
      );
      expect(editor.view.state.selection).toEqual(selectionBefore);
    },
  );

  it('uses the original keyboard target to resolve an outer table action', async () => {
    const { getContextMenuNodes, prepareContextMenu, readEditor } =
      renderEditorPane();
    await waitFor(() => expect(readEditor()).not.toBeNull());
    const editor = readEditor();
    if (!editor) {
      throw new Error('editor should be ready');
    }
    const secondTable = ['| X | Y |', '| - | - |', '| 3 | 4 |'].join('\n');
    const source = [
      'before',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      secondTable,
      '',
      'after',
    ].join('\n');
    act(() => {
      editor.loadDocument(source);
      editor.view.dispatch({ selection: { anchor: 0 } });
      editor.focus();
    });
    const cell = await waitFor(() => {
      const resolved = document
        .querySelectorAll('.tbl-table-widget')[1]
        ?.querySelector('.tbl-data-cell');
      expect(resolved).not.toBeNull();
      return resolved;
    });
    if (!(cell instanceof HTMLElement)) {
      throw new Error('table cell should be rendered');
    }

    fireEvent.keyDown(cell, { key: 'F10', shiftKey: true });

    const tableRange = await waitFor(() => {
      const call = getContextMenuNodes.mock.calls.at(-1)?.[0];
      expect(call).toMatchObject({ kind: 'table' });
      return call;
    });
    expect(tableRange).toMatchObject({
      from: source.indexOf(secondTable),
      kind: 'table',
      to: source.indexOf(secondTable) + secondTable.length,
    });
    expect(prepareContextMenu).toHaveBeenCalledWith(
      cell,
      undefined,
      'keyboard',
    );
  });
});
