import { syntaxTree } from '@codemirror/language';
import {
  EditorState,
  type Extension,
  Prec,
  type Text,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import { type Command, keymap } from '@codemirror/view';
import { shouldInsertAfterFinalFence } from './codeBlockCommands';

type OpeningFence = {
  indent: string;
  marker: string;
};

export function codeBlockInputExtension(): Extension {
  return [
    Prec.high(
      keymap.of([
        {
          key: 'Enter',
          run: completeOpeningFenceOnEnter,
        },
      ]),
    ),
    EditorState.transactionFilter.of((transaction) => {
      if (!transaction.docChanged) {
        return transaction;
      }

      const appended = tailTyping(transaction);

      if (!appended) {
        return transaction;
      }

      const documentLength = transaction.startState.doc.length;
      const finalLine = transaction.startState.doc.lineAt(documentLength);

      if (
        !shouldInsertAfterFinalFence({
          document: finalLine.text,
          from: finalLine.length,
          to: finalLine.length,
        }) ||
        !hasFinalClosingFenceSyntax(transaction.startState, finalLine.from)
      ) {
        return transaction;
      }

      return appendSequentialChange(transaction, 'input.movePastCodeBlock', {
        changes: { from: documentLength, insert: '\n' },
        selection: { anchor: documentLength + appended.length + 1 },
      });
    }),
  ];
}

const completeOpeningFenceOnEnter: Command = (view) => {
  const selection = view.state.selection;

  if (
    view.compositionStarted ||
    view.state.readOnly ||
    selection.ranges.length !== 1 ||
    !selection.main.empty
  ) {
    return false;
  }

  const caret = selection.main.head;
  const line = view.state.doc.lineAt(caret);

  if (caret !== line.to) {
    return false;
  }

  const openingFence = findUnclosedOpeningFence(
    view.state,
    line.from,
    line.to,
  );

  if (!openingFence) {
    return false;
  }

  const newline = view.state.lineBreak;
  const bodyPrefix = `${newline}${openingFence.indent}`;
  const closingSuffix = `${newline}${openingFence.indent}${openingFence.marker}`;

  view.dispatch({
    changes: { from: caret, insert: `${bodyPrefix}${closingSuffix}` },
    scrollIntoView: true,
    selection: { anchor: caret + bodyPrefix.length },
    userEvent: 'input.codeBlockAutoClose',
  });
  // CodeMirror records a change event's pre-change selection. Capturing the
  // explicit post-change selection on that same history event makes redo
  // restore the editable body instead of mapping the caret past the close.
  view.dispatch({
    selection: view.state.selection,
    userEvent: 'select.codeBlockAutoClose',
  });

  return true;
};

function appendSequentialChange(
  transaction: Transaction,
  userEvent: string,
  additionalSpec: Pick<TransactionSpec, 'changes' | 'selection'>,
): readonly TransactionSpec[] {
  // Keeping the original Transaction as a spec preserves every annotation,
  // including capability-owned sentinels that cannot be enumerated through
  // the public API. The final sequential spec lets CodeMirror map effects and
  // selections through the added text with its native transaction machinery.
  return [
    { annotations: Transaction.userEvent.of(userEvent) },
    transaction,
    { ...additionalSpec, sequential: true },
  ];
}

function hasFinalClosingFenceSyntax(
  state: EditorState,
  finalLineFrom: number,
): boolean {
  let hasClosingFence = false;

  syntaxTree(state).iterate({
    from: finalLineFrom,
    to: state.doc.length,
    enter: (node) => {
      if (node.name !== 'CodeMark') {
        return;
      }

      const fencedCode = node.node.parent;
      const openingFence = fencedCode?.firstChild;

      if (
        fencedCode?.name === 'FencedCode' &&
        openingFence?.name === 'CodeMark' &&
        (node.from !== openingFence.from || node.to !== openingFence.to)
      ) {
        hasClosingFence = true;
      }
    },
  });

  return hasClosingFence;
}

function tailTyping(transaction: Transaction): string | null {
  const selection = transaction.startState.selection;
  const documentLength = transaction.startState.doc.length;
  const userEvent = transaction.annotation(Transaction.userEvent);

  // Exact equality intentionally excludes CodeMirror's
  // input.type.compose(.start) IME transactions.
  if (
    (userEvent !== 'input' && userEvent !== 'input.type') ||
    selection.ranges.length !== 1 ||
    !selection.main.empty ||
    selection.main.head !== documentLength
  ) {
    return null;
  }

  const tailChange: { inserted: Text | null } = { inserted: null };
  let changeCount = 0;

  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    changeCount += 1;

    if (fromA === documentLength && toA === documentLength) {
      tailChange.inserted = text;
    }
  });

  return changeCount === 1 && tailChange.inserted?.length
    ? tailChange.inserted.toString()
    : null;
}

function findUnclosedOpeningFence(
  state: EditorState,
  lineFrom: number,
  lineTo: number,
): OpeningFence | null {
  const lineText = state.doc.sliceString(lineFrom, lineTo);
  const match = lineText.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);

  if (!match) {
    return null;
  }

  const indent = match[1];
  const marker = match[2];
  const info = match[3];

  if (marker.startsWith('`') && info.includes('`')) {
    return null;
  }

  const markerFrom = lineFrom + indent.length;
  const markerTo = markerFrom + marker.length;
  let isOpeningFence = false;
  let hasClosingFence = false;

  syntaxTree(state).iterate({
    from: markerFrom,
    to: markerTo,
    enter(node) {
      if (node.name !== 'FencedCode') {
        return;
      }

      const openingMark = node.node.firstChild;

      if (
        openingMark?.name !== 'CodeMark' ||
        openingMark.from !== markerFrom ||
        openingMark.to !== markerTo
      ) {
        return;
      }

      isOpeningFence = true;

      for (
        let child = openingMark.nextSibling;
        child;
        child = child.nextSibling
      ) {
        if (child.name === 'CodeMark') {
          hasClosingFence = true;
          break;
        }
      }
    },
  });

  return isOpeningFence && !hasClosingFence
    ? { indent, marker }
    : null;
}
