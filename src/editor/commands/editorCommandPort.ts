import {
  applyMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from './markdownFormatCommands';
import { redo, undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { createEditorCapabilityCommands } from '../capabilities';
import type {
  EditorApi,
  EditorDocumentSnapshot,
  LoadDocumentOptions,
} from '../core/editorApi';
import type { EditorDisplayMode } from '../core/editorDisplayMode';

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
};

export type EditorCommandPort = {
  copyTable: () => void;
  deleteTable: () => void;
  focus: () => void;
  getDisplayMode: () => EditorDisplayMode;
  insertImages: (
    images: readonly { alt: string; markdownSource: string }[],
    position?: { x: number; y: number },
  ) => void;
  openSearch: () => void;
  runFormat: (command: MarkdownFormatCommand) => void;
  redo: () => void;
  selectPosition: (position: number) => void;
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
  };
}

export function createEditorCommandPort(editor: EditorApi): EditorCommandPort {
  return {
    copyTable: () => {
      void createEditorCapabilityCommands(editor.view).copyTable();
    },
    deleteTable: () => {
      if (createEditorCapabilityCommands(editor.view).deleteTable()) {
        editor.focus();
      }
    },
    focus: () => editor.focus(),
    getDisplayMode: () => editor.getDisplayMode(),
    insertImages: (images, position) => {
      createEditorCapabilityCommands(editor.view).insertImages(images, position);
    },
    openSearch: () => {
      openSearchPanel(editor.view);
    },
    runFormat: (command) => {
      applyMarkdownFormatCommand(editor.view, command);
    },
    redo: () => {
      if (redo(editor.view)) {
        editor.focus();
      }
    },
    selectPosition: (position) => {
      editor.view.dispatch({
        scrollIntoView: true,
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
      if (undo(editor.view)) {
        editor.focus();
      }
    },
  };
}
