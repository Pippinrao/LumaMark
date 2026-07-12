import type { EditorCapability } from '../editorCapability';
import { EditorState } from '@codemirror/state';
import { shouldInsertAfterFinalFence } from './codeBlockCommands';
import { codeBlockPreviewExtension } from './codeBlockDecorations';

export function createCodeBlockCapability(): EditorCapability {
  return {
    extensions: [
      codeBlockPreviewExtension(),
      EditorState.transactionFilter.of((transaction) => {
        if (!transaction.docChanged) {
          return transaction;
        }

        const before = transaction.startState.doc.toString();
        const after = transaction.newDoc.toString();
        const appended = after.slice(before.length);

        if (
          !after.startsWith(before) ||
          !appended ||
          !shouldInsertAfterFinalFence({
            document: before,
            from: before.length,
            to: before.length,
          })
        ) {
          return transaction;
        }

        return {
          changes: { from: before.length, insert: `\n${appended}` },
          selection: { anchor: before.length + appended.length + 1 },
          userEvent: 'input.movePastCodeBlock',
        };
      }),
    ],
    id: 'codeBlock',
  };
}
