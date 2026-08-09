import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPendingTableClickToView,
  clearPendingTablePointerClick,
  rememberTablePointerClick,
  takePendingTablePointerClick,
} from './tableCellClickSync';

describe('tableCellClickSync', () => {
  afterEach(() => {
    clearPendingTablePointerClick();
    vi.useRealTimers();
  });

  it('remembers and consumes a pending pointer click once', () => {
    rememberTablePointerClick(10, 20);
    expect(takePendingTablePointerClick()).toEqual({
      at: expect.any(Number),
      x: 10,
      y: 20,
    });
    expect(takePendingTablePointerClick()).toBeNull();
  });

  it('drops stale pending clicks', () => {
    vi.useFakeTimers();
    rememberTablePointerClick(1, 2);
    vi.advanceTimersByTime(501);
    expect(takePendingTablePointerClick(500)).toBeNull();
  });

  it('moves the nested caret to posAtCoords for the pending click', () => {
    const dispatch = vi.fn();
    const view = {
      dispatch,
      posAtCoords: vi.fn(() => 6),
      state: {
        doc: { length: 11 },
        selection: { main: { empty: true, head: 0 } },
      },
    };

    rememberTablePointerClick(40, 12);
    expect(applyPendingTableClickToView(view as never)).toBe(true);
    expect(view.posAtCoords).toHaveBeenCalledWith({ x: 40, y: 12 });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: EditorSelection.cursor(6),
        userEvent: 'select.pointer',
      }),
    );
  });
});
