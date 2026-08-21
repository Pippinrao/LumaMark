import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPendingTableClickToView,
  clampPointToRect,
  clearPendingTablePointerClick,
  nearestRectIndex,
  rememberTablePointerClick,
  resolveTableBreakoutClickTarget,
  subscribePendingTablePointerClick,
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

  it('notifies nested-editor listeners when a pending click is remembered', () => {
    const listener = vi.fn();
    const stop = subscribePendingTablePointerClick(listener);
    rememberTablePointerClick(4, 8);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    rememberTablePointerClick(5, 9);
    expect(listener).toHaveBeenCalledTimes(1);
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

  it('maps a breakout-gutter point onto the nearest table cell surface', () => {
    expect(
      nearestRectIndex(
        { x: 180, y: 40 },
        [
          { left: 0, top: 0, right: 80, bottom: 24 },
          { left: 80, top: 0, right: 160, bottom: 24 },
        ],
      ),
    ).toBe(1);
    expect(
      clampPointToRect(
        { x: 180, y: 12 },
        { left: 80, top: 0, right: 160, bottom: 24 },
      ),
    ).toEqual({ x: 159, y: 12 });

    const widget = document.createElement('div');
    widget.className = 'tbl-table-widget';
    const left = document.createElement('td');
    left.className = 'tbl-cell tbl-data-cell';
    left.innerHTML = '<div class="tbl-cell-view">a</div>';
    const right = document.createElement('td');
    right.className = 'tbl-cell tbl-data-cell';
    right.innerHTML = '<div class="tbl-cell-view">b</div>';
    widget.append(left, right);
    document.body.append(widget);
    const leftRect = {
      bottom: 24,
      height: 24,
      left: 0,
      right: 80,
      toJSON: () => leftRect,
      top: 0,
      width: 80,
      x: 0,
      y: 0,
    };
    const rightRect = {
      bottom: 24,
      height: 24,
      left: 80,
      right: 160,
      toJSON: () => rightRect,
      top: 0,
      width: 80,
      x: 80,
      y: 0,
    };
    left.getBoundingClientRect = () => leftRect;
    right.getBoundingClientRect = () => rightRect;
    const rightView = right.querySelector<HTMLElement>('.tbl-cell-view');
    if (!rightView) {
      throw new Error('expected a right cell view');
    }
    rightView.getBoundingClientRect = right.getBoundingClientRect;

    try {
      expect(resolveTableBreakoutClickTarget(rightView, 180, 12)).toBeNull();
      const wrapper = document.createElement('div');
      wrapper.className = 'tbl-table-wrapper';
      widget.append(wrapper);
      expect(resolveTableBreakoutClickTarget(wrapper, 180, 12)?.surface).toBe(
        right,
      );
      const resolved = resolveTableBreakoutClickTarget(widget, 180, 12);
      expect(resolved?.surface).toBe(right);
      expect(resolved?.point).toEqual({ x: 159, y: 12 });
    } finally {
      widget.remove();
    }
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

  it('overwrites a reused nested selection from a previous cell', () => {
    const dispatch = vi.fn();
    const view = {
      dispatch,
      posAtCoords: vi.fn(() => 0),
      state: {
        doc: { length: 3 },
        selection: { main: { empty: true, head: 2 } },
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

    rememberTablePointerClick(8, 10);
    expect(applyPendingTableClickToView(view as never)).toBe(true);
    expect(view.posAtCoords).toHaveBeenCalledWith({ x: 8, y: 10 });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: EditorSelection.cursor(0),
        userEvent: 'select.pointer',
      }),
    );
  });

  it('does not apply a pending click onto the root editor', () => {
    const dispatch = vi.fn();
    const view = {
      dispatch,
      posAtCoords: vi.fn(() => 40),
      state: {
        doc: { length: 80 },
        selection: { main: { empty: true, head: 0 } },
      },
      dom: {
        closest: (selector: string) =>
          selector === '.tbl-cell-editor' ? null : document.body,
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
        }),
      },
    };

    rememberTablePointerClick(40, 12);
    expect(applyPendingTableClickToView(view as never)).toBe(false);
    expect(view.posAtCoords).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(takePendingTablePointerClick()).toEqual({
      at: expect.any(Number),
      x: 40,
      y: 12,
    });
  });
});
