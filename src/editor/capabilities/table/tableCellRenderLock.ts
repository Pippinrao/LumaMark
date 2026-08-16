import {
  EditorState,
  Facet,
  StateEffect,
  StateField,
  Transaction,
  type Transaction as EditorTransaction,
  type Extension,
} from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { isEditorRenderLocked } from '../../core/editorRenderLock';
import {
  announceReadOnlyEditAttempt,
  readOnlyEditAttemptExtension,
} from '../../core/readOnlyEditAttempt';

type TableCellRenderLockScope = {
  initialLocked: boolean;
  root: TableRenderLockRoot | null;
};

type TableCellRenderLockRuntime = {
  root: TableRenderLockRoot | null;
};

type TableCellRootFocusHandoff = {
  focusing: boolean;
  root: TableRenderLockRoot;
};

type LockedTableCellPreview = {
  ariaReadOnly: string | null;
  contentEditable: string | null;
  onPointerDown: (event: PointerEvent) => void;
  tabIndex: string | null;
};

const tableCellRenderLockScopes = Facet.define<
  TableCellRenderLockScope,
  readonly TableCellRenderLockScope[]
>({
  combine: (scopes) => scopes,
});
const tableCellRenderLockRuntimes = Facet.define<
  TableCellRenderLockRuntime,
  readonly TableCellRenderLockRuntime[]
>({
  combine: (runtimes) => runtimes,
});
const setNestedTableRenderLock = StateEffect.define<boolean>();
const tableCellRootFocusHandoff =
  StateEffect.define<TableCellRootFocusHandoff>();
const nestedTableRenderLockField = StateField.define<boolean>({
  create: (state) =>
    state
      .facet(tableCellRenderLockScopes)
      .some((scope) => scope.root?.isLocked() ?? scope.initialLocked),
  update: (locked, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setNestedTableRenderLock)) {
        return effect.value;
      }
    }

    return locked;
  },
  provide: (field) => [
    EditorState.readOnly.from(field),
    EditorView.editable.from(field, (locked) => !locked),
  ],
});

class TableRenderLockRoot {
  private destroyed = false;
  private locked: boolean;
  private pendingRootFocus = false;
  private nestedFocusRestore: EditorView | null = null;
  private previewSurfaceObserver: MutationObserver | null = null;
  private readonly nestedViews = new Set<EditorView>();
  private readonly lockedPreviews = new Map<
    HTMLElement,
    LockedTableCellPreview
  >();
  private readonly lockedStructureMenus = new Set<HTMLElement>();
  private chromeListening = false;
  private readonly onLockedStructureMenuClick = (event: MouseEvent) => {
    if (!this.locked) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    announceReadOnlyEditAttempt(this.view);
  };
  private readonly onLockedTableMutationEvent = (event: Event) => {
    if (!this.locked || !shouldBlockLockedTableEvent(event, this.view.dom)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'pointermove') {
      announceReadOnlyEditAttempt(this.view);
    }
  };

  constructor(readonly view: EditorView) {
    this.locked = isEditorRenderLocked(view.state);
    this.bindRuntimes(view.state);
    this.bindScopes(view.state);
    tableRenderLockRoots.add(this);
    if (this.locked) {
      this.startPreviewSurfaceObserver();
      this.startLockedChromeListeners();
      this.syncPreviewSurfaces();
      this.syncStructureMenus();
    }
  }

  update(update: ViewUpdate): void {
    const locked = isEditorRenderLocked(update.state);
    this.bindRuntimes(update.state);
    this.bindScopes(update.state);
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(tableCellRootFocusHandoff)) {
          if (effect.value.root === this) {
            this.pendingRootFocus = false;
          }
        }
      }
    }
    if (locked === this.locked) {
      return;
    }

    const focusedNested = Array.from(this.nestedViews).find(
      (nestedView) => nestedView.hasFocus,
    );
    if (locked) {
      this.nestedFocusRestore = focusedNested ?? null;
    }
    this.locked = locked;
    if (locked) {
      this.startPreviewSurfaceObserver();
      this.startLockedChromeListeners();
    } else {
      this.stopPreviewSurfaceObserver();
      this.stopLockedChromeListeners();
    }
    for (const nestedView of this.nestedViews) {
      this.syncNestedView(nestedView);
    }
    this.syncPreviewSurfaces();
    this.syncStructureMenus();
    if (locked && this.nestedFocusRestore) {
      this.handoffFocusToRoot();
    } else if (!locked && this.nestedFocusRestore) {
      const target = this.nestedFocusRestore;
      this.nestedFocusRestore = null;
      queueMicrotask(() => {
        if (!this.destroyed && this.nestedViews.has(target)) {
          target.focus();
        }
      });
    }
  }

  register(nestedView: EditorView): void {
    this.nestedViews.add(nestedView);
    this.syncNestedView(nestedView);
    this.syncPreviewSurfaces();
    if (this.locked && nestedView.hasFocus) {
      this.nestedFocusRestore = nestedView;
      this.handoffFocusToRoot();
    }
  }

  unregister(nestedView: EditorView): void {
    if (this.nestedFocusRestore === nestedView) {
      this.nestedFocusRestore = null;
    }
    this.nestedViews.delete(nestedView);
    this.syncPreviewSurfaces();
  }

  isLocked(): boolean {
    return this.locked;
  }

  hasPendingRootFocus(): boolean {
    return this.pendingRootFocus;
  }

  destroy(): void {
    this.destroyed = true;
    this.pendingRootFocus = false;
    this.nestedFocusRestore = null;
    this.stopPreviewSurfaceObserver();
    this.stopLockedChromeListeners();
    tableRenderLockRoots.delete(this);
    for (const runtime of this.view.state.facet(tableCellRenderLockRuntimes)) {
      if (runtime.root === this) {
        runtime.root = null;
      }
    }
    this.restorePreviewSurfaces();
    this.restoreStructureMenus();
    this.nestedViews.clear();
  }

  private syncNestedView(nestedView: EditorView): void {
    if (
      nestedView.state.readOnly === this.locked &&
      nestedView.state.facet(EditorView.editable) === !this.locked
    ) {
      return;
    }

    nestedView.dispatch({
      effects: setNestedTableRenderLock.of(this.locked),
    });
  }

  private handoffFocusToRoot(): void {
    this.pendingRootFocus = true;
    this.view.focus();
  }

  private startLockedChromeListeners(): void {
    if (this.chromeListening) {
      return;
    }

    this.chromeListening = true;
    for (const type of lockedTableChromeEvents) {
      this.view.dom.addEventListener(type, this.onLockedTableMutationEvent, true);
    }
  }

  private stopLockedChromeListeners(): void {
    if (!this.chromeListening) {
      return;
    }

    this.chromeListening = false;
    for (const type of lockedTableChromeEvents) {
      this.view.dom.removeEventListener(
        type,
        this.onLockedTableMutationEvent,
        true,
      );
    }
  }

  private startPreviewSurfaceObserver(): void {
    if (this.previewSurfaceObserver) {
      return;
    }

    this.previewSurfaceObserver = new MutationObserver(() => {
      if (!this.destroyed && this.locked) {
        this.syncPreviewSurfaces();
      }
    });
    this.previewSurfaceObserver.observe(this.view.dom, {
      childList: true,
      subtree: true,
    });
  }

  private stopPreviewSurfaceObserver(): void {
    this.previewSurfaceObserver?.disconnect();
    this.previewSurfaceObserver = null;
  }

  private syncPreviewSurfaces(): void {
    if (!this.locked) {
      this.restorePreviewSurfaces();
      return;
    }

    const previewSurfaces = new Set(
      this.view.dom.querySelectorAll<HTMLElement>(
        '.tbl-table-widget .tbl-cell-view',
      ),
    );
    this.reconcilePreviewSurfaces(previewSurfaces);
  }

  private syncStructureMenus(): void {
    if (!this.locked) {
      this.restoreStructureMenus();
      return;
    }

    const ownsOpenStructureMenu = this.view.dom.querySelector(
      '.tbl-handle[data-type="header"][data-active]',
    );
    if (!ownsOpenStructureMenu) {
      return;
    }

    for (const menu of this.view.dom.ownerDocument.querySelectorAll<HTMLElement>(
      '.tbl-menu-tooltip',
    )) {
      if (this.lockedStructureMenus.has(menu)) {
        continue;
      }
      menu.addEventListener('click', this.onLockedStructureMenuClick, true);
      this.lockedStructureMenus.add(menu);
    }
  }

  private restoreStructureMenus(): void {
    for (const menu of this.lockedStructureMenus) {
      menu.removeEventListener('click', this.onLockedStructureMenuClick, true);
    }
    this.lockedStructureMenus.clear();
  }

  private reconcilePreviewSurfaces(
    previewSurfaces: ReadonlySet<HTMLElement>,
  ): void {
    for (const previewSurface of this.lockedPreviews.keys()) {
      if (!previewSurfaces.has(previewSurface)) {
        this.restorePreviewSurface(previewSurface);
      }
    }
    for (const previewSurface of previewSurfaces) {
      this.lockPreviewSurface(previewSurface);
    }
  }

  private lockPreviewSurface(previewSurface: HTMLElement): void {
    if (!this.lockedPreviews.has(previewSurface)) {
      const onPointerDown = (event: PointerEvent) => {
        if (!this.locked || event.button !== 0) {
          return;
        }

        event.stopPropagation();
      };
      this.lockedPreviews.set(previewSurface, {
        ariaReadOnly: previewSurface.getAttribute('aria-readonly'),
        contentEditable: previewSurface.getAttribute('contenteditable'),
        onPointerDown,
        tabIndex: previewSurface.getAttribute('tabindex'),
      });
      previewSurface.addEventListener('pointerdown', onPointerDown);
    }

    previewSurface.setAttribute('contenteditable', 'false');
    previewSurface.setAttribute('aria-readonly', 'true');
    previewSurface.removeAttribute('tabindex');
  }

  private restorePreviewSurface(previewSurface: HTMLElement): void {
    const preview = this.lockedPreviews.get(previewSurface);
    if (!preview) {
      return;
    }

    previewSurface.removeEventListener('pointerdown', preview.onPointerDown);
    this.restoreAttribute(
      previewSurface,
      'contenteditable',
      preview.contentEditable,
    );
    this.restoreAttribute(
      previewSurface,
      'aria-readonly',
      preview.ariaReadOnly,
    );
    this.restoreAttribute(previewSurface, 'tabindex', preview.tabIndex);
    this.lockedPreviews.delete(previewSurface);
  }

  private restorePreviewSurfaces(): void {
    for (const previewSurface of [...this.lockedPreviews.keys()]) {
      this.restorePreviewSurface(previewSurface);
    }
  }

  private restoreAttribute(
    element: HTMLElement,
    name: string,
    value: string | null,
  ): void {
    if (value === null) {
      element.removeAttribute(name);
      return;
    }

    element.setAttribute(name, value);
  }

  private bindScopes(state: EditorState): void {
    for (const scope of state.facet(tableCellRenderLockScopes)) {
      scope.root = this;
    }
  }

  private bindRuntimes(state: EditorState): void {
    for (const runtime of state.facet(tableCellRenderLockRuntimes)) {
      runtime.root = this;
    }
  }
}

const tableRenderLockRoots = new Set<TableRenderLockRoot>();
const lockedTableChromeEvents = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'click',
  'keydown',
  'cut',
  'paste',
  'contextmenu',
] as const;
const mutatingTableKeys = new Set(['Backspace', 'Delete', 'Enter', 'Tab']);

function shouldBlockLockedTableEvent(event: Event, rootDom: HTMLElement): boolean {
  const target = event.target;
  if (!(target instanceof Element) || !rootDom.contains(target)) {
    return false;
  }

  if (target.closest('.tbl-handle, .tbl-menu, .tbl-menu-item, .tbl-menu-tooltip')) {
    return true;
  }

  const tableWidget = target.closest('.tbl-table-widget');
  if (!tableWidget) {
    return false;
  }

  if (event.type === 'cut' || event.type === 'paste') {
    return true;
  }

  if (event.type === 'keydown') {
    return isMutatingTableKey(event as KeyboardEvent);
  }

  return target === tableWidget;
}

function isMutatingTableKey(event: KeyboardEvent): boolean {
  return mutatingTableKeys.has(event.key);
}

const tableCellRenderLockRootPlugin = ViewPlugin.fromClass(
  TableRenderLockRoot,
);

const tableCellRenderLockNestedPlugin = ViewPlugin.fromClass(
  class {
    private root: TableRenderLockRoot | null = null;

    constructor(private readonly view: EditorView) {
      queueMicrotask(() => {
        this.connect();
      });
    }

    update(): void {
      this.connect();
    }

    destroy(): void {
      this.root?.unregister(this.view);
      this.root = null;
    }

    private connect(): void {
      if (this.root) {
        return;
      }

      for (const root of tableRenderLockRoots) {
        if (root.view.dom.contains(this.view.dom)) {
          this.root = root;
          root.register(this.view);
          return;
        }
      }
    }
  },
);

export function createTableCellRenderLockScope(
  locked: boolean,
): TableCellRenderLockScope {
  return { initialLocked: locked, root: null };
}

export function tableCellRenderLockBaseExtension(): Extension {
  const runtime: TableCellRenderLockRuntime = { root: null };
  const focusHandoffEffect = (_state: EditorState, focusing: boolean) => {
    const root = runtime.root;
    return root?.hasPendingRootFocus()
      ? tableCellRootFocusHandoff.of({ focusing, root })
      : null;
  };
  const excludeFocusHandoffFromHistory = (transaction: EditorTransaction) => {
    const ownHandoff = transaction.effects.some(
      (effect) =>
        effect.is(tableCellRootFocusHandoff) &&
        effect.value.root === runtime.root &&
        effect.value.focusing,
    );
    if (ownHandoff && !transaction.docChanged && transaction.selection == null) {
      return { annotations: Transaction.addToHistory.of(false) };
    }
    return null;
  };

  return [
    tableCellRenderLockRuntimes.of(runtime),
    EditorView.focusChangeEffect.of(focusHandoffEffect),
    EditorState.transactionExtender.of(excludeFocusHandoffFromHistory),
    tableCellRenderLockRootPlugin,
  ];
}

export function tableCellRenderLockScopeExtension(
  scope: TableCellRenderLockScope,
): Extension {
  return tableCellRenderLockScopes.of(scope);
}

export function tableCellRenderLockNestedExtension(
  scope: TableCellRenderLockScope,
): Extension {
  return [
    tableCellRenderLockScopes.of(scope),
    nestedTableRenderLockField,
    readOnlyEditAttemptExtension(),
    tableCellRenderLockNestedPlugin,
  ];
}
