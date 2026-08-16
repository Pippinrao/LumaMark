import { EditorState, Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  activeBlockFromEmptyFenceAutoClose,
  FENCE_AUTO_CLOSE_INPUT_EVENT,
  isFenceAutoCloseUserEvent,
} from './fenceAutoClose';

function transactionWithUserEvent(
  doc: string,
  userEvent: string | undefined,
  head: number,
): Transaction {
  const start = EditorState.create({
    doc,
    selection: { anchor: head },
  });
  return start.update({
    selection: { anchor: head },
    userEvent,
  });
}

describe('fence auto-close', () => {
  it('recognizes the code-block auto-close user events', () => {
    expect(isFenceAutoCloseUserEvent('input.codeBlockAutoClose')).toBe(true);
    expect(isFenceAutoCloseUserEvent('select.codeBlockAutoClose')).toBe(true);
    expect(isFenceAutoCloseUserEvent('input.type')).toBe(false);
  });

  it('activates an empty fenced block after auto-close', () => {
    const doc = '```mermaid\n\n```';
    const transaction = transactionWithUserEvent(
      doc,
      FENCE_AUTO_CLOSE_INPUT_EVENT,
      12,
    );

    expect(
      activeBlockFromEmptyFenceAutoClose(transaction, () => ({
        content: '\n',
        from: 0,
        to: doc.length,
      })),
    ).toEqual({ from: 0, to: doc.length });
  });

  it('ignores auto-close when the fenced body already has content', () => {
    const transaction = transactionWithUserEvent(
      '```mermaid\nflowchart TD\n```',
      FENCE_AUTO_CLOSE_INPUT_EVENT,
      12,
    );

    expect(
      activeBlockFromEmptyFenceAutoClose(transaction, () => ({
        content: 'flowchart TD',
        from: 0,
        to: 28,
      })),
    ).toBeNull();
  });
});
