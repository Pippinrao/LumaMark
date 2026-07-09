import {
  applyMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from './markdownFormatCommands';
import { createEditorCapabilityCommands } from '../capabilities';
import type { EditorApi } from '../core/editorApi';
import type { EditorDisplayMode } from '../core/editorDisplayMode';

export type EditorDocumentPort = {
  focus: () => void;
  getText: () => string;
  loadText: (text: string) => void;
  setContext: NonNullable<EditorApi['setDocumentContext']>;
};

export type EditorCommandPort = {
  copyTable: () => void;
  deleteTable: () => void;
  focus: () => void;
  getDisplayMode: () => EditorDisplayMode;
  runFormat: (command: MarkdownFormatCommand) => void;
  selectPosition: (position: number) => void;
  setDisplayMode: (mode: EditorDisplayMode) => void;
};

export function createEditorDocumentPort(editor: EditorApi): EditorDocumentPort {
  return {
    focus: () => editor.focus(),
    getText: () => editor.getDocumentText(),
    loadText: (text) => {
      editor.loadDocument(text);
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
    runFormat: (command) => {
      applyMarkdownFormatCommand(editor.view, command);
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
  };
}
