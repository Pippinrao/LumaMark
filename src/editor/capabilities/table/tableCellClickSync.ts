import { EditorSelection, Transaction } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  type EditorView as EditorViewType,
  type ViewUpdate,
} from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { announceReadOnlyEditAttempt } from '../../core/readOnlyEditAttempt';

export type PendingTableClick = {
  at: number;
  x: number;
  y: number;
};

let pendingTableClick: PendingTableClick | null = null;
const pendingTableClickListeners = new Set<() => void>();

export function rememberTablePointerClick(x: number, y: number): void {
  pendingTableClick = {
    at: Date.now(),
    x,
    y,
  };
  for (const listener of pendingTableClickListeners) {
    listener();
  }
}

export function subscribePendingTablePointerClick(listener: () => void): () => void {
  pendingTableClickListeners.add(listener);
  return () => {
    pendingTableClickListeners.delete(listener);
  };
}

export function clearPendingTablePointerClick(): void {
  pendingTableClick = null;
}

export function takePendingTablePointerClick(
  maxAgeMs = 500,
): PendingTableClick | null {
  const value = peekPendingTablePointerClick(maxAgeMs);
  if (!value) {
    return null;
  }

  pendingTableClick = null;
  return value;
}

export function peekPendingTablePointerClick(
  maxAgeMs = 500,
): PendingTableClick | null {
  if (!pendingTableClick) {
    return null;
  }

  if (Date.now() - pendingTableClick.at > maxAgeMs) {
    pendingTableClick = null;
    return null;
  }

  return pendingTableClick;
}

export function discardPendingTableClickForUserEdit(
  userEvent: string | undefined,
): void {
  if (!userEvent) {
    return;
  }

  if (
    userEvent === 'input' ||
    userEvent.startsWith('input.') ||
    userEvent === 'delete' ||
    userEvent.startsWith('delete.')
  ) {
    pendingTableClick = null;
  }
}

export type ClientPoint = {
  x: number;
  y: number;
};

export type ClientRectLike = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export function distanceFromPointToRect(
  point: ClientPoint,
  rect: ClientRectLike,
): number {
  const dx =
    point.x < rect.left
      ? rect.left - point.x
      : point.x > rect.right
        ? point.x - rect.right
        : 0;
  const dy =
    point.y < rect.top
      ? rect.top - point.y
      : point.y > rect.bottom
        ? point.y - rect.bottom
        : 0;
  return Math.hypot(dx, dy);
}

export function clampPointToRect(
  point: ClientPoint,
  rect: ClientRectLike,
): ClientPoint {
  const insetLeft = Math.min(rect.left + 1, rect.right);
  const insetRight = Math.max(rect.right - 1, insetLeft);
  const insetTop = Math.min(rect.top + 1, rect.bottom);
  const insetBottom = Math.max(rect.bottom - 1, insetTop);
  return {
    x: Math.min(Math.max(point.x, insetLeft), insetRight),
    y: Math.min(Math.max(point.y, insetTop), insetBottom),
  };
}

export function nearestRectIndex(
  point: ClientPoint,
  rects: readonly ClientRectLike[],
): number {
  if (rects.length === 0) {
    return -1;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rects.length; index += 1) {
    const distance = distanceFromPointToRect(point, rects[index]!);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }

  return bestIndex;
}

const TABLE_BREAKOUT_CELL_SELECTOR = '.tbl-data-cell, .tbl-header-cell';

export function resolveTableBreakoutClickTarget(
  eventTarget: EventTarget | null,
  clientX: number,
  clientY: number,
): { point: ClientPoint; surface: HTMLElement } | null {
  if (!(eventTarget instanceof HTMLElement)) {
    return null;
  }

  const widget = eventTarget.closest('.tbl-table-widget');
  if (!(widget instanceof HTMLElement)) {
    return null;
  }

  if (
    eventTarget.closest(
      '.tbl-cell-view, .tbl-data-cell, .tbl-header-cell, .tbl-cell-editor, .tbl-handle, .tbl-menu, .tbl-menu-tooltip',
    )
  ) {
    return null;
  }

  const cells = [
    ...widget.querySelectorAll<HTMLElement>(TABLE_BREAKOUT_CELL_SELECTOR),
  ];
  if (cells.length === 0) {
    return null;
  }

  const rects = cells.map((cell) => cell.getBoundingClientRect());
  const index = nearestRectIndex({ x: clientX, y: clientY }, rects);
  const cell = cells[index];
  if (!cell) {
    return null;
  }

  const surface = cell;
  return {
    point: clampPointToRect(
      { x: clientX, y: clientY },
      surface.getBoundingClientRect(),
    ),
    surface,
  };
}

function clientPointHitsView(
  view: EditorViewType,
  x: number,
  y: number,
): boolean {
  const rect = view.dom.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function applyPendingTableClickToView(view: EditorViewType): boolean {
  const click = peekPendingTablePointerClick();
  if (!click) {
    return false;
  }

  if (!isNestedTableCellEditorView(view)) {
    return false;
  }

  if (!clientPointHitsView(view, click.x, click.y)) {
    return false;
  }

  const position = view.posAtCoords({ x: click.x, y: click.y });
  if (position == null) {
    return false;
  }

  pendingTableClick = null;
  const next = Math.max(0, Math.min(position, view.state.doc.length));
  if (view.state.selection.main.head === next && view.state.selection.main.empty) {
    return true;
  }

  view.dispatch({
    selection: EditorSelection.cursor(next),
    userEvent: 'select.pointer',
  });
  return true;
}

function isNestedTableCellEditorView(view: EditorViewType): boolean {
  const dom = view.dom as { closest?: (selector: string) => Element | null };
  if (typeof dom.closest !== 'function') {
    return true;
  }

  return Boolean(dom.closest('.tbl-cell-editor'));
}

/**
 * Root editor: capture the activating pointer position on table cells.
 * Nested cell editor: after mount, re-resolve caret with CodeMirror posAtCoords.
 */
const tableBreakoutGutterClickPlugin = ViewPlugin.fromClass(
  class {
    private readonly onPointerDown: (event: PointerEvent) => void;

    constructor(private readonly view: EditorViewType) {
      this.onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) {
          return;
        }

        if (!event.isTrusted) {
          return;
        }

        const target = event.target;
        if (!(target instanceof Element) || !target.closest('.tbl-table-widget')) {
          return;
        }

        if (this.view.state.readOnly) {
          if (
            target.closest(
              '.tbl-cell-view, .tbl-data-cell, .tbl-header-cell, .tbl-cell-editor',
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
            announceReadOnlyEditAttempt(this.view);
          }
          return;
        }

        // Capture-phase remember: nested editors and the table library can
        // stop the bubble before EditorView.domEventHandlers run.
        rememberTablePointerClick(event.clientX, event.clientY);

        const resolved = resolveTableBreakoutClickTarget(
          event.target,
          event.clientX,
          event.clientY,
        );
        if (!resolved) {
          return;
        }

        const rect = resolved.surface.getBoundingClientRect();
        const mapped = this.view.posAtCoords({
          x: (rect.left + rect.right) / 2,
          y: (rect.top + rect.bottom) / 2,
        });
        rememberTablePointerClick(resolved.point.x, resolved.point.y);
        if (mapped == null) {
          return;
        }

        const next = Math.max(0, Math.min(mapped, this.view.state.doc.length));
        this.view.dispatch({
          selection: EditorSelection.cursor(next),
          userEvent: 'select.pointer',
        });
      };
      view.dom.addEventListener('pointerdown', this.onPointerDown, true);
    }

    destroy(): void {
      this.view.dom.removeEventListener('pointerdown', this.onPointerDown, true);
    }
  },
);

export function tableCellClickSyncRootExtension(): Extension {
  return [
    tableBreakoutGutterClickPlugin,
    EditorView.domEventHandlers({
      pointerdown(event, view) {
        const target = event.target;
        if (!(target instanceof Element)) {
          return false;
        }

        if (
          !target.closest(
            '.tbl-cell-view, .tbl-data-cell, .tbl-header-cell, .tbl-cell-editor',
          )
        ) {
          return false;
        }

        if (event.button !== 0) {
          return false;
        }

        // Reading mode must not mount nested cell editors. Upstream tables still
        // listen for the same click; stopPropagation keeps that path closed.
        if (view.state.readOnly) {
          event.preventDefault();
          event.stopPropagation();
          announceReadOnlyEditAttempt(view);
          return true;
        }

        rememberTablePointerClick(event.clientX, event.clientY);
        return false;
      },
    }),
  ];
}

export function tableCellClickSyncNestedExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      private lastAppliedAt = 0;
      private lastPendingAt = 0;
      private retries = 0;
      private destroyed = false;
      private scheduled = false;
      private readonly unsubscribe: () => void;

      constructor(private readonly view: EditorViewType) {
        this.unsubscribe = subscribePendingTablePointerClick(() => {
          this.scheduleApply();
        });
        this.scheduleApply();
      }

      update(update: ViewUpdate): void {
        for (const transaction of update.transactions) {
          discardPendingTableClickForUserEdit(
            transaction.annotation(Transaction.userEvent),
          );
        }

        const pending = peekPendingTablePointerClick();
        if (!pending || pending.at === this.lastAppliedAt) {
          return;
        }

        // The table library reuses one nested EditorView across cells. The
        // plugin instance therefore survives Alice → Bob, and dispatching
        // from update() is illegal. Replay the new gesture after this update.
        this.scheduleApply();
      }

      destroy(): void {
        this.destroyed = true;
        this.unsubscribe();
      }

      private scheduleApply(): void {
        if (this.scheduled || this.destroyed) {
          return;
        }

        this.scheduled = true;
        queueMicrotask(() => {
          this.scheduled = false;
          this.applyIfNeeded();
        });
        requestAnimationFrame(() => {
          this.applyIfNeeded();
        });
      }

      private applyIfNeeded(): void {
        if (this.destroyed) {
          return;
        }

        const pending = peekPendingTablePointerClick();
        if (!pending || pending.at === this.lastAppliedAt) {
          return;
        }

        if (pending.at !== this.lastPendingAt) {
          this.lastPendingAt = pending.at;
          this.retries = 0;
        }

        if (applyPendingTableClickToView(this.view)) {
          this.lastAppliedAt = pending.at;
          return;
        }

        this.retries += 1;
        if (this.retries < 4) {
          requestAnimationFrame(() => {
            this.applyIfNeeded();
          });
        }
      }
    },
  );
}
