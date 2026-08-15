import {
  applyMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from './markdownFormatCommands';
import { Transaction } from '@codemirror/state';
import { redo, undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { createEditorCapabilityCommands } from '../capabilities';
import type {
  EditorApi,
  EditorDocumentSnapshot,
  LoadDocumentOptions,
} from '../core/editorApi';
import type { EditorDisplayMode } from '../core/editorDisplayMode';
import type { EditorInteractionRange } from '../interaction';

export type EditorEditState = {
  clipboardReadAvailable: boolean;
  clipboardWriteAvailable: boolean;
  readOnly: boolean;
  selectionEmpty: boolean;
};

export type EditorClipboardError = {
  cause: unknown;
  operation: 'copy' | 'cut' | 'paste';
};

export type EditorClipboardTextPort = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
};

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
  copy: () => Promise<boolean>;
  copyTable: (range?: EditorInteractionRange) => Promise<boolean>;
  cut: () => Promise<boolean>;
  deleteImageReference: (range: { from: number; to: number }) => void;
  deleteTable: (range?: EditorInteractionRange) => boolean;
  focus: () => void;
  getDisplayMode: () => EditorDisplayMode;
  getEditState: () => EditorEditState;
  insertImages: (
    images: readonly { alt: string; markdownSource: string }[],
    position?: { x: number; y: number },
  ) => void;
  openSearch: () => void;
  paste: () => Promise<boolean>;
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

  return {
    copy: async () => {
      const { main } = editor.view.state.selection;
      const clipboard = resolveClipboard();
      if (main.empty || !clipboard?.writeText) {
        return false;
      }

      try {
        await clipboard.writeText(
          editor.view.state.doc.sliceString(main.from, main.to),
        );
        editor.focus();
        return true;
      } catch (cause) {
        reportClipboardError('copy', cause);
        editor.focus();
        return false;
      }
    },
    copyTable: async (range) => {
      const clipboard = resolveClipboard();
      if (typeof clipboard?.writeText !== 'function') {
        reportClipboardError(
          'copy',
          new Error('The Clipboard API is unavailable.'),
        );
        editor.focus();
        return false;
      }

      try {
        const copied = await createEditorCapabilityCommands(editor.view, {
          writeClipboardText: (text) => clipboard.writeText!(text),
        }).copyTable(range);
        if (copied) {
          editor.focus();
        }
        return copied;
      } catch (cause) {
        reportClipboardError('copy', cause);
        editor.focus();
        return false;
      }
    },
    cut: async () => {
      const startState = editor.view.state;
      const { main } = startState.selection;
      const clipboard = resolveClipboard();
      if (startState.readOnly || main.empty || !clipboard?.writeText) {
        return false;
      }

      try {
        await clipboard.writeText(
          startState.doc.sliceString(main.from, main.to),
        );
      } catch (cause) {
        reportClipboardError('cut', cause);
        editor.focus();
        return false;
      }

      if (!isAsyncEditTargetCurrent(editor, startState)) {
        reportClipboardError(
          'cut',
          new Error(
            'The document or selection changed before the cut could be applied.',
          ),
        );
        editor.focus();
        return false;
      }

      editor.view.dispatch({
        changes: { from: main.from, to: main.to },
        selection: { anchor: main.from },
        userEvent: 'delete.cut',
      });
      editor.focus();
      return true;
    },
    deleteImageReference: (range) => {
      if (editor.view.state.readOnly) {
        return;
      }

      if (createEditorCapabilityCommands(editor.view).deleteImageReference(range)) {
        editor.focus();
      }
    },
    deleteTable: (range) => {
      if (editor.view.state.readOnly) {
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
      const clipboard = resolveClipboard();
      return {
        clipboardReadAvailable: typeof clipboard?.readText === 'function',
        clipboardWriteAvailable: typeof clipboard?.writeText === 'function',
        readOnly: editor.view.state.readOnly,
        selectionEmpty: editor.view.state.selection.main.empty,
      };
    },
    insertImages: (images, position) => {
      if (editor.view.state.readOnly) {
        return;
      }

      createEditorCapabilityCommands(editor.view).insertImages(images, position);
    },
    openSearch: () => {
      openSearchPanel(editor.view);
    },
    paste: async () => {
      const startState = editor.view.state;
      const { main } = startState.selection;
      const clipboard = resolveClipboard();
      if (startState.readOnly || !clipboard?.readText) {
        return false;
      }

      let text: string;
      try {
        text = await clipboard.readText();
      } catch (cause) {
        reportClipboardError('paste', cause);
        editor.focus();
        return false;
      }

      if (!isAsyncEditTargetCurrent(editor, startState)) {
        reportClipboardError(
          'paste',
          new Error(
            'The document or selection changed before the paste could be applied.',
          ),
        );
        editor.focus();
        return false;
      }

      editor.view.dispatch({
        changes: { from: main.from, insert: text, to: main.to },
        selection: { anchor: main.from + text.length },
        userEvent: 'input.paste',
      });
      editor.focus();
      return true;
    },
    runFormat: (command) => {
      applyMarkdownFormatCommand(editor.view, command);
    },
    redo: () => {
      redo(editor.view);
      editor.focus();
    },
    selectAll: () => {
      editor.view.dispatch({
        selection: { anchor: 0, head: editor.view.state.doc.length },
        userEvent: 'select.all',
      });
      editor.focus();
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
      undo(editor.view);
      editor.focus();
    },
  };
}

function isAsyncEditTargetCurrent(
  editor: EditorApi,
  startState: EditorApi['view']['state'],
): boolean {
  const current = editor.view.state;
  return (
    !current.readOnly &&
    current.doc.eq(startState.doc) &&
    current.selection.eq(startState.selection)
  );
}
