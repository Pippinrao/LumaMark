import { indentLess, indentMore } from '@codemirror/commands';
import { EditorSelection, Prec, type Extension } from '@codemirror/state';
import { keymap, type Command, type EditorView } from '@codemirror/view';
import { deriveEditorInteractionContext } from './editorInteractionContext';

function canEditOrdinaryParagraphs(view: EditorView): boolean {
  const { state } = view;

  if (state.readOnly) {
    return false;
  }

  const context = deriveEditorInteractionContext(
    state,
    view.composing,
  );

  if (context.composition) {
    return false;
  }

  return context.selections.every((selection) => {
    if (
      selection.crossesBlocks ||
      selection.block?.kind !== 'Paragraph'
    ) {
      return false;
    }

    if (selection.selection.from !== selection.selection.to) {
      return true;
    }

    return (
      state.doc.lineAt(selection.selection.from).text.trim().length > 0
    );
  });
}

function replaceSelectionsWithLineBreaks(
  view: EditorView,
  lineBreaks: string,
): boolean {
  if (!canEditOrdinaryParagraphs(view)) {
    return false;
  }

  const { state } = view;
  const changes = state.changeByRange((range) => ({
    changes: {
      from: range.from,
      insert: lineBreaks,
      to: range.to,
    },
    range: EditorSelection.cursor(range.from + lineBreaks.length),
  }));

  view.dispatch(
    state.update(changes, {
      scrollIntoView: true,
      userEvent: 'input',
    }),
  );

  return true;
}

function canIndentListItems(view: EditorView): boolean {
  const { state } = view;

  if (state.readOnly) {
    return false;
  }

  const context = deriveEditorInteractionContext(
    state,
    view.composing,
  );

  return (
    !context.composition &&
    context.selections.every(
      (selection) =>
        !selection.crossesBlocks &&
        selection.block?.kind === 'ListItem',
    )
  );
}

export const insertParagraphBreak: Command = (view) =>
  replaceSelectionsWithLineBreaks(view, '\n\n');

export const insertSoftLineBreak: Command = (view) =>
  replaceSelectionsWithLineBreaks(view, '\n');

export const indentListItems: Command = (view) =>
  canIndentListItems(view) ? indentMore(view) : false;

export const unindentListItems: Command = (view) =>
  canIndentListItems(view) ? indentLess(view) : false;

export function paragraphEditingKeymap(): Extension {
  return Prec.high(
    keymap.of([
      {
        key: 'Enter',
        run: insertParagraphBreak,
      },
      {
        key: 'Shift-Enter',
        run: insertSoftLineBreak,
      },
      {
        key: 'Tab',
        run: indentListItems,
      },
      {
        key: 'Shift-Tab',
        run: unindentListItems,
      },
    ]),
  );
}
