import { EditorSelection } from '@codemirror/state';
import { EditorView, ViewPlugin, type EditorView as EditorViewType } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { announceReadOnlyEditAttempt } from '../../core/readOnlyEditAttempt';

export type PendingTableClick = {
  at: number;
  x: number;
  y: number;
};

let pendingTableClick: PendingTableClick | null = null;

export function rememberTablePointerClick(x: number, y: number): void {
  pendingTableClick = {
    at: Date.now(),
    x,
    y,
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

/**
 * Root editor: capture the activating pointer position on table cells.
 * Nested cell editor: after mount, re-resolve caret with CodeMirror posAtCoords.
 */
export function tableCellClickSyncRootExtension(): Extension {
  return EditorView.domEventHandlers({
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
  });
}

export function tableCellClickSyncNestedExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      private applied = false;
      private destroyed = false;

      constructor(private readonly view: EditorViewType) {
        queueMicrotask(() => {
          this.applyIfNeeded();
        });
        requestAnimationFrame(() => {
          this.applyIfNeeded();
        });
      }

      update(): void {
        this.applyIfNeeded();
      }

      destroy(): void {
        this.destroyed = true;
      }

      private applyIfNeeded(): void {
        if (this.applied || this.destroyed) {
          return;
        }

        if (applyPendingTableClickToView(this.view)) {
          this.applied = true;
        }
      }
    },
  );
}
