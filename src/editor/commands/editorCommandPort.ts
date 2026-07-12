import {
  applyMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from './markdownFormatCommands';
import { redo, undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { createEditorCapabilityCommands } from '../capabilities';
import type { EditorApi, LoadDocumentOptions } from '../core/editorApi';
import type { EditorDisplayMode } from '../core/editorDisplayMode';

export type EditorDocumentPort = {
  focus: () => void;
  getText: () => string;
  loadText: (text: string, options?: LoadDocumentOptions) => void;
  refreshImages?: (path: string) => void;
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
    focus: () => editor.focus(),
    getText: () => editor.getDocumentText(),
    loadText: (text, options) => {
      editor.loadDocument(text, options);
    },
    refreshImages: (path) => {
      createEditorCapabilityCommands(editor.view).refreshImages(path);
    },
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
