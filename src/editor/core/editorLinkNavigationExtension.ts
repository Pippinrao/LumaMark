import {
  forceParsing,
  language,
  syntaxTreeAvailable,
} from '@codemirror/language';
import type { Extension, Text } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  advanceEditorReferenceIndex,
  isEditorReferenceIndexReady,
  resolveEditorLinkHref,
} from '../interaction/editorLinkTarget';

export type EditorLinkNavigationRequestHandler = (href: string) => void;

type PendingLinkGesture = {
  doc: Text;
  href: string;
  x: number;
  y: number;
};

const MAX_LINK_CLICK_DISTANCE_PX = 3;
const REFERENCE_PARSE_SLICE_MS = 4;
const REFERENCE_INDEX_IDLE_TIMEOUT_MS = 50;

type IdleDeadline = {
  timeRemaining: () => number;
};

type IdleCapableWindow = Window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: (deadline: IdleDeadline) => void,
    options?: { timeout: number },
  ) => number;
};

type ReferenceWarmupSchedule = {
  handle: number;
  kind: 'idle' | 'timeout';
};

export function editorLinkNavigationExtension(
  onLinkNavigationRequest: EditorLinkNavigationRequestHandler,
  isMacPlatform = /Mac/i.test(navigator.userAgent),
): Extension {
  return ViewPlugin.define(
    (view) =>
      new LinkNavigationGesture(
        view,
        onLinkNavigationRequest,
        isMacPlatform,
      ),
    {
      eventHandlers: {
        click(event) {
          return this.consumeSyntheticClick(event);
        },
        mousedown(event, view) {
          return this.begin(event, view);
        },
      },
    },
  );
}

class LinkNavigationGesture {
  private cleanupOwnerListeners: (() => void) | null = null;
  private destroyed = false;
  private pending: PendingLinkGesture | null = null;
  private referenceWarmupSchedule: ReferenceWarmupSchedule | null = null;
  private suppressClick = false;
  private suppressClickTimer: number | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly onLinkNavigationRequest: EditorLinkNavigationRequestHandler,
    private readonly isMacPlatform: boolean,
  ) {
    this.scheduleReferenceWarmup();
  }

  begin(event: MouseEvent, view: EditorView): boolean {
    this.cancel();
    if (
      view.composing ||
      !isExactPrimaryModifier(event, this.isMacPlatform)
    ) {
      return false;
    }
    const position = view.posAtCoords({
      x: event.clientX,
      y: event.clientY,
    });
    const href = position === null
      ? null
      : resolveEditorLinkHref(view.state, position);
    if (!href) {
      return false;
    }

    event.preventDefault();
    this.pending = {
      doc: view.state.doc,
      href,
      x: event.clientX,
      y: event.clientY,
    };
    this.installOwnerListeners();
    return true;
  }

  consumeSyntheticClick(event: MouseEvent): boolean {
    if (!this.suppressClick) {
      return false;
    }
    this.clearClickSuppression();
    event.preventDefault();
    return true;
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.cancel();
      this.cancelReferenceWarmup();
      this.scheduleReferenceWarmup();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.cancel();
    this.cancelReferenceWarmup();
    this.clearClickSuppression();
  }

  private scheduleReferenceWarmup(): void {
    if (
      this.destroyed ||
      this.referenceWarmupSchedule !== null ||
      isEditorReferenceIndexReady(this.view.state)
    ) {
      return;
    }

    const ownerWindow = this.view.dom.ownerDocument
      .defaultView as IdleCapableWindow | null;
    if (!ownerWindow) {
      return;
    }

    if (ownerWindow.requestIdleCallback) {
      this.referenceWarmupSchedule = {
        handle: ownerWindow.requestIdleCallback(
          (deadline) => {
            this.referenceWarmupSchedule = null;
            this.continueReferenceWarmup(deadline.timeRemaining());
          },
          { timeout: REFERENCE_INDEX_IDLE_TIMEOUT_MS },
        ),
        kind: 'idle',
      };
      return;
    }

    this.referenceWarmupSchedule = {
      handle: ownerWindow.setTimeout(() => {
        this.referenceWarmupSchedule = null;
        this.continueReferenceWarmup(REFERENCE_PARSE_SLICE_MS);
      }, 0),
      kind: 'timeout',
    };
  }

  private continueReferenceWarmup(availableMs: number): void {
    if (this.destroyed || isEditorReferenceIndexReady(this.view.state)) {
      return;
    }
    if (this.view.state.facet(language) === null) {
      return;
    }

    const workBudgetMs = Math.max(
      1,
      Math.min(REFERENCE_PARSE_SLICE_MS, availableMs),
    );
    if (!syntaxTreeAvailable(this.view.state, this.view.state.doc.length)) {
      forceParsing(
        this.view,
        this.view.state.doc.length,
        workBudgetMs,
      );
      this.scheduleReferenceWarmup();
      return;
    }

    const status = advanceEditorReferenceIndex(this.view.state, {
      maxWorkMs: workBudgetMs,
    });
    if (status !== 'ready') {
      this.scheduleReferenceWarmup();
    }
  }

  private cancelReferenceWarmup(): void {
    const schedule = this.referenceWarmupSchedule;
    if (!schedule) {
      return;
    }

    const ownerWindow = this.view.dom.ownerDocument
      .defaultView as IdleCapableWindow | null;
    if (schedule.kind === 'idle') {
      ownerWindow?.cancelIdleCallback?.(schedule.handle);
    } else {
      ownerWindow?.clearTimeout(schedule.handle);
    }
    this.referenceWarmupSchedule = null;
  }

  private installOwnerListeners(): void {
    const ownerDocument = this.view.dom.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const handleMouseUp = (event: MouseEvent) => {
      const pending = this.pending;
      const releasePosition = this.view.posAtCoords({
        x: event.clientX,
        y: event.clientY,
      });
      const releaseHref = releasePosition === null
        ? null
        : resolveEditorLinkHref(this.view.state, releasePosition);
      const valid =
        pending !== null &&
        !this.destroyed &&
        !this.view.composing &&
        isExactPrimaryModifier(event, this.isMacPlatform) &&
        this.view.state.doc.eq(pending.doc) &&
        releaseHref === pending.href &&
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <=
          MAX_LINK_CLICK_DISTANCE_PX;
      this.cancel();
      if (!valid || !pending) {
        return;
      }

      event.preventDefault();
      this.suppressClick = true;
      this.suppressClickTimer = ownerWindow?.setTimeout(() => {
        this.clearClickSuppression();
      }, 0) ?? null;
      this.onLinkNavigationRequest(pending.href);
    };
    const handleCancel = () => {
      this.cancel();
    };

    ownerDocument.addEventListener('mouseup', handleMouseUp, true);
    ownerDocument.addEventListener('pointercancel', handleCancel, true);
    ownerWindow?.addEventListener('blur', handleCancel, true);
    this.cleanupOwnerListeners = () => {
      ownerDocument.removeEventListener('mouseup', handleMouseUp, true);
      ownerDocument.removeEventListener('pointercancel', handleCancel, true);
      ownerWindow?.removeEventListener('blur', handleCancel, true);
    };
  }

  private cancel(): void {
    this.pending = null;
    this.cleanupOwnerListeners?.();
    this.cleanupOwnerListeners = null;
  }

  private clearClickSuppression(): void {
    if (this.suppressClickTimer !== null) {
      this.view.dom.ownerDocument.defaultView?.clearTimeout(
        this.suppressClickTimer,
      );
      this.suppressClickTimer = null;
    }
    this.suppressClick = false;
  }
}

function isExactPrimaryModifier(
  event: MouseEvent,
  isMacPlatform: boolean,
): boolean {
  const primaryModifier = isMacPlatform
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  return (
    event.button === 0 &&
    primaryModifier &&
    !event.altKey &&
    !event.shiftKey &&
    !event.getModifierState('AltGraph')
  );
}
