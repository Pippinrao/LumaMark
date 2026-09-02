import { type EditorSelection, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export const SELECTION_CARET_HIDDEN_CLASS = 'lm-editor-selection-caret-hidden';

export function shouldHideSelectionCaret(selection: EditorSelection): boolean {
  return (
    selection.ranges.length > 0 &&
    selection.ranges.every((range) => !range.empty)
  );
}

export const selectionCaretVisibilityExtension: Extension =
  EditorView.contentAttributes.of((view) =>
    shouldHideSelectionCaret(view.state.selection)
      ? { class: SELECTION_CARET_HIDDEN_CLASS }
      : null,
  );
