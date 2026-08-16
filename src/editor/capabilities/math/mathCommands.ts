import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  editorMathPreferencesField,
  setEditorMathPreferencesEffect,
} from './mathPreferences';

export function createMathCommands(view: EditorView): {
  insertMathBlock(): boolean;
  refreshMath(): boolean;
} {
  return {
    insertMathBlock: () => insertMathBlock(view),
    refreshMath: () => refreshMath(view),
  };
}

export function insertMathBlock(view: EditorView): boolean {
  if (view.state.readOnly) {
    return false;
  }

  const selection = view.state.selection.main;
  const insert = '$$\n\n$$';
  view.dispatch({
    changes: {
      from: selection.from,
      insert,
      to: selection.to,
    },
    selection: EditorSelection.cursor(selection.from + 3),
    userEvent: 'input',
  });
  view.focus();
  return true;
}

export function refreshMath(view: EditorView): boolean {
  const preferences = view.state.field(editorMathPreferencesField);
  view.dispatch({
    effects: setEditorMathPreferencesEffect.of({ ...preferences }),
  });
  return true;
}
