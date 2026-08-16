import {
  applyMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from './markdownFormatCommands';
import { syntaxTree } from '@codemirror/language';
import { Transaction } from '@codemirror/state';
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import {
  getSearchQuery,
  openSearchPanel,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { createEditorCapabilityCommands } from '../capabilities';
import type {
  EditorApi,
  EditorDocumentSnapshot,
  LoadDocumentOptions,
} from '../core/editorApi';
import type { EditorDisplayMode } from '../core/editorDisplayMode';
import {
  deriveEditorInteractionContext,
  type EditorInteractionRange,
} from '../interaction';

export type EditorEditState = {
  canFormat: boolean;
  canInsert: boolean;
  canRedo: boolean;
  canUndo: boolean;
  clipboardReadAvailable: boolean;
  clipboardWriteAvailable: boolean;
  composing: boolean;
  eligibleFindSelection: boolean;
  readOnly: boolean;
  selectionCount: number;
  selectionEmpty: boolean;
  selectionLength: number;
};

export type EditorClipboardError = {
  cause: unknown;
  operation: 'copy' | 'cut' | 'paste';
};

export type EditorClipboardTextPort = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
};

export type EditorContextMenuCoordinates = {
  x: number;
  y: number;
};

export type EditorContextMenuSource = 'keyboard' | 'pointer';

type CreateEditorCommandPortOptions = {
  onClipboardError?: (error: EditorClipboardError) => void;
  resolveClipboard?: () => EditorClipboardTextPort | null;
};

export type EditorDocumentPort = {
  captureSnapshot: () => EditorDocumentSnapshot;
  focus: () => void;
  getText: () => string;
  isSnapshotCurrent: (snapshot: EditorDocumentSnapshot) => boolean;
  loadText: (text: string, options?: LoadDocumentOptions) => void;
  markSaved: (snapshot: EditorDocumentSnapshot) => void;
  markUnsaved: () => void;
  refreshImages?: (path: string) => void;
  serializeText: () => string;
  setContext: NonNullable<EditorApi['setDocumentContext']>;
  setTransitionLocked: NonNullable<EditorApi['setDocumentTransitionLocked']>;
};

export type EditorCommandPort = {
  closeContextMenu: (restoreFocus: boolean) => void;
  copy: () => Promise<boolean>;
  copyTable: (range?: EditorInteractionRange) => Promise<boolean>;
  cut: () => Promise<boolean>;
  deleteImageReference: (range: { from: number; to: number }) => void;
  deleteSelection: () => boolean;
  deleteTable: (range?: EditorInteractionRange) => boolean;
  focus: () => void;
  getDisplayMode: () => EditorDisplayMode;
  getEditState: () => EditorEditState;
  insertImages: (
    images: readonly { alt: string; markdownSource: string }[],
    position?: { x: number; y: number },
  ) => void;
  openSearch: (query?: string) => void;
  paste: () => Promise<boolean>;
  prepareContextMenu: (
    target: EventTarget | null,
    coordinates: EditorContextMenuCoordinates | undefined,
    source: EditorContextMenuSource,
  ) => void;
  runFormat: (command: MarkdownFormatCommand) => void;
  redo: () => void;
  selectAll: () => boolean;
  revealPosition: (position: number) => void;
  setDisplayMode: (mode: EditorDisplayMode) => void;
  undo: () => void;
};

export function createEditorDocumentPort(editor: EditorApi): EditorDocumentPort {
  return {
    captureSnapshot: () => editor.captureDocumentSnapshot(),
    focus: () => editor.focus(),
    getText: () => editor.getDocumentText(),
    isSnapshotCurrent: (snapshot) =>
      editor.isDocumentSnapshotCurrent(snapshot),
    loadText: (text, options) => {
      editor.loadDocument(text, options);
    },
    markSaved: (snapshot) => {
      editor.markDocumentSaved(snapshot);
    },
    markUnsaved: () => {
      editor.markDocumentUnsaved();
    },
    refreshImages: (path) => {
      createEditorCapabilityCommands(editor.view).refreshImages(path);
    },
    serializeText: () => editor.getSerializedDocumentText(),
    setContext: (context) => {
      editor.setDocumentContext(context);
    },
    setTransitionLocked: (locked) => {
      editor.setDocumentTransitionLocked(locked);
    },
  };
}

export function createEditorCommandPort(
  editor: EditorApi,
  options: CreateEditorCommandPortOptions = {},
): EditorCommandPort {
  const resolveClipboard =
    options.resolveClipboard ?? (() => null);
  const reportClipboardError = (
    operation: EditorClipboardError['operation'],
    cause: unknown,
  ) => {
    options.onClipboardError?.({ cause, operation });
  };
  let contextView: EditorView | null = null;
  const getContextView = () => {
    if (contextView && isEditorViewLive(editor.view, contextView)) {
      return contextView;
    }

    contextView = null;
    return editor.view;
  };
  const focusView = (view: EditorView) => {
    const target = isEditorViewLive(editor.view, view) ? view : editor.view;
    target.focus();
  };

  return {
    closeContextMenu: (restoreFocus) => {
      const view = getContextView();
      if (restoreFocus) {
        view.focus();
      }
      contextView = null;
    },
    copy: async () => {
      const view = getContextView();
      const selections = view.state.selection.ranges.filter(
        (range) => !range.empty,
      );
      const clipboard = resolveClipboard();
      if (selections.length === 0 || !clipboard?.writeText) {
        return false;
      }

      try {
        await clipboard.writeText(
          selections
            .map((selection) =>
              view.state.doc.sliceString(selection.from, selection.to),
            )
            .join('\n'),
        );
        focusView(view);
        return true;
      } catch (cause) {
        reportClipboardError('copy', cause);
        focusView(view);
        return false;
      }
    },
    copyTable: async (range) => {
      const view = getContextView();
      const clipboard = resolveClipboard();
      if (typeof clipboard?.writeText !== 'function') {
        reportClipboardError(
          'copy',
          new Error('The Clipboard API is unavailable.'),
        );
        focusView(view);
        return false;
      }

      try {
        const copied = await createEditorCapabilityCommands(editor.view, {
          writeClipboardText: (text) => clipboard.writeText!(text),
        }).copyTable(range);
        focusView(view);
        return copied;
      } catch (cause) {
        reportClipboardError('copy', cause);
        focusView(view);
        return false;
      }
    },
    cut: async () => {
      const view = getContextView();
      const startState = view.state;
      const { main } = startState.selection;
      const clipboard = resolveClipboard();
      if (
        startState.readOnly ||
        view.composing ||
        startState.selection.ranges.length !== 1 ||
        main.empty ||
        !clipboard?.writeText
      ) {
        return false;
      }

      try {
        await clipboard.writeText(
          startState.doc.sliceString(main.from, main.to),
        );
      } catch (cause) {
        reportClipboardError('cut', cause);
        focusView(view);
        return false;
      }

      if (!isAsyncEditTargetCurrent(editor.view, view, startState)) {
        reportClipboardError(
          'cut',
          new Error(
            'The document or selection changed before the cut could be applied.',
          ),
        );
        focusView(view);
        return false;
      }

      view.dispatch({
        changes: { from: main.from, to: main.to },
        selection: { anchor: main.from },
        userEvent: 'delete.cut',
      });
      focusView(view);
      return true;
    },
    deleteImageReference: (range) => {
      if (editor.view.state.readOnly || editor.view.composing) {
        return;
      }

      if (createEditorCapabilityCommands(editor.view).deleteImageReference(range)) {
        editor.focus();
      }
    },
    deleteSelection: () => {
      const view = getContextView();
      const { state } = view;
      const { main } = state.selection;

      if (
        state.readOnly ||
        view.composing ||
        state.selection.ranges.length !== 1 ||
        main.empty
      ) {
        return false;
      }

      view.dispatch({
        changes: { from: main.from, to: main.to },
        selection: { anchor: main.from },
        userEvent: 'delete.selection',
      });
      focusView(view);
      return true;
    },
    deleteTable: (range) => {
      if (editor.view.state.readOnly || editor.view.composing) {
        return false;
      }

      const deleted = createEditorCapabilityCommands(editor.view).deleteTable(
        range,
      );
      if (deleted) {
        editor.focus();
      }
      return deleted;
    },
    focus: () => editor.focus(),
    getDisplayMode: () => editor.getDisplayMode(),
    getEditState: () => {
      const view = getContextView();
      const clipboard = resolveClipboard();
      const { state } = view;
      const selectionCount = state.selection.ranges.length;
      const selectionLength = state.selection.ranges.reduce(
        (length, range) => length + range.to - range.from,
        0,
      );
      const { canFormat, canInsert } =
        view === editor.view
          ? deriveEditCapabilities(view)
          : { canFormat: false, canInsert: false };
      return {
        canFormat,
        canInsert,
        canRedo: !state.readOnly && redoDepth(state) > 0,
        canUndo: !state.readOnly && undoDepth(state) > 0,
        clipboardReadAvailable: typeof clipboard?.readText === 'function',
        clipboardWriteAvailable: typeof clipboard?.writeText === 'function',
        composing: view.composing,
        eligibleFindSelection:
          selectionCount === 1 && selectionLength > 0 && selectionLength <= 100,
        readOnly: state.readOnly,
        selectionCount,
        selectionEmpty: selectionLength === 0,
        selectionLength,
      };
    },
    insertImages: (images, position) => {
      const view = getContextView();
      if (view !== editor.view) {
        return;
      }
      const { canInsert } = deriveEditCapabilities(editor.view);
      if (
        editor.view.state.readOnly ||
        editor.view.composing ||
        editor.view.state.selection.ranges.length !== 1 ||
        !canInsert
      ) {
        return;
      }

      createEditorCapabilityCommands(editor.view).insertImages(images, position);
    },
    openSearch: (query) => {
      const sourceView = getContextView();
      const currentQuery = getSearchQuery(editor.view.state);
      const searchText = resolveSearchText(sourceView, query);

      openSearchPanel(editor.view);

      const nextQuery =
        searchText === null
          ? currentQuery
          : replaceSearchText(currentQuery, searchText);
      if (!nextQuery.eq(getSearchQuery(editor.view.state))) {
        editor.view.dispatch({ effects: setSearchQuery.of(nextQuery) });
      }
      focusSearchInput(editor.view);
    },
    paste: async () => {
      const view = getContextView();
      const startState = view.state;
      const { main } = startState.selection;
      const clipboard = resolveClipboard();
      if (
        startState.readOnly ||
        view.composing ||
        startState.selection.ranges.length !== 1 ||
        !clipboard?.readText
      ) {
        return false;
      }

      let text: string;
      try {
        text = await clipboard.readText();
      } catch (cause) {
        reportClipboardError('paste', cause);
        focusView(view);
        return false;
      }

      if (!isAsyncEditTargetCurrent(editor.view, view, startState)) {
        reportClipboardError(
          'paste',
          new Error(
            'The document or selection changed before the paste could be applied.',
          ),
        );
        focusView(view);
        return false;
      }

      view.dispatch({
        changes: { from: main.from, insert: text, to: main.to },
        selection: { anchor: main.from + text.length },
        userEvent: 'input.paste',
      });
      focusView(view);
      return true;
    },
    prepareContextMenu: (target, coordinates, source) => {
      const view = resolveContextEditorView(editor.view, target);
      contextView = view;

      if (source !== 'pointer' || !coordinates || view.composing) {
        return;
      }

      const position = view.posAtCoords(coordinates);
      if (position == null) {
        return;
      }

      const insideSelection = view.state.selection.ranges.some(
        (range) =>
          !range.empty && range.from <= position && position < range.to,
      );
      if (!insideSelection) {
        view.dispatch({
          selection: { anchor: position },
          userEvent: 'select.pointer',
        });
      }
    },
    runFormat: (command) => {
      const view = getContextView();
      if (view !== editor.view) {
        return;
      }
      const capabilities = deriveEditCapabilities(editor.view);
      const capability = INSERT_COMMANDS.has(command)
        ? capabilities.canInsert
        : capabilities.canFormat;
      if (
        editor.view.state.readOnly ||
        editor.view.composing ||
        editor.view.state.selection.ranges.length !== 1 ||
        !capability
      ) {
        return;
      }

      applyMarkdownFormatCommand(editor.view, command);
    },
    redo: () => {
      const view = getContextView();
      if (!view.state.readOnly) {
        redo(view);
      }
      focusView(view);
    },
    selectAll: () => {
      const view = getContextView();
      view.dispatch({
        selection: { anchor: 0, head: view.state.doc.length },
        userEvent: 'select.all',
      });
      focusView(view);
      return true;
    },
    revealPosition: (position) => {
      if (
        !Number.isInteger(position) ||
        position < 0 ||
        position > editor.view.state.doc.length
      ) {
        return;
      }

      editor.view.dispatch({
        annotations: Transaction.addToHistory.of(false),
        effects: EditorView.scrollIntoView(position, { y: 'center' }),
        selection: {
          anchor: position,
        },
      });
      editor.focus();
    },
    setDisplayMode: (mode) => {
      editor.setDisplayMode(mode);
    },
    undo: () => {
      const view = getContextView();
      if (!view.state.readOnly) {
        undo(view);
      }
      focusView(view);
    },
  };
}

const INSERT_COMMANDS = new Set<MarkdownFormatCommand>([
  'horizontalRule',
  'image',
  'math',
  'table',
]);

function resolveSearchText(
  view: EditorView,
  explicitQuery: string | undefined,
): string | null {
  if (explicitQuery !== undefined) {
    return isEligibleSearchText(explicitQuery) ? explicitQuery : null;
  }

  const ranges = view.state.selection.ranges;
  if (ranges.length !== 1) {
    return null;
  }

  const { from, to } = ranges[0];
  const selectedText = view.state.doc.sliceString(from, to);
  return isEligibleSearchText(selectedText) ? selectedText : null;
}

function isEligibleSearchText(text: string): boolean {
  return text.length > 0 && text.length <= 100;
}

function replaceSearchText(query: SearchQuery, searchText: string): SearchQuery {
  return new SearchQuery({
    caseSensitive: query.caseSensitive,
    literal: query.literal,
    regexp: query.regexp,
    replace: query.replace,
    search: searchText,
    test: query.test,
    wholeWord: query.wholeWord,
  });
}

function focusSearchInput(view: EditorView): void {
  const searchInput = view.dom.querySelector<HTMLInputElement>(
    '.cm-search [name="search"]',
  );
  searchInput?.focus();
  searchInput?.select();
}

function deriveEditCapabilities(view: EditorView): {
  canFormat: boolean;
  canInsert: boolean;
} {
  const context = deriveEditorInteractionContext(view.state, view.composing);
  const insideUnsafeBlock = context.activeBlocks.some(
    ({ kind }) => kind === 'FencedCode' || kind === 'TableCell',
  );
  const insideImage = context.activeInlineOwners.some(
    ({ kind }) => kind === 'Image',
  );
  const touchesProtectedSource = context.selections.some(({ selection }) =>
    context.protectedSourceRanges.some((range) =>
      selectionTouchesRange(selection, range),
    ),
  );
  const crossesUnsafeBlock = context.selections.some(({ selection }) =>
    selectionTouchesUnsafeBlock(view, selection),
  );
  const canFormat =
    !insideUnsafeBlock &&
    !insideImage &&
    !touchesProtectedSource &&
    !crossesUnsafeBlock;

  return {
    canFormat,
    canInsert: canFormat,
  };
}

function selectionTouchesRange(
  selection: EditorInteractionRange,
  range: EditorInteractionRange,
): boolean {
  return selection.from <= range.to && selection.to >= range.from;
}

function selectionTouchesUnsafeBlock(
  view: EditorView,
  selection: EditorInteractionRange,
): boolean {
  let touchesUnsafeBlock = false;
  syntaxTree(view.state).iterate({
    from: Math.max(0, selection.from - 1),
    to: Math.min(view.state.doc.length, selection.to + 1),
    enter(node) {
      if (
        (node.name === 'FencedCode' || node.name === 'TableCell') &&
        selection.from <= node.to &&
        selection.to >= node.from
      ) {
        touchesUnsafeBlock = true;
        return false;
      }
    },
  });
  return touchesUnsafeBlock;
}

function isAsyncEditTargetCurrent(
  root: EditorView,
  view: EditorView,
  startState: EditorView['state'],
): boolean {
  if (!isEditorViewLive(root, view)) {
    return false;
  }

  const current = view.state;
  return (
    !current.readOnly &&
    !view.composing &&
    current === startState
  );
}

function resolveContextEditorView(
  root: EditorView,
  target: EventTarget | null,
): EditorView {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  const editorDom = element?.closest<HTMLElement>('.cm-editor');
  if (
    !editorDom ||
    (editorDom !== root.dom && !root.dom.contains(editorDom))
  ) {
    return root;
  }

  const view = EditorView.findFromDOM(editorDom);
  return view && isEditorViewLive(root, view) ? view : root;
}

function isEditorViewLive(root: EditorView, view: EditorView): boolean {
  return (
    (view === root || root.dom.contains(view.dom)) &&
    EditorView.findFromDOM(view.dom) === view
  );
}
