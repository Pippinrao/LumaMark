import {
  type EditorState,
  Transaction,
} from '@codemirror/state';

export const FENCE_AUTO_CLOSE_INPUT_EVENT = 'input.codeBlockAutoClose';
export const FENCE_AUTO_CLOSE_SELECT_EVENT = 'select.codeBlockAutoClose';

export type FenceAutoCloseBlock = {
  content: string;
  from: number;
  to: number;
};

export function isFenceAutoCloseUserEvent(
  userEvent: string | undefined,
): boolean {
  return (
    userEvent === FENCE_AUTO_CLOSE_INPUT_EVENT ||
    userEvent === FENCE_AUTO_CLOSE_SELECT_EVENT
  );
}

export function activeBlockFromEmptyFenceAutoClose(
  transaction: Transaction,
  findBlockAt: (
    state: EditorState,
    head: number,
  ) => FenceAutoCloseBlock | null,
): { from: number; to: number } | null {
  if (
    !isFenceAutoCloseUserEvent(transaction.annotation(Transaction.userEvent))
  ) {
    return null;
  }

  const head = transaction.newSelection.main.head;
  const block = findBlockAt(transaction.state, head);
  if (!block || block.content.trim() !== '') {
    return null;
  }

  return { from: block.from, to: block.to };
}
