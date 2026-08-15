import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { Annotation, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEditorState } from '../../core/createEditorState';
import { createEditorApi } from '../../core/editorApi';
import { CodeMirrorEditorApi } from '../../core/editorApi';

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
  });
}

if (typeof DataTransfer === 'undefined') {
  class DataTransferPolyfill {
    dropEffect = 'none';
    effectAllowed = 'all';
    files: File[] = [];
    items = [] as unknown as DataTransferItemList;
    types: string[] = [];

    clearData(): void {}
    getData(): string {
      return '';
    }
    setData(): void {}
    setDragImage(): void {}
  }

  Object.defineProperty(globalThis, 'DataTransfer', {
    configurable: true,
    value: DataTransferPolyfill,
  });
}

if (typeof ClipboardEvent === 'undefined') {
  class ClipboardEventPolyfill extends Event {
    readonly clipboardData: DataTransfer | null;

    constructor(type: string, eventInitDict?: ClipboardEventInit) {
      super(type, eventInitDict);
      this.clipboardData = eventInitDict?.clipboardData ?? null;
    }
  }

  Object.defineProperty(globalThis, 'ClipboardEvent', {
    configurable: true,
    value: ClipboardEventPolyfill,
  });
}

function createView(doc: string, selection = doc.length) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: createEditorState({
      doc,
    }),
  });
  if (selection !== doc.length) {
    view.dispatch({
      selection: {
        anchor: selection,
      },
    });
  }

  return { parent, view };
}

async function settleTablePreview(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function findNestedTableEditor(parent: ParentNode): EditorView | null {
  const editor = parent.querySelector<HTMLElement>(
    '.tbl-cell-editor .cm-editor',
  );
  return editor ? EditorView.findFromDOM(editor) : null;
}

let tableStyleElement: HTMLStyleElement | null = null;

beforeAll(() => {
  const tableCssUrl = new URL('./table.css', import.meta.url);
  const tableCssPath =
    tableCssUrl.protocol === 'file:'
      ? fileURLToPath(tableCssUrl)
      : resolve(process.cwd(), tableCssUrl.pathname.replace(/^\/+/g, ''));
  tableStyleElement = document.createElement('style');
  tableStyleElement.textContent = readFileSync(tableCssPath, 'utf8');
  document.head.appendChild(tableStyleElement);
});

afterAll(() => {
  tableStyleElement?.remove();
  tableStyleElement = null;
});

describe('tablePreviewExtension', () => {
  it('makes locked table preview text selectable with a visible system selection', async () => {
    const doc = [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| cell    | value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc, parent });
    editor.setDisplayMode('reading');
    await settleTablePreview();

    const preview = [...parent.querySelectorAll<HTMLElement>('.tbl-cell-view')]
      .find((candidate) => candidate.textContent === 'cell');
    const cell = preview?.closest<HTMLElement>('.tbl-cell');
    if (!preview || !cell) {
      throw new Error('Expected a visible locked table preview cell.');
    }

    expect(getComputedStyle(cell).userSelect).toBe('text');
    expect(getComputedStyle(preview).userSelect).toBe('text');

    const styleRules = Array.from(tableStyleElement?.sheet?.cssRules ?? []).filter(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
    );
    const selectionRule = styleRules.find((rule) =>
      rule.selectorText.includes('.cm-editor.lm-editor-reading-mode') &&
      rule.selectorText.includes('.tbl-table-widget') &&
      rule.selectorText.includes('.tbl-cell-view::selection'),
    );
    expect(selectionRule?.style.getPropertyValue('background-color')).toBe(
      'highlight',
    );
    expect(selectionRule?.style.getPropertyPriority('background-color')).toBe(
      'important',
    );
    expect(selectionRule?.style.getPropertyValue('color')).toBe(
      'highlighttext',
    );
    expect(selectionRule?.style.getPropertyPriority('color')).toBe('important');

    editor.destroy();
    parent.remove();
  });

  it('mounts a nested cell editor already locked when the root is reading', async () => {
    const doc = [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| cell    | value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc, parent });
    editor.view.dispatch({
      changes: {
        from: editor.view.state.doc.length,
        insert: '!',
      },
    });
    editor.setDisplayMode('reading');
    await settleTablePreview();
    editor.view.dispatch({
      selection: {
        anchor: doc.indexOf('cell') + 2,
      },
    });
    await Promise.resolve();

    const nestedEditor = findNestedTableEditor(parent);
    if (!nestedEditor) {
      throw new Error('Expected a newly mounted table cell editor.');
    }
    const documentBefore = editor.getDocumentText();
    const rootSelectionBefore = editor.view.state.selection;
    const nestedDocumentBefore = nestedEditor.state.doc.toString();
    const nestedSelectionBefore = nestedEditor.state.selection;
    const historyBefore = undoDepth(editor.view.state);

    expect(historyBefore).toBeGreaterThan(0);
    expect(nestedEditor.state.readOnly).toBe(true);
    expect(nestedEditor.state.facet(EditorView.editable)).toBe(false);

    nestedEditor.dispatch({
      changes: {
        from: nestedEditor.state.selection.main.head,
        insert: 'X',
      },
    });

    expect(nestedEditor.state.doc.toString()).toBe(nestedDocumentBefore);
    expect(nestedEditor.state.selection.eq(nestedSelectionBefore)).toBe(true);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);

    editor.destroy();
    parent.remove();
  });

  it('keeps an active locked cell synchronized with a controlled document refresh', async () => {
    const doc = [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| cell    | value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc, parent });
    editor.view.dispatch({
      selection: {
        anchor: doc.indexOf('cell') + 2,
      },
    });
    await settleTablePreview();

    const activeEditor = findNestedTableEditor(parent);
    if (!activeEditor) {
      throw new Error('Expected an active table cell editor.');
    }

    editor.setDisplayMode('reading');
    await settleTablePreview();
    editor.loadDocument(doc.replace('cell', 'bell'), {
      preserveView: true,
      resetHistory: false,
      saved: false,
    });
    await settleTablePreview();

    const refreshedEditor = findNestedTableEditor(parent);
    if (!refreshedEditor) {
      throw new Error('Expected the active table cell context to be preserved.');
    }
    expect(refreshedEditor).not.toBe(activeEditor);
    expect(activeEditor.dom.isConnected).toBe(false);
    expect(editor.getDocumentText()).toBe(doc.replace('cell', 'bell'));
    expect(refreshedEditor.state.doc.toString()).toBe('bell');
    expect(refreshedEditor.state.readOnly).toBe(true);
    expect(refreshedEditor.state.facet(EditorView.editable)).toBe(false);

    editor.destroy();
    parent.remove();
  });

  it('skips stable locked preview scans and synchronizes replacement surfaces', async () => {
    const doc = [
      'before',
      '',
      '| Header A | Header B |',
      '| -------- | -------- |',
      '| r0c0     | r0c1     |',
      '| r1c0     | r1c1     |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc, parent });

    await settleTablePreview();
    const livePreviewSurfaces = [
      ...parent.querySelectorAll<HTMLElement>('.tbl-cell-view'),
    ];
    expect(livePreviewSurfaces).toHaveLength(6);
    const livePreviewAttributes = new Map(
      livePreviewSurfaces.map((previewSurface) => [
        previewSurface,
        {
          ariaReadOnly: previewSurface.getAttribute('aria-readonly'),
          contentEditable: previewSurface.getAttribute('contenteditable'),
          tabIndex: previewSurface.getAttribute('tabindex'),
        },
      ]),
    );

    editor.setDisplayMode('reading');
    await settleTablePreview();

    const previewSurfaces = [
      ...parent.querySelectorAll<HTMLElement>('.tbl-cell-view'),
    ];
    expect(previewSurfaces).toEqual(livePreviewSurfaces);
    const rootQuerySelectorAll = vi.spyOn(
      editor.view.dom,
      'querySelectorAll',
    );
    const previewAttributeSpies = previewSurfaces.flatMap((previewSurface) => [
      vi.spyOn(previewSurface, 'setAttribute'),
      vi.spyOn(previewSurface, 'removeAttribute'),
    ]);

    for (const anchor of [1, 2, 3, 4, 5]) {
      editor.view.dispatch({ selection: { anchor } });
    }
    await Promise.resolve();

    expect(rootQuerySelectorAll).not.toHaveBeenCalled();
    for (const attributeSpy of previewAttributeSpies) {
      expect(attributeSpy).not.toHaveBeenCalled();
      attributeSpy.mockRestore();
    }

    rootQuerySelectorAll.mockClear();
    const replacementDoc = [
      'before',
      '',
      '| Next A | Next B | Next C |',
      '| ------ | ------ | ------ |',
      '| n0     | n1     | n2     |',
      '| n3     | n4     | n5     |',
      '',
      'after',
    ].join('\n');
    editor.loadDocument(replacementDoc, {
      preserveView: true,
      resetHistory: false,
      saved: false,
    });
    await settleTablePreview();

    const replacementPreviews = [
      ...parent.querySelectorAll<HTMLElement>('.tbl-cell-view'),
    ];

    expect(rootQuerySelectorAll).toHaveBeenCalledWith(
      '.tbl-table-widget .tbl-cell-view',
    );
    expect(replacementPreviews).toHaveLength(9);
    expect(
      replacementPreviews.every(
        (preview) => !previewSurfaces.includes(preview),
      ),
    ).toBe(true);
    for (const previewSurface of previewSurfaces) {
      const originalAttributes = livePreviewAttributes.get(previewSurface);
      expect(previewSurface.isConnected).toBe(false);
      expect(previewSurface.getAttribute('contenteditable')).toBe(
        originalAttributes?.contentEditable,
      );
      expect(previewSurface.getAttribute('aria-readonly')).toBe(
        originalAttributes?.ariaReadOnly,
      );
      expect(previewSurface.getAttribute('tabindex')).toBe(
        originalAttributes?.tabIndex,
      );
    }
    for (const replacementPreview of replacementPreviews) {
      expect(replacementPreview.getAttribute('contenteditable')).toBe('false');
      expect(replacementPreview.getAttribute('aria-readonly')).toBe('true');
      expect(replacementPreview.hasAttribute('tabindex')).toBe(false);
    }

    const previewParent = replacementPreviews[0]?.parentElement;
    if (!previewParent) {
      throw new Error('Expected the replacement preview parent.');
    }
    const parentPointerDown = vi.fn();
    previewParent.addEventListener('pointerdown', parentPointerDown);
    const pointerDown = new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
    });
    replacementPreviews[0]?.dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(false);
    expect(parentPointerDown).not.toHaveBeenCalled();

    rootQuerySelectorAll.mockRestore();
    editor.destroy();
    parent.remove();
  });

  it('masks an active cell editor with its preview surface while reading', async () => {
    const doc = [
      'before',
      '',
      '| Header A | Header B |',
      '| -------- | -------- |',
      '| **cell** | value    |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc, parent });
    editor.view.dispatch({
      changes: {
        from: editor.view.state.doc.length,
        insert: '!',
      },
    });
    editor.view.dispatch({
      selection: {
        anchor: doc.indexOf('cell') + 2,
      },
    });
    await settleTablePreview();

    const activeEditor = findNestedTableEditor(parent);
    const activeCell = activeEditor?.dom.closest<HTMLElement>('.tbl-cell');
    const editorSurface = activeCell?.querySelector<HTMLElement>(
      '.tbl-cell-editor',
    );
    const previewSurface = activeCell?.querySelector<HTMLElement>(
      '.tbl-cell-view[data-hidden]',
    );
    if (!activeEditor || !editorSurface || !previewSurface) {
      throw new Error('Expected an active table cell and both surfaces.');
    }
    activeEditor.dispatch({ selection: { anchor: 4 } });
    await settleTablePreview();
    const documentBefore = editor.getDocumentText();
    const rootSelectionBefore = editor.view.state.selection;
    const nestedDocumentBefore = activeEditor.state.doc.toString();
    const nestedSelectionBefore = activeEditor.state.selection;
    const historyBefore = undoDepth(editor.view.state);

    expect(historyBefore).toBeGreaterThan(0);
    expect(getComputedStyle(editorSurface).display).not.toBe('none');
    expect(getComputedStyle(previewSurface).display).toBe('none');
    expect(previewSurface.getAttribute('contenteditable')).toBe('');
    expect(previewSurface.hasAttribute('aria-readonly')).toBe(false);

    editor.setDisplayMode('reading');

    expect(getComputedStyle(editorSurface).display).toBe('none');
    expect(getComputedStyle(previewSurface).display).not.toBe('none');
    expect(previewSurface.getAttribute('contenteditable')).toBe('false');
    expect(previewSurface.getAttribute('aria-readonly')).toBe('true');
    expect(previewSurface.textContent).toBe('**cell**');
    expect(
      previewSurface.querySelectorAll('.lm-table-token-mark'),
    ).toHaveLength(2);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(activeEditor.state.doc.toString()).toBe(nestedDocumentBefore);
    expect(activeEditor.state.selection.eq(nestedSelectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    await settleTablePreview();
    expect(activeEditor.hasFocus).toBe(false);
    expect(editor.view.hasFocus).toBe(true);
    expect(document.activeElement).toBe(editor.view.contentDOM);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);

    editor.setDisplayMode('livePreview');
    await settleTablePreview();

    const restoredEditor = findNestedTableEditor(parent);
    const restoredCell = restoredEditor?.dom.closest<HTMLElement>('.tbl-cell');
    const restoredEditorSurface = restoredCell?.querySelector<HTMLElement>(
      '.tbl-cell-editor',
    );
    const restoredPreviewSurface = restoredCell?.querySelector<HTMLElement>(
      '.tbl-cell-view[data-hidden]',
    );
    if (!restoredEditor || !restoredEditorSurface || !restoredPreviewSurface) {
      throw new Error('Expected the active table cell context to be restored.');
    }
    expect(getComputedStyle(restoredEditorSurface).display).not.toBe('none');
    expect(getComputedStyle(restoredPreviewSurface).display).toBe('none');
    expect(restoredPreviewSurface.getAttribute('contenteditable')).toBe('');
    expect(restoredPreviewSurface.hasAttribute('aria-readonly')).toBe(false);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(restoredEditor.state.doc.toString()).toBe(nestedDocumentBefore);
    expect(restoredEditor.state.selection.eq(nestedSelectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);

    editor.destroy();
    parent.remove();
  });

  it('keeps locked table preview pointer navigation inert until an edit is attempted', async () => {
    const doc = [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| cell    | value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const onReadOnlyEditAttempt = vi.fn();
    const editor = createEditorApi({ doc, onReadOnlyEditAttempt, parent });
    editor.view.dispatch({
      changes: {
        from: editor.view.state.doc.length,
        insert: '!',
      },
    });
    editor.view.dispatch({
      selection: {
        anchor: doc.indexOf('cell') + 2,
      },
    });
    await settleTablePreview();

    const activeEditor = findNestedTableEditor(parent);
    const liveTargetPreview = [
      ...parent.querySelectorAll<HTMLElement>('.tbl-cell-view'),
    ].find((preview) => preview.textContent === 'value');
    if (!activeEditor || !liveTargetPreview) {
      throw new Error('Expected an active editor and an inactive target cell.');
    }
    expect(liveTargetPreview.getAttribute('tabindex')).toBe('-1');
    activeEditor.dispatch({ selection: { anchor: 2 } });
    activeEditor.focus();
    editor.setDisplayMode('reading');
    await settleTablePreview();

    const lockedEditor = [
      ...parent.querySelectorAll<HTMLElement>('.tbl-cell-editor .cm-editor'),
    ]
      .map((element) => EditorView.findFromDOM(element))
      .find((view) => view?.state.doc.toString() === 'cell');
    const lockedCell = lockedEditor?.dom.closest<HTMLElement>('.tbl-cell');
    const editorSurface = lockedCell?.querySelector<HTMLElement>(
      '.tbl-cell-editor',
    );
    const targetPreview = [
      ...parent.querySelectorAll<HTMLElement>('.tbl-cell-view'),
    ].find((preview) => preview.textContent === 'value');
    if (!lockedEditor || !editorSurface || !targetPreview) {
      throw new Error('Expected a locked editor and an inactive target cell.');
    }
    const documentBefore = editor.getDocumentText();
    const rootSelectionBefore = editor.view.state.selection;
    const nestedDocumentBefore = lockedEditor.state.doc.toString();
    const nestedSelectionBefore = lockedEditor.state.selection;
    const historyBefore = undoDepth(editor.view.state);
    const redoBefore = redoDepth(editor.view.state);

    expect(getComputedStyle(editorSurface).display).toBe('none');
    expect(getComputedStyle(targetPreview).display).not.toBe('none');
    expect(targetPreview.getAttribute('tabindex')).toBeNull();
    expect(document.activeElement).toBe(editor.view.contentDOM);

    let pointerDownsAtParent = 0;
    parent.addEventListener('pointerdown', () => {
      pointerDownsAtParent += 1;
    });
    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      cancelable: true,
      clientX: 24,
      clientY: 24,
    });
    targetPreview.dispatchEvent(pointerDown);
    targetPreview.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        button: 0,
        clientX: 24,
        clientY: 24,
      }),
    );
    await settleTablePreview();

    expect(onReadOnlyEditAttempt).not.toHaveBeenCalled();
    expect(pointerDown.defaultPrevented).toBe(false);
    const nestedAfterPointer = [
      ...parent.querySelectorAll<HTMLElement>('.tbl-cell-editor .cm-editor'),
    ]
      .map((element) => EditorView.findFromDOM(element))
      .find((view) => view?.state.doc.toString() === 'cell');
    const nestedSurfaceAfterPointer = nestedAfterPointer?.dom
      .closest<HTMLElement>('.tbl-cell')
      ?.querySelector<HTMLElement>('.tbl-cell-editor');
    if (!nestedAfterPointer || !nestedSurfaceAfterPointer) {
      throw new Error('Expected the locked table cell context to remain mounted.');
    }
    expect(nestedAfterPointer.state.readOnly).toBe(true);
    expect(nestedAfterPointer.state.facet(EditorView.editable)).toBe(false);
    expect(getComputedStyle(nestedSurfaceAfterPointer).display).toBe('none');
    expect(document.activeElement).toBe(editor.view.contentDOM);
    expect(nestedAfterPointer.hasFocus).toBe(false);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(nestedAfterPointer.state.doc.toString()).toBe(nestedDocumentBefore);
    expect(nestedAfterPointer.state.selection.eq(nestedSelectionBefore)).toBe(
      true,
    );
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    expect(redoDepth(editor.view.state)).toBe(redoBefore);
    expect(pointerDownsAtParent).toBe(0);

    const secondaryTargetPreview = [
      ...parent.querySelectorAll<HTMLElement>('.tbl-cell-view'),
    ].find((preview) => preview.textContent === 'value');
    if (!secondaryTargetPreview) {
      throw new Error('Expected the locked target cell to remain rendered.');
    }
    expect(secondaryTargetPreview.getAttribute('tabindex')).toBeNull();
    const secondaryPointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 2,
      buttons: 2,
      cancelable: true,
      clientX: 24,
      clientY: 24,
    });
    secondaryTargetPreview.dispatchEvent(secondaryPointerDown);

    expect(secondaryPointerDown.defaultPrevented).toBe(false);
    expect(pointerDownsAtParent).toBe(1);
    expect(onReadOnlyEditAttempt).not.toHaveBeenCalled();

    editor.view.dispatch({
      changes: {
        from: editor.view.state.doc.length,
        insert: 'blocked',
      },
    });

    expect(onReadOnlyEditAttempt).toHaveBeenCalledTimes(1);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    expect(redoDepth(editor.view.state)).toBe(redoBefore);

    editor.setDisplayMode('livePreview');
    await settleTablePreview();

    const restoredPreview = [
      ...parent.querySelectorAll<HTMLElement>('.tbl-cell-view'),
    ].find((preview) => preview.textContent === 'value');
    if (!restoredPreview) {
      throw new Error('Expected the inactive target cell to be restored.');
    }
    expect(targetPreview.getAttribute('tabindex')).toBe('-1');
    expect(restoredPreview.getAttribute('tabindex')).toBe('-1');
    restoredPreview.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: 24,
        clientY: 24,
      }),
    );
    restoredPreview.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        button: 0,
        clientX: 24,
        clientY: 24,
      }),
    );

    expect(onReadOnlyEditAttempt).toHaveBeenCalledTimes(1);
    expect(pointerDownsAtParent).toBe(2);

    editor.destroy();
    parent.remove();
  });

  it('does not let a pre-opened table structure menu leak a duplicate into the document after reading mode', async () => {
    const doc = [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| cell    | value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const onReadOnlyEditAttempt = vi.fn();
    const editor = createEditorApi({ doc, onReadOnlyEditAttempt, parent });
    editor.view.dispatch({
      selection: {
        anchor: doc.indexOf('cell') + 2,
      },
    });
    await settleTablePreview();

    const rowHandle = [
      ...parent.querySelectorAll<HTMLElement>(
        '.tbl-handle[data-type="header"][data-location="row"]',
      ),
    ].find((handle) =>
      handle.closest('.tbl-table-row')?.textContent?.includes('cell'),
    );
    if (!rowHandle) {
      throw new Error('Expected a body-row table structure handle.');
    }
    rowHandle.setPointerCapture = vi.fn();
    rowHandle.releasePointerCapture = vi.fn();
    rowHandle.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        buttons: 1,
        cancelable: true,
        clientX: 24,
        clientY: 24,
      }),
    );
    await Promise.resolve();
    rowHandle.dispatchEvent(
      new MouseEvent('pointerup', {
        bubbles: true,
        button: 0,
        buttons: 0,
        cancelable: true,
        clientX: 24,
        clientY: 24,
      }),
    );
    await settleTablePreview();

    const duplicateMenuItem = [
      ...document.querySelectorAll<HTMLElement>('.tbl-menu-item'),
    ].find((item) => item.textContent?.trim() === 'Duplicate row');
    if (!duplicateMenuItem) {
      throw new Error('Expected the body-row table structure menu to be open.');
    }
    const documentBefore = editor.getDocumentText();
    const rootSelectionBefore = editor.view.state.selection;
    const historyBefore = undoDepth(editor.view.state);
    const redoBefore = redoDepth(editor.view.state);
    const bodyRowsBefore = parent.querySelectorAll(
      '.tbl-table-body .tbl-table-row',
    ).length;

    editor.setDisplayMode('reading');
    await settleTablePreview();
    if (duplicateMenuItem.isConnected) {
      duplicateMenuItem.click();
    }
    await settleTablePreview();

    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    expect(redoDepth(editor.view.state)).toBe(redoBefore);
    expect(
      parent.querySelectorAll('.tbl-table-body .tbl-table-row'),
    ).toHaveLength(bodyRowsBefore);

    editor.setDisplayMode('livePreview');
    editor.view.dispatch({
      selection: {
        anchor: editor.getDocumentText().indexOf('cell') + 2,
      },
    });
    await settleTablePreview();
    const restoredEditor = [
      ...parent.querySelectorAll<HTMLElement>('.tbl-cell-editor .cm-editor'),
    ]
      .map((element) => EditorView.findFromDOM(element))
      .find((view) => view?.state.doc.toString() === 'cell');
    if (!restoredEditor) {
      throw new Error('Expected the original body-row cell editor to restore.');
    }
    restoredEditor.dispatch({
      changes: {
        from: restoredEditor.state.doc.length,
        insert: '!',
      },
    });
    await settleTablePreview();

    expect(editor.getDocumentText()).toBe(
      documentBefore.replace('| cell    |', '| cell!   |'),
    );
    expect(parent.querySelectorAll('.tbl-table-body .tbl-table-row')).toHaveLength(
      bodyRowsBefore,
    );
    expect(onReadOnlyEditAttempt).toHaveBeenCalledTimes(1);

    expect(undo(editor.view)).toBe(true);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(redo(editor.view)).toBe(true);
    expect(editor.getDocumentText()).toContain('| cell!');

    editor.destroy();
    parent.remove();
  });

  it('does not let locked table handles, resize, grid keys, or clipboard mutate after leaving reading mode', async () => {
    const doc = [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| cell    | value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc, parent });
    editor.view.dispatch({
      selection: {
        anchor: doc.indexOf('cell') + 2,
      },
    });
    await settleTablePreview();

    const documentBefore = editor.getDocumentText();
    const bodyRowsBefore = parent.querySelectorAll(
      '.tbl-table-body .tbl-table-row',
    ).length;
    editor.setDisplayMode('reading');
    await settleTablePreview();

    const tableWidget = parent.querySelector<HTMLElement>('.tbl-table-widget');
    const rowHandle = parent.querySelector<HTMLElement>(
      '.tbl-handle[data-type="header"][data-location="row"]',
    );
    const borderHandle = parent.querySelector<HTMLElement>(
      '.tbl-handle[data-type="border"]',
    );
    if (!tableWidget || !rowHandle) {
      throw new Error('Expected locked table chrome to remain available.');
    }
    rowHandle.setPointerCapture = vi.fn();
    rowHandle.releasePointerCapture = vi.fn();
    if (borderHandle) {
      borderHandle.setPointerCapture = vi.fn();
      borderHandle.releasePointerCapture = vi.fn();
    }
    for (const target of [rowHandle, borderHandle, tableWidget]) {
      if (!target) {
        continue;
      }
      target.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          button: 0,
          buttons: 1,
          cancelable: true,
          clientX: 24,
          clientY: 24,
        }),
      );
      target.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          buttons: 1,
          clientX: 48,
          clientY: 48,
        }),
      );
      target.dispatchEvent(
        new MouseEvent('pointerup', {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX: 48,
          clientY: 48,
        }),
      );
    }
    for (const key of ['Enter', 'Backspace', 'Delete', 'Tab']) {
      tableWidget.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key,
        }),
      );
    }
    tableWidget.dispatchEvent(
      new ClipboardEvent('cut', { bubbles: true, cancelable: true }),
    );
    tableWidget.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      }),
    );
    await settleTablePreview();

    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(
      parent.querySelectorAll('.tbl-table-body .tbl-table-row'),
    ).toHaveLength(bodyRowsBefore);

    editor.setDisplayMode('livePreview');
    const tableWrite = Annotation.define<string>();
    editor.view.dispatch({
      annotations: tableWrite.of('table.edit'),
      changes: {
        from: editor.getDocumentText().indexOf('cell'),
        insert: 'mutated',
        to: editor.getDocumentText().indexOf('cell') + 4,
      },
    });
    await settleTablePreview();

    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(
      parent.querySelectorAll('.tbl-table-body .tbl-table-row'),
    ).toHaveLength(bodyRowsBefore);

    editor.destroy();
    parent.remove();
  });

  it('moves focus from the current nested cell context to the root while reading', async () => {
    const doc = [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| cell    | value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc, parent });
    editor.view.dispatch({
      changes: {
        from: editor.view.state.doc.length,
        insert: '!',
      },
    });
    editor.view.dispatch({
      selection: {
        anchor: doc.indexOf('cell') + 2,
      },
    });
    await settleTablePreview();

    const activeEditor = findNestedTableEditor(parent);
    if (!activeEditor) {
      throw new Error('Expected an active table cell editor.');
    }
    activeEditor.dispatch({ selection: { anchor: 2 } });
    activeEditor.focus();
    await settleTablePreview();
    const documentBefore = editor.getDocumentText();
    const rootSelectionBefore = editor.view.state.selection;
    const nestedDocumentBefore = activeEditor.state.doc.toString();
    const nestedSelectionBefore = activeEditor.state.selection;
    const historyBefore = undoDepth(editor.view.state);
    const redoBefore = redoDepth(editor.view.state);

    expect(historyBefore).toBeGreaterThan(0);
    expect(redoBefore).toBe(0);
    expect(activeEditor.hasFocus).toBe(true);

    editor.setDisplayMode('reading');
    await settleTablePreview();

    const lockedEditor = findNestedTableEditor(parent);
    if (!lockedEditor) {
      throw new Error('Expected the active table cell context to be preserved.');
    }
    expect(lockedEditor.hasFocus).toBe(false);
    expect(editor.view.hasFocus).toBe(true);
    expect(document.activeElement).toBe(editor.view.contentDOM);
    expect(lockedEditor.state.readOnly).toBe(true);
    expect(lockedEditor.state.facet(EditorView.editable)).toBe(false);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(lockedEditor.state.doc.toString()).toBe(nestedDocumentBefore);
    expect(lockedEditor.state.selection.eq(nestedSelectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    expect(redoDepth(editor.view.state)).toBe(redoBefore);

    editor.destroy();
    parent.remove();
  });

  it('does not synchronously focus the root when locking an unfocused nested cell', async () => {
    const doc = [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| cell    | value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const outsideButton = document.createElement('button');
    document.body.appendChild(outsideButton);
    const editor = createEditorApi({ doc, parent });
    editor.view.dispatch({
      selection: {
        anchor: doc.indexOf('cell') + 2,
      },
    });
    await settleTablePreview();

    const activeEditor = findNestedTableEditor(parent);
    if (!activeEditor) {
      throw new Error('Expected an active table cell editor.');
    }
    activeEditor.dispatch({ selection: { anchor: 2 } });
    outsideButton.focus();
    const documentBefore = editor.getDocumentText();
    const rootSelectionBefore = editor.view.state.selection;
    const nestedDocumentBefore = activeEditor.state.doc.toString();
    const nestedSelectionBefore = activeEditor.state.selection;
    let rootFocusEvents = 0;
    editor.view.contentDOM.addEventListener('focus', () => {
      rootFocusEvents += 1;
    });

    expect(document.activeElement).toBe(outsideButton);
    expect(editor.view.hasFocus).toBe(false);
    expect(activeEditor.hasFocus).toBe(false);

    editor.setDisplayMode('reading');

    expect(rootFocusEvents).toBe(0);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(activeEditor.state.doc.toString()).toBe(nestedDocumentBefore);
    expect(activeEditor.state.selection.eq(nestedSelectionBefore)).toBe(true);

    await settleTablePreview();

    const lockedEditor = findNestedTableEditor(parent);
    if (!lockedEditor) {
      throw new Error('Expected the active table cell context to be preserved.');
    }
    expect(editor.view.hasFocus).toBe(false);
    expect(document.activeElement).toBe(outsideButton);
    expect(lockedEditor.hasFocus).toBe(false);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(lockedEditor.state.doc.toString()).toBe(nestedDocumentBefore);
    expect(lockedEditor.state.selection.eq(nestedSelectionBefore)).toBe(true);

    editor.destroy();
    parent.remove();
    outsideButton.remove();
  });

  it('restores nested focus after moving it to the root while reading', async () => {
    const doc = [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| cell    | value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let waitForRapidCycleFocus = false;
    let resolveRapidCycleFocus: (() => void) | undefined;
    const rapidCycleFocusSettled = new Promise<void>((resolve) => {
      resolveRapidCycleFocus = resolve;
    });
    const editor = createEditorApi({
      doc,
      extensions: [
        EditorView.updateListener.of((update) => {
          if (
            waitForRapidCycleFocus &&
            update.focusChanged &&
            !update.view.hasFocus
          ) {
            resolveRapidCycleFocus?.();
          }
        }),
      ],
      parent,
    });
    editor.view.dispatch({
      changes: {
        from: editor.view.state.doc.length,
        insert: '!',
      },
    });
    editor.view.dispatch({
      selection: {
        anchor: doc.indexOf('cell') + 2,
      },
    });
    await settleTablePreview();

    const activeEditor = findNestedTableEditor(parent);
    if (!activeEditor) {
      throw new Error('Expected an active table cell editor.');
    }
    activeEditor.dispatch({ selection: { anchor: 2 } });
    activeEditor.focus();
    await settleTablePreview();
    const documentBefore = editor.getDocumentText();
    const rootSelectionBefore = editor.view.state.selection;
    const nestedDocumentBefore = activeEditor.state.doc.toString();
    const nestedSelectionBefore = activeEditor.state.selection;
    const historyBefore = undoDepth(editor.view.state);
    const redoBefore = redoDepth(editor.view.state);

    expect(historyBefore).toBeGreaterThan(0);
    expect(redoBefore).toBe(0);
    expect(activeEditor.hasFocus).toBe(true);
    expect(document.activeElement).toBe(activeEditor.contentDOM);

    waitForRapidCycleFocus = true;
    editor.setDisplayMode('reading');

    expect(activeEditor.hasFocus).toBe(false);
    expect(editor.view.hasFocus).toBe(true);
    expect(document.activeElement).toBe(editor.view.contentDOM);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(activeEditor.state.doc.toString()).toBe(nestedDocumentBefore);
    expect(activeEditor.state.selection.eq(nestedSelectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    expect(redoDepth(editor.view.state)).toBe(redoBefore);

    editor.setDisplayMode('livePreview');
    await settleTablePreview();
    await rapidCycleFocusSettled;

    const restoredEditor = findNestedTableEditor(parent);
    if (!restoredEditor) {
      throw new Error('Expected the active table cell context to be restored.');
    }
    expect(restoredEditor.state.readOnly).toBe(false);
    expect(restoredEditor.state.facet(EditorView.editable)).toBe(true);
    expect(restoredEditor.hasFocus).toBe(true);
    expect(document.activeElement).toBe(restoredEditor.contentDOM);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(restoredEditor.state.doc.toString()).toBe(nestedDocumentBefore);
    expect(restoredEditor.state.selection.eq(nestedSelectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    expect(redoDepth(editor.view.state)).toBe(redoBefore);

    expect(undo(editor.view)).toBe(true);
    expect(editor.getDocumentText()).toBe(doc);
    expect(undoDepth(editor.view.state)).toBe(historyBefore - 1);
    expect(redoDepth(editor.view.state)).toBe(redoBefore + 1);

    expect(redo(editor.view)).toBe(true);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    expect(redoDepth(editor.view.state)).toBe(redoBefore);

    editor.destroy();
    parent.remove();
  });

  it('locks and restores an already active nested cell editor across reading mode', async () => {
    const doc = [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| cell    | value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc, parent });
    editor.view.dispatch({
      changes: {
        from: editor.view.state.doc.length,
        insert: '!',
      },
    });
    editor.view.dispatch({
      selection: {
        anchor: doc.indexOf('cell') + 2,
      },
    });
    await settleTablePreview();

    const activeEditor = findNestedTableEditor(parent);
    if (!activeEditor) {
      throw new Error('Expected an active table cell editor.');
    }
    activeEditor.dispatch({ selection: { anchor: 2 } });
    const documentBefore = editor.getDocumentText();
    const rootSelectionBefore = editor.view.state.selection;
    const nestedDocumentBefore = activeEditor.state.doc.toString();
    const nestedSelectionBefore = activeEditor.state.selection;
    const historyBefore = undoDepth(editor.view.state);
    const redoBefore = redoDepth(editor.view.state);

    expect(historyBefore).toBeGreaterThan(0);
    expect(redoBefore).toBe(0);
    expect(activeEditor.state.readOnly).toBe(false);
    expect(activeEditor.state.facet(EditorView.editable)).toBe(true);

    editor.setDisplayMode('reading');
    await settleTablePreview();

    const lockedEditor = findNestedTableEditor(parent);
    if (!lockedEditor) {
      throw new Error('Expected the active table cell context to be preserved.');
    }
    expect(lockedEditor.state.readOnly).toBe(true);
    expect(lockedEditor.state.facet(EditorView.editable)).toBe(false);

    lockedEditor.dispatch({
      changes: {
        from: lockedEditor.state.selection.main.head,
        insert: 'X',
      },
    });

    expect(lockedEditor.state.doc.toString()).toBe(nestedDocumentBefore);
    expect(lockedEditor.state.selection.eq(nestedSelectionBefore)).toBe(true);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    expect(redoDepth(editor.view.state)).toBe(redoBefore);

    editor.setDisplayMode('livePreview');
    await settleTablePreview();

    const restoredEditor = findNestedTableEditor(parent);
    if (!restoredEditor) {
      throw new Error('Expected the active table cell editor to be restored.');
    }
    expect(restoredEditor.state.readOnly).toBe(false);
    expect(restoredEditor.state.facet(EditorView.editable)).toBe(true);
    expect(restoredEditor.state.doc.toString()).toBe(nestedDocumentBefore);
    expect(restoredEditor.state.selection.eq(nestedSelectionBefore)).toBe(true);
    expect(editor.getDocumentText()).toBe(documentBefore);
    expect(editor.view.state.selection.eq(rootSelectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);
    expect(redoDepth(editor.view.state)).toBe(redoBefore);

    editor.destroy();
    parent.remove();
  });

  it('preserves a programmatically loaded noncanonical table byte-for-byte', async () => {
    const doc = [
      'before',
      '',
      '| Target | Value |',
      '| --- | --- |',
      '| TABLE_ACCEPTANCE_MARKER | keep |',
      '',
      '| Other | Value |',
      '| --- | --- |',
      '| SECOND_TABLE_ACCEPTANCE_MARKER | preserve |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView('');

    view.dispatch({
      annotations: Transaction.addToHistory.of(false),
      changes: { from: 0, insert: doc },
    });
    const historyAfterLoad = undoDepth(view.state);

    await settleTablePreview();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.state.doc.toString()).toBe(doc);
    expect(undoDepth(view.state)).toBe(historyAfterLoad);
    expect(parent.querySelectorAll('.tbl-table-widget')).toHaveLength(0);

    view.destroy();
    parent.remove();
  });

  it('does not let passive table formatting intercept the first real input undo', async () => {
    const doc = [
      'before',
      '',
      '| Header | Value |',
      '| :--- | ---: |',
      '| x | longer value |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView('');

    view.dispatch({
      annotations: Transaction.addToHistory.of(false),
      changes: { from: 0, insert: doc },
    });
    await settleTablePreview();

    view.dispatch({
      annotations: Transaction.userEvent.of('input.type'),
      changes: { from: view.state.doc.length, insert: '!' },
    });

    expect(view.state.doc.toString()).toBe(`${doc}!`);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
    parent.remove();
  });

  it('preserves noncanonical table source when entering live preview', async () => {
    const doc = [
      'before',
      '',
      '| Header | Value |',
      '| :--- | ---: |',
      '| x | longer value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = new CodeMirrorEditorApi({
      displayMode: 'source',
      doc,
      parent,
    });

    editor.setDisplayMode('livePreview');
    await settleTablePreview();

    expect(editor.getDocumentText()).toBe(doc);
    expect(parent.querySelector('.tbl-table-widget')).toBeNull();

    editor.destroy();
    parent.remove();
  });

  it('allows the mature widget to commit a real canonical table cell edit', async () => {
    const doc = [
      'before',
      '',
      '| A     | B      |',
      '| ----- | ------ |',
      '| first | second |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc);
    await settleTablePreview();
    const firstCell = [...parent.querySelectorAll<HTMLElement>('.tbl-data-cell')]
      .find((cell) => cell.textContent?.includes('first'));
    const cellView = firstCell?.querySelector<HTMLElement>('.tbl-cell-view');

    expect(firstCell).toBeDefined();
    expect(cellView).not.toBeNull();
    if (cellView) {
      cellView.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
      const range = document.createRange();
      range.selectNodeContents(cellView);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cellEditorDom = firstCell?.querySelector<HTMLElement>('.cm-editor');
    const cellEditor = cellEditorDom
      ? EditorView.findFromDOM(cellEditorDom)
      : null;
    expect(cellEditor).not.toBeNull();
    cellEditor?.dispatch({
      changes: { from: 0, insert: 'changed', to: cellEditor.state.doc.length },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.state.doc.toString()).toContain('changed');

    view.destroy();
    parent.remove();
  });

  it('renders GFM tables with the mature CodeMirror markdown tables component', () => {
    const doc = [
      'before',
      '',
      '| A        | B      |',
      '| -------- | ------ |',
      '| **bold** | `code` |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc);

    expect(view.state.doc.toString()).toBe(doc);
    expect(parent.querySelector('.tbl-table-widget .tbl-table')).not.toBeNull();
    expect(parent.querySelector('.tbl-table-widget')?.textContent).toContain('A');
    expect(parent.querySelector('.tbl-table-widget')?.textContent).toContain('bold');
    expect(parent.querySelector('.lm-table-widget')).toBeNull();
    expect(parent.querySelector('.lm-table-toolbar')).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('scales table content with the editor font zoom variable', () => {
    const doc = [
      'before',
      '',
      '| A        | B      |',
      '| -------- | ------ |',
      '| **bold** | `code` |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc);
    const table = parent.querySelector<HTMLElement>('.tbl-table');

    expect(table).not.toBeNull();
    expect(
      getComputedStyle(table!)
        .getPropertyValue('--tbl-style-font-size')
        .replaceAll(/\s/g, ''),
    ).toBe('calc(15.5px*var(--lm-editor-font-scale,1))');

    view.destroy();
    parent.remove();
  });

  it('keeps the mature table widget active while the editor selection is inside the table block', () => {
    const doc = [
      'before',
      '',
      '| A        | B      |',
      '| -------- | ------ |',
      '| **bold** | `code` |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc, doc.indexOf('bold'));

    expect(parent.querySelector('.tbl-table-widget .tbl-table')).not.toBeNull();
    expect(parent.textContent).not.toContain('| A        | B      |');

    view.destroy();
    parent.remove();
  });

  it('uses the component source DOM as the only inactive cell text surface', async () => {
    const doc = [
      'before',
      '',
      '| A        | B      | C                           |',
      '| -------- | ------ | --------------------------- |',
      '| **bold** | `code` | [site](https://example.com) |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc);

    await settleTablePreview();

    const widget = parent.querySelector('.tbl-table-widget');
    const boldCell = [...parent.querySelectorAll<HTMLElement>('.tbl-cell-view')]
      .find((cell) => cell.textContent === '**bold**');
    const codeCell = [...parent.querySelectorAll<HTMLElement>('.tbl-cell-view')]
      .find((cell) => cell.textContent === '`code`');
    const linkCell = [...parent.querySelectorAll<HTMLElement>('.tbl-cell-view')]
      .find((cell) => cell.textContent === '[site](https://example.com)');

    expect(widget).not.toBeNull();
    expect(parent.querySelector('.lm-table-inline-preview')).toBeNull();
    expect(
      boldCell?.querySelector('.lm-table-token-strong:not(.lm-table-token-mark)')
        ?.textContent,
    ).toBe('bold');
    expect(
      codeCell?.querySelector('.lm-table-token-code:not(.lm-table-token-mark)')
        ?.textContent,
    ).toBe('code');
    expect(boldCell?.querySelectorAll('.lm-table-token-mark')).toHaveLength(2);
    expect(codeCell?.querySelectorAll('.lm-table-token-mark')).toHaveLength(2);
    expect(
      linkCell?.querySelector('.lm-table-token-link:not(.lm-table-token-mark)')
        ?.textContent,
      linkCell?.innerHTML,
    ).toBe('site');
    expect(
      linkCell?.querySelector('.lm-table-token-link-destination')?.textContent,
    ).toBe('https://example.com');
    expect(linkCell?.querySelectorAll('.lm-table-token-mark')).toHaveLength(4);

    view.destroy();
    parent.remove();
  });

  it('does not swap the inactive cell DOM while hovering', async () => {
    const doc = [
      'before',
      '',
      '| A        | B      |',
      '| -------- | ------ |',
      '| **bold** | `code` |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc);

    await settleTablePreview();

    const boldCell = [...parent.querySelectorAll<HTMLElement>('.tbl-cell')]
      .find((cell) => cell.textContent?.includes('bold'));
    const boldCellView = boldCell?.querySelector<HTMLElement>('.tbl-cell-view');
    const initialMarkup = boldCellView?.innerHTML;

    expect(boldCell).toBeDefined();
    expect(boldCellView?.textContent).toBe('**bold**');
    expect(boldCellView?.dataset.lmInlineMarkdownMode).toBeUndefined();
    expect(boldCell?.querySelector('.lm-table-inline-preview')).toBeNull();

    boldCell?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

    expect(boldCellView?.innerHTML).toBe(initialMarkup);
    expect(boldCellView?.dataset.lmInlineMarkdownMode).toBeUndefined();

    boldCell?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

    expect(boldCellView?.innerHTML).toBe(initialMarkup);
    expect(boldCellView?.dataset.lmInlineMarkdownMode).toBeUndefined();

    view.destroy();
    parent.remove();
  });

  it('keeps a real table header aligned when earlier pipe-delimited prose is not a table', async () => {
    const doc = [
      '| this is pipe-delimited prose |',
      '',
      '| A        | B      |',
      '| -------- | ------ |',
      '| **bold** | `code` |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc);

    await settleTablePreview();

    const header = parent.querySelector<HTMLElement>('.tbl-header-cell');
    const source = header?.querySelector<HTMLElement>('.tbl-cell-view');

    expect(source?.textContent).toBe('A');
    expect(header?.querySelector('.lm-table-inline-preview')).toBeNull();

    view.destroy();
    parent.remove();
  });
});
