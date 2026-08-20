import { syntaxTree } from '@codemirror/language';
import {
  EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  Transaction,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { markdownLanguage } from '../markdown/markdownLanguage';
import type { MarkdownDecorationRange } from '../markdown/markdownDecorationTypes';
import {
  deriveEditorInteractionContext,
  paragraphEditingKeymap,
  protectedSourceRangesExtension,
  type EditorInteractionBlock,
  type EditorInteractionContext,
  type EditorInteractionInlineOwner,
  type EditorInteractionRange,
} from '../interaction';
import { activeMermaidBlock } from '../capabilities/mermaid/mermaidEditingState';
import { isEditorRenderLocked } from '../core/editorRenderLock';
import {
  toggleTaskAtPosition,
  toggleTaskListCommand,
} from './taskListCommands';
import {
  isReplaceableMarkdownSourceMark,
  markdownSourceMarkClassName,
} from './markdownSourceMarks';
import {
  INLINE_OWNER_FROM_ATTRIBUTE,
  INLINE_OWNER_TO_ATTRIBUTE,
  inlinePointerOwnerFromEvent,
  inlinePointerPosition,
  isPrimaryPointerClick,
  resolveInlinePointerOwner,
  unclampedInlinePointerPosition,
} from './inlinePointerSelection';
import {
  createPointerSelectionStyle,
  type PointerSelectionAnchor,
} from './pointerSelectionStyle';
import { previewSchedulerExtension, updateHasPreviewPass } from '../preview/previewScheduler';
import './wysiwyg.css';

export type { MarkdownDecorationRange } from '../markdown/markdownDecorationTypes';

type TaskMarker = {
  active: boolean;
  checked: boolean;
  from: number;
  to: number;
};

type DecorationItem = {
  decoration: Decoration;
  from: number;
  to: number;
};

type SettledInlinePointerCandidate = {
  from: number;
  persist: boolean;
  position: number;
  to: number;
  x: number;
  y: number;
};

type InlinePointerCandidate = SettledInlinePointerCandidate & {
  intent: 'caret' | 'word';
};

const TASK_CHECKBOX_ARIA_LABEL = 'Toggle task completion';
const INLINE_DECORATION_KINDS = new Set<MarkdownDecorationRange['kind']>([
  'emphasis',
  'inlineCode',
  'link',
  'strikethrough',
  'strong',
]);

export function relabelTaskCheckboxes(
  root: ParentNode,
  ariaLabel: string,
): void {
  for (const checkbox of root.querySelectorAll<HTMLInputElement>(
    '[data-lm-task-checkbox]',
  )) {
    checkbox.setAttribute('aria-label', ariaLabel);
  }
}

export function collectMarkdownDecorationRanges(
  markdown: string,
): MarkdownDecorationRange[] {
  const state = EditorState.create({
    doc: markdown,
    extensions: [markdownLanguage()],
  });
  const interaction = deriveEditorInteractionContext(state, false);

  return collectSyntaxDecorationRanges(
    state,
    undefined,
    interaction.protectedSourceRanges,
  ).sort(
    (left, right) => left.from - right.from || left.to - right.to,
  );
}

class HiddenMarkdownMarkWidget extends WidgetType {
  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'lm-md-hidden-mark';
    element.setAttribute('aria-hidden', 'true');

    return element;
  }
}

class ListBulletWidget extends WidgetType {
  constructor(
    private readonly marker: string,
    private readonly accessible: boolean,
  ) {
    super();
  }

  eq(widget: ListBulletWidget): boolean {
    return widget.marker === this.marker && widget.accessible === this.accessible;
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'lm-md-list-bullet';
    if (!this.accessible) {
      element.setAttribute('aria-hidden', 'true');
    }
    element.textContent = '•';

    return element;
  }
}

const taskCheckboxWidgets = new WeakMap<
  HTMLInputElement,
  TaskCheckboxWidget
>();
const taskCheckboxViews = new WeakMap<HTMLInputElement, EditorView>();
const taskCheckboxGenerations = new WeakMap<HTMLInputElement, number>();
type RecycledTaskCheckbox = {
  checkbox: HTMLInputElement;
  restoreFocus: boolean;
};
const recycledTaskCheckboxes = new WeakMap<
  EditorView,
  Map<number, RecycledTaskCheckbox>
>();

function takeRecycledTaskCheckbox(
  view: EditorView,
  markerPosition: number,
): RecycledTaskCheckbox | null {
  const checkboxes = recycledTaskCheckboxes.get(view);
  const checkbox = checkboxes?.get(markerPosition) ?? null;

  if (checkbox) {
    checkboxes?.delete(markerPosition);
  }

  return checkbox;
}

function recycleTaskCheckbox(
  view: EditorView,
  markerPosition: number,
  checkbox: HTMLInputElement,
): void {
  const checkboxes = recycledTaskCheckboxes.get(view) ?? new Map();
  const restoreFocus = checkbox.ownerDocument.activeElement === checkbox;

  if (restoreFocus) {
    checkbox.blur();
  }

  const recycledCheckbox = {
    checkbox,
    restoreFocus,
  };
  checkboxes.set(markerPosition, recycledCheckbox);
  recycledTaskCheckboxes.set(view, checkboxes);

  queueMicrotask(() => {
    if (checkboxes.get(markerPosition) === recycledCheckbox) {
      checkboxes.delete(markerPosition);
    }
  });
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly markerPosition: number,
    private readonly readOnly: boolean,
    private readonly ariaLabel: string,
  ) {
    super();
  }

  eq(widget: TaskCheckboxWidget): boolean {
    return (
      widget.checked === this.checked &&
      widget.markerPosition === this.markerPosition &&
      widget.readOnly === this.readOnly &&
      widget.ariaLabel === this.ariaLabel
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const recycled = takeRecycledTaskCheckbox(
      view,
      this.markerPosition,
    );
    const checkbox = recycled?.checkbox ?? document.createElement('input');

    if (!recycled) {
      checkbox.type = 'checkbox';
      checkbox.className = 'lm-md-task-checkbox';
      checkbox.addEventListener('change', () => {
        taskCheckboxWidgets.get(checkbox)?.toggle(view, checkbox);
      });
      checkbox.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') {
          return;
        }

        event.preventDefault();
        taskCheckboxWidgets.get(checkbox)?.toggle(view, checkbox);
      });
    }

    const generation = this.updateCheckbox(checkbox, view);

    if (recycled?.restoreFocus) {
      this.restoreFocusAfterRecycle(checkbox, view, generation);
    }

    return checkbox;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (!(dom instanceof HTMLInputElement)) {
      return false;
    }

    this.updateCheckbox(dom, view);
    return true;
  }

  destroy(dom: HTMLElement): void {
    if (!(dom instanceof HTMLInputElement)) {
      return;
    }

    const view = taskCheckboxViews.get(dom);

    if (view) {
      recycleTaskCheckbox(view, this.markerPosition, dom);
    }

    taskCheckboxWidgets.delete(dom);
    taskCheckboxViews.delete(dom);
    taskCheckboxGenerations.set(
      dom,
      (taskCheckboxGenerations.get(dom) ?? 0) + 1,
    );
  }

  private updateCheckbox(
    checkbox: HTMLInputElement,
    view: EditorView,
  ): number {
    checkbox.checked = this.checked;
    checkbox.disabled = this.readOnly;
    checkbox.dataset.lmTaskCheckbox = '';
    checkbox.setAttribute('aria-label', this.ariaLabel);
    taskCheckboxWidgets.set(checkbox, this);
    taskCheckboxViews.set(checkbox, view);

    const generation = (taskCheckboxGenerations.get(checkbox) ?? 0) + 1;
    taskCheckboxGenerations.set(checkbox, generation);

    return generation;
  }

  private restoreFocusAfterRecycle(
    checkbox: HTMLInputElement,
    view: EditorView,
    generation: number,
  ): void {
    const ownerDocument = checkbox.ownerDocument;
    const activeElement = ownerDocument.activeElement;

    if (
      activeElement === checkbox ||
      (activeElement !== null &&
        activeElement !== ownerDocument.body &&
        activeElement !== ownerDocument.documentElement)
    ) {
      return;
    }

    const expectedActiveElement = activeElement;

    queueMicrotask(() => {
      if (
        checkbox.isConnected &&
        taskCheckboxWidgets.get(checkbox) === this &&
        taskCheckboxViews.get(checkbox) === view &&
        taskCheckboxGenerations.get(checkbox) === generation &&
        ownerDocument.activeElement === expectedActiveElement
      ) {
        checkbox.focus({ preventScroll: true });
      }
    });
  }

  private toggle(view: EditorView, checkbox: HTMLInputElement): void {
    const changes = toggleTaskAtPosition(
      view.state,
      this.markerPosition,
    );

    if (!changes) {
      checkbox.checked = this.checked;
      return;
    }

    const restoreFocus = document.activeElement === checkbox;
    view.dispatch({
      changes,
      userEvent: 'input.toggle-task',
    });

    if (restoreFocus && document.activeElement !== checkbox) {
      checkbox.focus({ preventScroll: true });
    }
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const decorations: DecorationItem[] = [];
  const interaction = deriveEditorInteractionContext(
    view.state,
    view.compositionStarted,
  );
  const renderLocked = isEditorRenderLocked(view.state);

  for (
    const item of collectListLineDecorations(
      view.state,
      view.visibleRanges,
      interaction.protectedSourceRanges,
    )
  ) {
    decorations.push(item);
  }

  for (
    const range of collectSyntaxDecorationRanges(
      view.state,
      view.visibleRanges,
      interaction.protectedSourceRanges,
    )
  ) {
    if (isRuntimeReplacedMarker(range.kind)) {
      continue;
    }

    if (range.from !== range.to) {
      decorations.push({
        decoration: Decoration.mark({
          attributes: INLINE_DECORATION_KINDS.has(range.kind)
            ? {
                [INLINE_OWNER_FROM_ATTRIBUTE]: String(range.from),
                [INLINE_OWNER_TO_ATTRIBUTE]: String(range.to),
              }
            : undefined,
          class: range.className,
        }),
        from: range.from,
        to: range.to,
      });
    }
  }

  for (
    const marker of collectTaskMarkersFromSyntax(
      view.state,
      view.visibleRanges,
      interaction,
    )
  ) {
    if (marker.active && !renderLocked) {
      decorations.push({
        decoration: Decoration.mark({
          class: markdownSourceMarkClassName('TaskMarker'),
        }),
        from: marker.from,
        to: marker.to,
      });
      continue;
    }

    decorations.push({
      decoration: Decoration.replace({
        widget: new TaskCheckboxWidget(
          marker.checked,
          marker.from,
          renderLocked,
          view.state.phrase(TASK_CHECKBOX_ARIA_LABEL),
        ),
      }),
      from: marker.from,
      to: marker.to,
    });
  }

  for (const marker of collectListMarkers(view, interaction)) {
    decorations.push(marker);
  }

  for (const mark of collectHiddenMarkdownMarks(view, interaction)) {
    decorations.push(mark);
  }

  decorations.sort(
    (left, right) => left.from - right.from || left.to - right.to,
  );

  for (const item of decorations) {
    builder.add(item.from, item.to, item.decoration);
  }

  return builder.finish();
}

function isRuntimeReplacedMarker(
  kind: MarkdownDecorationRange['kind'],
): boolean {
  return (
    kind === 'orderedList' ||
    kind === 'taskList' ||
    kind === 'unorderedList'
  );
}

function collectSyntaxDecorationRanges(
  state: EditorView['state'],
  ranges?: readonly { from: number; to: number }[],
  protectedSourceRanges: readonly EditorInteractionRange[] = [],
): MarkdownDecorationRange[] {
  const decorationRanges: MarkdownDecorationRange[] = [];

  for (const range of ranges ?? [{ from: 0, to: state.doc.length }]) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (
          isProtectedRange(
            protectedSourceRanges,
            node.from,
            node.to,
          )
        ) {
          return;
        }

        const item = syntaxNodeToDecorationRange(
          state,
          node.name,
          node.from,
          node.to,
        );

        if (item) {
          decorationRanges.push(item);
        }
      }
    });
  }

  return decorationRanges;
}

function syntaxNodeToDecorationRange(
  state: EditorView['state'],
  name: string,
  from: number,
  to: number,
): MarkdownDecorationRange | null {
  if (/^ATXHeading[1-6]$/.test(name)) {
    return {
      className: `lm-md-heading lm-md-heading-${name.at(-1)}`,
      from,
      kind: 'heading',
      to,
    };
  }

  if (/^SetextHeading[1-2]$/.test(name)) {
    return {
      className: `lm-md-heading lm-md-heading-${name.at(-1)}`,
      from,
      kind: 'heading',
      to,
    };
  }

  switch (name) {
    case 'Blockquote':
      return {
        className: 'lm-md-blockquote',
        from,
        kind: 'blockquote',
        to,
      };
    case 'Link':
    case 'Autolink':
      return {
        className: 'lm-md-link',
        from,
        kind: 'link',
        to,
      };
    case 'HorizontalRule':
      return {
        className: 'lm-md-horizontal-rule',
        from,
        kind: 'horizontalRule',
        to,
      };
    case 'InlineCode':
      return {
        className: 'lm-md-inline-code',
        from,
        kind: 'inlineCode',
        to,
      };
    case 'Table':
      return {
        className: 'lm-md-table',
        from,
        kind: 'table',
        to,
      };
    case 'TableHeader':
      return {
        className: 'lm-md-table-header',
        from,
        kind: 'tableHeader',
        to,
      };
    case 'TableRow':
      return {
        className: 'lm-md-table-row',
        from,
        kind: 'tableRow',
        to,
      };
    case 'TableCell':
      return {
        className: 'lm-md-table-cell',
        from,
        kind: 'tableCell',
        to,
      };
    case 'TableDelimiter':
      return {
        className: 'lm-md-table-delimiter',
        from,
        kind: 'tableDelimiter',
        to,
      };
    case 'ListMark':
      if (/^\d/.test(state.doc.sliceString(from, to))) {
        return {
          className: 'lm-md-list lm-md-ordered-list lm-md-list-marker',
          from,
          kind: 'orderedList',
          to,
        };
      }

      return {
        className: 'lm-md-list lm-md-unordered-list lm-md-list-marker',
        from,
        kind: 'unorderedList',
        to,
      };
    case 'TaskMarker': {
      const line = state.doc.lineAt(from);

      return {
        className: 'lm-md-list lm-md-task-list lm-md-list-marker',
        from: line.from,
        kind: 'taskList',
        to,
      };
    }
    case 'StrongEmphasis':
      return {
        className: 'lm-md-strong',
        from,
        kind: 'strong',
        to,
      };
    case 'Emphasis':
      return {
        className: 'lm-md-emphasis',
        from,
        kind: 'emphasis',
        to,
      };
    case 'Strikethrough':
      return {
        className: 'lm-md-strikethrough',
        from,
        kind: 'strikethrough',
        to,
      };
    default:
      return null;
  }
}

function collectListMarkers(
  view: EditorView,
  interaction: EditorInteractionContext,
): DecorationItem[] {
  const markers: DecorationItem[] = [];
  const renderLocked = isEditorRenderLocked(view.state);

  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'ListMark') {
          return;
        }

        const marker = view.state.doc.sliceString(node.from, node.to);
        const line = view.state.doc.lineAt(node.from);
        const lineText = view.state.doc.sliceString(line.from, line.to);
        const taskMarker = /^\s{0,3}(?:[-*+]|\d+[.)])\s+\[[ xX]\](?=\s|$)/.test(
          lineText,
        );
        const unorderedMarker = /^[-*+]$/.test(marker);
        const orderedMarker = /^\d+[.)]$/.test(marker);
        const owner = findAncestorBlock(node.node, 'ListItem');
        if (
          (!unorderedMarker && !orderedMarker) ||
          isProtectedRange(
            interaction.protectedSourceRanges,
            node.from,
            node.to,
          )
        ) {
          return;
        }

        if (!renderLocked && owner && isActiveBlock(interaction, owner)) {
          markers.push({
            decoration: Decoration.mark({
              class: markdownSourceMarkClassName('ListMark'),
            }),
            from: node.from,
            to: node.to,
          });
          return;
        }

        if (renderLocked && orderedMarker) {
          markers.push({
            decoration: Decoration.mark({
              class: 'lm-md-list-order',
            }),
            from: node.from,
            to: node.to,
          });
          return;
        }

        if (renderLocked && taskMarker) {
          markers.push({
            decoration: Decoration.replace({
              widget: new HiddenMarkdownMarkWidget(),
            }),
            from: node.from,
            to: node.to,
          });
          return;
        }

        if (taskMarker || !unorderedMarker) {
          return;
        }

        markers.push({
          decoration: Decoration.replace({
            widget: new ListBulletWidget(marker, renderLocked),
          }),
          from: node.from,
          to: node.to,
        });
      },
    });
  }

  return markers;
}

function collectTaskMarkersFromSyntax(
  state: EditorView['state'],
  ranges: readonly { from: number; to: number }[],
  interaction: EditorInteractionContext,
): TaskMarker[] {
  const markers: TaskMarker[] = [];

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (
          node.name !== 'TaskMarker' ||
          isProtectedRange(
            interaction.protectedSourceRanges,
            node.from,
            node.to,
          )
        ) {
          return;
        }

        const owner = findAncestorBlock(node.node, 'ListItem');

        markers.push({
          active: Boolean(owner && isActiveBlock(interaction, owner)),
          checked: state.doc.sliceString(node.from, node.to).toLowerCase() === '[x]',
          from: node.from,
          to: node.to,
        });
      }
    });
  }

  return markers;
}

function collectListLineDecorations(
  state: EditorView['state'],
  ranges: readonly { from: number; to: number }[],
  protectedSourceRanges: readonly EditorInteractionRange[],
): DecorationItem[] {
  const items: DecorationItem[] = [];

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (
          node.name !== 'ListItem' ||
          isProtectedRange(
            protectedSourceRanges,
            node.from,
            node.to,
          )
        ) {
          return;
        }

        const line = state.doc.lineAt(node.from);
        const lineText = state.doc.sliceString(line.from, line.to);
        const taskMarker = /^\s{0,3}(?:[-*+]|\d+[.)])\s+\[[ xX]\](?=\s|$)/.test(lineText);
        const unorderedMarker = /^\s{0,3}[-*+]\s+/.test(lineText);
        const orderedMarker = /^\s{0,3}\d+[.)]\s+/.test(lineText);

        if (!taskMarker && !unorderedMarker && !orderedMarker) {
          return;
        }

        items.push({
          decoration: Decoration.line({
            class: [
              'lm-md-list-line',
              taskMarker
                ? 'lm-md-task-list-line'
                : unorderedMarker
                  ? 'lm-md-unordered-list-line'
                  : 'lm-md-ordered-list-line',
            ].join(' '),
          }),
          from: line.from,
          to: line.from,
        });
      },
    });
  }

  return items;
}

function collectHiddenMarkdownMarks(
  view: EditorView,
  interaction: EditorInteractionContext,
): DecorationItem[] {
  const marks: DecorationItem[] = [];

  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        const parentName = node.node.parent?.name;
        const sourceMarkClassName = markdownSourceMarkClassName(
          node.name,
          parentName,
        );

        if (
          !isReplaceableMarkdownSourceMark(node.name, parentName) ||
          !sourceMarkClassName ||
          isProtectedRange(
            interaction.protectedSourceRanges,
            node.from,
            node.to,
          )
        ) {
          return;
        }

        if (shouldRevealSyntaxNode(view, interaction, node.node)) {
          marks.push({
            decoration: Decoration.mark({ class: sourceMarkClassName }),
            from: node.from,
            to: node.to,
          });
          return;
        }

        marks.push({
          decoration: Decoration.replace({
            widget: new HiddenMarkdownMarkWidget(),
          }),
          from: node.from,
          to: node.to,
        });
      },
    });
  }

  return marks;
}

type SyntaxNode = ReturnType<
  ReturnType<typeof syntaxTree>['resolveInner']
>;

function findAncestorInlineOwner(
  node: SyntaxNode,
): Pick<EditorInteractionInlineOwner, 'from' | 'kind' | 'to'> | null {
  for (let current: SyntaxNode | null = node.parent; current; current = current.parent) {
    if (
      current.name === 'Autolink' ||
      current.name === 'Emphasis' ||
      current.name === 'Image' ||
      current.name === 'InlineCode' ||
      current.name === 'Link' ||
      current.name === 'Strikethrough' ||
      current.name === 'StrongEmphasis'
    ) {
      return {
        from: current.from,
        kind: current.name,
        to: current.to,
      };
    }
  }

  return null;
}

function findAncestorBlock(
  node: SyntaxNode,
  kind?: EditorInteractionBlock['kind'],
): Pick<EditorInteractionBlock, 'from' | 'kind' | 'to'> | null {
  for (let current: SyntaxNode | null = node.parent; current; current = current.parent) {
    const isBlock =
      current.name === 'Blockquote' ||
      current.name === 'FencedCode' ||
      current.name === 'ListItem' ||
      /^ATXHeading[1-6]$/.test(current.name) ||
      /^SetextHeading[1-2]$/.test(current.name);

    if (isBlock && (!kind || current.name === kind)) {
      return {
        from: current.from,
        kind: current.name as EditorInteractionBlock['kind'],
        to: current.to,
      };
    }
  }

  return null;
}

function isActiveInlineOwner(
  interaction: EditorInteractionContext,
  owner: Pick<EditorInteractionInlineOwner, 'from' | 'kind' | 'to'>,
): boolean {
  return interaction.activeInlineOwners.some(
    (activeOwner) =>
      activeOwner.kind === owner.kind &&
      activeOwner.from === owner.from &&
      activeOwner.to === owner.to,
  );
}

function isActiveBlock(
  interaction: EditorInteractionContext,
  owner: Pick<EditorInteractionBlock, 'from' | 'kind' | 'to'>,
): boolean {
  return interaction.activeBlocks.some(
    (activeBlock) =>
      activeBlock.kind === owner.kind &&
      activeBlock.from === owner.from &&
      activeBlock.to === owner.to,
  );
}

function isProtectedRange(
  protectedSourceRanges: readonly EditorInteractionRange[],
  from: number,
  to: number,
): boolean {
  return protectedSourceRanges.some(
    (range) => range.from < to && range.to > from,
  );
}

function isInsideActiveMermaidBlock(
  view: EditorView,
  node: SyntaxNode,
): boolean {
  if (node.name !== 'CodeMark' && node.name !== 'CodeInfo') {
    return false;
  }

  const activeBlock = activeMermaidBlock(view.state);

  return Boolean(
    activeBlock &&
      node.from >= activeBlock.from &&
      node.to <= activeBlock.to,
  );
}

function isActiveDelimiterRange(
  interaction: EditorInteractionContext,
  node: SyntaxNode,
): boolean {
  return interaction.selections.some((selection) =>
    selection.delimiterRanges.some(
      (range) =>
        range.kind === node.name &&
        range.from === node.from &&
        range.to === node.to,
    ),
  );
}

function shouldRevealSyntaxNode(
  view: EditorView,
  interaction: EditorInteractionContext,
  node: SyntaxNode,
): boolean {
  // Reading mode keeps the rendered view still: revealing source under the
  // caret is an editing affordance, and the page must not reflow while reading.
  if (isEditorRenderLocked(view.state)) {
    return false;
  }

  if (isInsideActiveMermaidBlock(view, node)) {
    return true;
  }

  const activeDelimiter = isActiveDelimiterRange(interaction, node);

  if (
    node.name === 'CodeInfo' ||
    node.name === 'CodeMark' ||
    node.name === 'QuoteMark'
  ) {
    return activeDelimiter;
  }

  if (activeDelimiter) {
    return true;
  }

  const inlineOwner = findAncestorInlineOwner(node);
  if (inlineOwner) {
    return isActiveInlineOwner(interaction, inlineOwner);
  }

  const block = findAncestorBlock(node);
  return block ? isActiveBlock(interaction, block) : false;
}

function activeMermaidBlockChanged(update: ViewUpdate): boolean {
  const previous = activeMermaidBlock(update.startState);
  const current = activeMermaidBlock(update.state);

  return (
    previous?.from !== current?.from ||
    previous?.to !== current?.to
  );
}

export type MarkdownDecorationUpdateMode =
  | 'keep'
  | 'map'
  | 'rebuild';

function serializeDecorationOwners(
  owners: readonly { readonly from: number; readonly kind?: string; readonly to: number }[],
): string {
  return owners
    .map((owner) => `${owner.kind ?? ''}:${owner.from}:${owner.to}`)
    .join(',');
}

export function markdownDecorationActiveIdentity(
  state: EditorState,
  composing: boolean,
): string {
  const interaction = deriveEditorInteractionContext(state, composing);
  const delimiterRanges = interaction.selections.flatMap(
    (selection) => selection.delimiterRanges,
  );

  return [
    serializeDecorationOwners(interaction.activeBlocks),
    serializeDecorationOwners(interaction.activeInlineOwners),
    serializeDecorationOwners(interaction.protectedSourceRanges),
    serializeDecorationOwners(delimiterRanges),
  ].join('/');
}

export function selectMarkdownDecorationUpdateMode({
  compositionStarted,
  documentChanged = false,
  gestureActive = false,
  previewPass = false,
  requiresRebuild,
  wasComposing,
}: {
  readonly compositionStarted: boolean;
  readonly documentChanged?: boolean;
  readonly gestureActive?: boolean;
  readonly previewPass?: boolean;
  readonly requiresRebuild: boolean;
  readonly wasComposing: boolean;
}): MarkdownDecorationUpdateMode {
  if (compositionStarted || (gestureActive && documentChanged)) {
    return 'map';
  }

  if (gestureActive) {
    // Revealing a hidden delimiter between pointer-down and pointer-up changes
    // the source position beneath the same screen coordinate.
    return 'keep';
  }

  if (wasComposing || previewPass || requiresRebuild) {
    return 'rebuild';
  }

  return 'keep';
}

const settlePointerMarkdownDecorations = StateEffect.define<null>();

export const markdownDecorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private destroyed = false;
    private gestureActive = false;
    private gestureCleanup: (() => void) | null = null;
    private inlinePointerCandidate: InlinePointerCandidate | null = null;
    private lastInlinePointerCandidate: SettledInlinePointerCandidate | null = null;
    private pointerGestureEvent: MouseEvent | null = null;
    private settlementQueued = false;
    private wasComposing: boolean;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
      this.wasComposing = view.compositionStarted;
    }

    update(update: ViewUpdate) {
      const compositionStarted = update.view.compositionStarted;
      const pointerSettlement = update.transactions.some((transaction) =>
        transaction.effects.some((effect) =>
          effect.is(settlePointerMarkdownDecorations),
        ),
      );
      if (update.docChanged) {
        // A document change can invalidate the source offsets captured by the
        // current gesture or its preceding click. This includes IME commits,
        // whose resulting caret must never be replaced by a stale fixup.
        if (this.gestureActive) {
          this.inlinePointerCandidate = null;
        }
        this.lastInlinePointerCandidate = null;
      }
      if (
        !this.gestureActive &&
        update.selectionSet &&
        !pointerSettlement
      ) {
        this.lastInlinePointerCandidate = null;
      }

      const mode = selectMarkdownDecorationUpdateMode({
        compositionStarted,
        documentChanged: update.docChanged,
        gestureActive: this.gestureActive,
        previewPass: updateHasPreviewPass(update),
        requiresRebuild:
          pointerSettlement ||
          update.docChanged ||
          update.startState.readOnly !== update.state.readOnly ||
          isEditorRenderLocked(update.startState) !==
            isEditorRenderLocked(update.state) ||
          activeMermaidBlockChanged(update) ||
          update.startState.phrase(TASK_CHECKBOX_ARIA_LABEL) !==
            update.state.phrase(TASK_CHECKBOX_ARIA_LABEL) ||
          syntaxTree(update.startState) !== syntaxTree(update.state) ||
          (
            update.selectionSet &&
            markdownDecorationActiveIdentity(
              update.startState,
              this.wasComposing,
            ) !==
              markdownDecorationActiveIdentity(
                update.state,
                compositionStarted,
              )
          ),
        wasComposing: this.wasComposing,
      });

      if (mode === 'map') {
        this.decorations = this.decorations.map(update.changes);
      } else if (mode === 'rebuild') {
        this.decorations = buildDecorations(update.view);
      }

      this.wasComposing = compositionStarted;
    }

    beginPointerSelection(event: MouseEvent, view: EditorView): boolean {
      this.beginGesture(view);
      this.inlinePointerCandidate = null;
      this.pointerGestureEvent = event;

      if (
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.detail < 1
      ) {
        this.lastInlinePointerCandidate = null;
        return false;
      }

      const closest = inlinePointerOwnerFromEvent(event);
      const unclamped = unclampedInlinePointerPosition(view, {
        x: event.clientX,
        y: event.clientY,
      });
      const owner = resolveInlinePointerOwner(event, view);
      const from = owner?.from;
      const to = owner?.to;
      const overflowHit =
        !owner &&
        closest !== null &&
        unclamped !== null &&
        closest.element.classList.contains('lm-md-inline-code');

      if (event.detail >= 2) {
        // The first settlement may reveal delimiters and move this fixed
        // screen point. Keep the first rendered hit as the double-click word
        // anchor when the browser classifies the next press as the same
        // owner's double-click. A leaked OS double-click that lands in the
        // following text must stay a collapsed caret, even when chip padding
        // still owns the DOM hit target.
        const previous = this.lastInlinePointerCandidate;
        this.lastInlinePointerCandidate = null;
        if (
          previous &&
          owner &&
          previous.from === from &&
          previous.to === to
        ) {
          this.inlinePointerCandidate = {
            ...previous,
            intent: 'word',
            persist: true,
            x: event.clientX,
            y: event.clientY,
          };
          return true;
        }
        if (previous?.persist || overflowHit) {
          this.inlinePointerCandidate = {
            from: 0,
            intent: 'caret',
            persist: false,
            position: unclamped ?? view.state.selection.main.head,
            to: view.state.doc.length,
            x: event.clientX,
            y: event.clientY,
          };
          return true;
        }
        if (event.detail === 2 && unclamped !== null) {
          this.inlinePointerCandidate = {
            from: 0,
            intent: 'word',
            persist: false,
            position: unclamped,
            to: view.state.doc.length,
            x: event.clientX,
            y: event.clientY,
          };
        }
        return false;
      }

      if (owner && from !== undefined && to !== undefined) {
        this.lastInlinePointerCandidate = null;
        this.inlinePointerCandidate = {
          from,
          intent: 'caret',
          persist: true,
          position: inlinePointerPosition(
            view,
            owner,
            { x: event.clientX, y: event.clientY },
          ),
          to,
          x: event.clientX,
          y: event.clientY,
        };
        // Only the code chip needs preventDefault. Links and emphasis keep
        // native caret, drag, and edge auto-scroll; settlement still applies
        // the captured candidate so a drag cannot stay collapsed.
        return owner.element.classList.contains('lm-md-inline-code');
      }

      if (overflowHit) {
        this.lastInlinePointerCandidate = null;
        this.inlinePointerCandidate = {
          from: 0,
          intent: 'caret',
          persist: true,
          position: unclamped ?? view.state.selection.main.head,
          to: view.state.doc.length,
          x: event.clientX,
          y: event.clientY,
        };
        return true;
      }

      if (unclamped !== null) {
        this.lastInlinePointerCandidate = null;
        this.inlinePointerCandidate = {
          from: 0,
          intent: 'caret',
          persist: false,
          position: unclamped,
          to: view.state.doc.length,
          x: event.clientX,
          y: event.clientY,
        };
        return false;
      }

      this.lastInlinePointerCandidate = null;
      return false;
    }

    beginTouchSelection(view: EditorView): void {
      this.beginGesture(view);
      this.inlinePointerCandidate = null;
      this.lastInlinePointerCandidate = null;
      this.pointerGestureEvent = null;
    }

    /**
     * CodeMirror asks for a selection style right after this plugin handled the
     * same `mousedown`, so the press candidate is the position the gesture must
     * stay anchored to.
     */
    pointerSelectionAnchor(event: MouseEvent): PointerSelectionAnchor | null {
      const candidate = this.inlinePointerCandidate;
      if (
        !this.gestureActive ||
        this.pointerGestureEvent !== event ||
        candidate === null
      ) {
        return null;
      }

      return {
        kind: candidate.intent === 'word' ? 'word-or-drag' : 'caret',
        position: candidate.position,
        x: candidate.x,
        y: candidate.y,
      };
    }

    private beginGesture(view: EditorView): void {
      this.cleanupGestureListeners();
      this.gestureActive = true;
      this.settlementQueued = false;

      const ownerDocument = view.dom.ownerDocument;
      const ownerWindow = ownerDocument.defaultView;
      const handleMouseUp = (event: MouseEvent) => {
        this.queuePointerSettlement(view, event);
      };
      const handleCancel = () => {
        this.queuePointerSettlement(view, null);
      };

      ownerDocument.addEventListener('mouseup', handleMouseUp, true);
      ownerDocument.addEventListener('pointercancel', handleCancel, true);
      ownerDocument.addEventListener('touchend', handleCancel, true);
      ownerDocument.addEventListener('touchcancel', handleCancel, true);
      ownerWindow?.addEventListener('blur', handleCancel, true);
      this.gestureCleanup = () => {
        ownerDocument.removeEventListener('mouseup', handleMouseUp, true);
        ownerDocument.removeEventListener('pointercancel', handleCancel, true);
        ownerDocument.removeEventListener('touchend', handleCancel, true);
        ownerDocument.removeEventListener('touchcancel', handleCancel, true);
        ownerWindow?.removeEventListener('blur', handleCancel, true);
      };
    }

    private queuePointerSettlement(
      view: EditorView,
      event: MouseEvent | null,
    ): void {
      if (this.destroyed || !this.gestureActive || this.settlementQueued) {
        return;
      }

      this.settlementQueued = true;
      queueMicrotask(() => {
        this.settlementQueued = false;
        this.settlePointerSelection(view, event);
      });
    }

    settlePointerSelection(
      view: EditorView,
      event: MouseEvent | null,
    ): void {
      if (this.destroyed || !this.gestureActive) {
        return;
      }

      this.gestureActive = false;
      this.cleanupGestureListeners();
      const candidate = this.inlinePointerCandidate;
      this.inlinePointerCandidate = null;
      this.pointerGestureEvent = null;
      const isPrimaryClick =
        candidate !== null &&
        event !== null &&
        isPrimaryPointerClick(
          { x: candidate.x, y: candidate.y },
          { x: event.clientX, y: event.clientY },
        );

      let selection: { anchor: number; head?: number } | undefined;
      if (isPrimaryClick && candidate.intent === 'caret') {
        selection = { anchor: candidate.position };
        this.lastInlinePointerCandidate = candidate.persist
          ? {
              from: candidate.from,
              persist: true,
              position: candidate.position,
              to: candidate.to,
              x: candidate.x,
              y: candidate.y,
            }
          : null;
      } else if (isPrimaryClick) {
        const word = view.state.wordAt(candidate.position);
        if (
          word &&
          word.from >= candidate.from &&
          word.to <= candidate.to
        ) {
          selection = { anchor: word.anchor, head: word.head };
        }
        this.lastInlinePointerCandidate = null;
      } else if (candidate !== null && candidate.intent === 'caret') {
        // Chip presses preventDefault, so settlement must restore the caret.
        // Link/emphasis drags keep native autoscroll but can stay collapsed;
        // extend those to the release coordinates, or keep the original hit
        // when the gesture is cancelled.
        const head = event
          ? unclampedInlinePointerPosition(view, {
              x: event.clientX,
              y: event.clientY,
            })
          : candidate.position;
        selection = {
          anchor: candidate.position,
          ...(head !== null && head !== candidate.position ? { head } : {}),
        };
        this.lastInlinePointerCandidate = event || !candidate.persist
          ? null
          : {
              from: candidate.from,
              persist: true,
              position: candidate.position,
              to: candidate.to,
              x: candidate.x,
              y: candidate.y,
            };
      } else {
        this.lastInlinePointerCandidate = null;
      }

      view.dispatch({
        annotations: Transaction.addToHistory.of(false),
        effects: settlePointerMarkdownDecorations.of(null),
        ...(selection ? { selection } : {}),
      });
    }

    private cleanupGestureListeners(): void {
      this.gestureCleanup?.();
      this.gestureCleanup = null;
    }

    destroy(): void {
      this.destroyed = true;
      this.gestureActive = false;
      this.settlementQueued = false;
      this.inlinePointerCandidate = null;
      this.lastInlinePointerCandidate = null;
      this.pointerGestureEvent = null;
      this.cleanupGestureListeners();
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mousedown(event, view) {
        const handled = this.beginPointerSelection(event, view);
        if (handled) {
          event.preventDefault();
        }
        return handled;
      },
    },
    eventObservers: {
      touchstart(_event, view) {
        this.beginTouchSelection(view);
      },
    },
  },
);

export function markdownWysiwygExtension(): Extension {
  return [
    previewSchedulerExtension(),
    protectedSourceRangesExtension(),
    markdownDecorationsPlugin,
    pointerSelectionStyleExtension(),
    paragraphEditingKeymap(),
    keymapExtension(),
  ];
}

function pointerSelectionStyleExtension(): Extension {
  return EditorView.mouseSelectionStyle.of((view, event) => {
    const anchor = view
      .plugin(markdownDecorationsPlugin)
      ?.pointerSelectionAnchor(event);

    return anchor ? createPointerSelectionStyle(view, anchor) : null;
  });
}

function keymapExtension(): Extension {
  return keymap.of([
    {
      key: 'Mod-Enter',
      run: toggleTaskListCommand,
    },
  ]);
}
