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
      dom: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 80,
          bottom: 20,
          width: 80,
          height: 20,
        }),
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

  it('does not consume a pending click whose coordinates miss this nested view', () => {
    const dispatch = vi.fn();
    const view = {
      dispatch,
      posAtCoords: vi.fn(() => 3),
      state: {
        doc: { length: 11 },
        selection: { main: { empty: true, head: 0 } },
      },
      dom: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 40,
          bottom: 20,
          width: 40,
          height: 20,
        }),
      },
    };

    rememberTablePointerClick(80, 12);
    expect(applyPendingTableClickToView(view as never)).toBe(false);
    expect(view.posAtCoords).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(takePendingTablePointerClick()).toEqual({
      at: expect.any(Number),
      x: 80,
      y: 12,
    });
  });
});
