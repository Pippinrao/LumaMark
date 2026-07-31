import type { EditorCapability } from '../editorCapability';
import { EditorState, Transaction, type Text } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { shouldInsertAfterFinalFence } from './codeBlockCommands';
import { codeBlockPreviewExtension } from './codeBlockDecorations';

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

export function createCodeBlockCapability(): EditorCapability {
  return {
    extensions: [
      codeBlockPreviewExtension(),
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
          !hasFinalClosingFenceSyntax(
            transaction.startState,
            finalLine.from,
          )
        ) {
          return transaction;
        }

        return {
          changes: { from: documentLength, insert: `\n${appended}` },
          selection: { anchor: documentLength + appended.length + 1 },
          userEvent: 'input.movePastCodeBlock',
        };
      }),
    ],
    id: 'codeBlock',
  };
}
