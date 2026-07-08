import {
  applyMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from './markdownFormatCommands';
import type { EditorApi } from '../core/editorApi';
import type { EditorDisplayMode } from '../core/editorDisplayMode';
import {
  copyCurrentMarkdownTable,
  deleteCurrentMarkdownTable,
} from '../widgets/table/tableCommands';

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
      void copyCurrentMarkdownTable(editor.view);
    },
    deleteTable: () => {
      if (deleteCurrentMarkdownTable(editor.view)) {
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
