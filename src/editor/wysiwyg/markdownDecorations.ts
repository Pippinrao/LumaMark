import { syntaxTree } from '@codemirror/language';
import { EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
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
import {
  toggleTaskAtPosition,
  toggleTaskListCommand,
} from './taskListCommands';
import './wysiwyg.css';

export type { MarkdownDecorationRange } from '../markdown/markdownDecorationTypes';

type TaskMarker = {
  checked: boolean;
  from: number;
  to: number;
};

type DecorationItem = {
  decoration: Decoration;
  from: number;
  to: number;
};

const INLINE_MARK_NODE_NAMES = new Set([
  'CodeMark',
  'EmphasisMark',
  'LinkTitle',
  'StrikethroughMark',
]);
const TASK_CHECKBOX_ARIA_LABEL = 'Toggle task completion';

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
  constructor(private readonly marker: string) {
    super();
  }

  eq(widget: ListBulletWidget): boolean {
    return widget.marker === this.marker;
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'lm-md-list-bullet';
    element.setAttribute('aria-hidden', 'true');
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
        decoration: Decoration.mark({ class: range.className }),
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
    decorations.push({
      decoration: Decoration.replace({
        widget: new TaskCheckboxWidget(
          marker.checked,
          marker.from,
          view.state.readOnly,
          view.state.phrase(TASK_CHECKBOX_ARIA_LABEL),
        ),
      }),
      from: marker.from,
      to: marker.to,
    });
  }

  for (const marker of collectUnorderedListMarkers(view, interaction)) {
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

function collectUnorderedListMarkers(
  view: EditorView,
  interaction: EditorInteractionContext,
): DecorationItem[] {
  const markers: DecorationItem[] = [];

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
        const taskMarker = /^\s{0,3}[-*+]\s+\[[ xX]\](?=\s|$)/.test(lineText);
        const owner = findAncestorBlock(node.node, 'ListItem');
        if (
          !/^[-*+]$/.test(marker) ||
          taskMarker ||
          isProtectedRange(
            interaction.protectedSourceRanges,
            node.from,
            node.to,
          ) ||
          (owner && isActiveBlock(interaction, owner))
        ) {
          return;
        }

        markers.push({
          decoration: Decoration.replace({
            widget: new ListBulletWidget(marker),
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

        if (owner && isActiveBlock(interaction, owner)) {
          return;
        }

        markers.push({
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
        if (
          !shouldHideSyntaxNode(node.name, node.node.parent?.name) ||
          isProtectedRange(
            interaction.protectedSourceRanges,
            node.from,
            node.to,
          ) ||
          shouldRevealSyntaxNode(
            view,
            interaction,
            node.node,
          )
        ) {
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

function shouldHideSyntaxNode(name: string, parentName?: string): boolean {
  if (
    name === 'HeaderMark' ||
    name === 'QuoteMark' ||
    name === 'CodeInfo' ||
    name === 'LinkMark' ||
    name === 'LinkTitle' ||
    INLINE_MARK_NODE_NAMES.has(name)
  ) {
    return true;
  }

  return (
    name === 'URL' &&
    (parentName === 'Image' || parentName === 'Link')
  );
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
  if (isInsideActiveMermaidBlock(view, node)) {
    return true;
  }

  const activeDelimiter = isActiveDelimiterRange(interaction, node);

  if (node.name === 'QuoteMark') {
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

export function selectMarkdownDecorationUpdateMode({
  compositionStarted,
  requiresRebuild,
  wasComposing,
}: {
  readonly compositionStarted: boolean;
  readonly requiresRebuild: boolean;
  readonly wasComposing: boolean;
}): MarkdownDecorationUpdateMode {
  if (compositionStarted) {
    return 'map';
  }

  if (wasComposing || requiresRebuild) {
    return 'rebuild';
  }

  return 'keep';
}

const markdownDecorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private wasComposing: boolean;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
      this.wasComposing = view.compositionStarted;
    }

    update(update: ViewUpdate) {
      const compositionStarted = update.view.compositionStarted;
      const mode = selectMarkdownDecorationUpdateMode({
        compositionStarted,
        requiresRebuild:
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.startState.readOnly !== update.state.readOnly ||
          activeMermaidBlockChanged(update) ||
          update.startState.phrase(TASK_CHECKBOX_ARIA_LABEL) !==
            update.state.phrase(TASK_CHECKBOX_ARIA_LABEL) ||
          syntaxTree(update.startState) !== syntaxTree(update.state),
        wasComposing: this.wasComposing,
      });

      if (mode === 'map') {
        this.decorations = this.decorations.map(update.changes);
      } else if (mode === 'rebuild') {
        this.decorations = buildDecorations(update.view);
      }

      this.wasComposing = compositionStarted;
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

export function markdownWysiwygExtension(): Extension {
  return [
    protectedSourceRangesExtension(),
    markdownDecorationsPlugin,
    paragraphEditingKeymap(),
    keymapExtension(),
  ];
}

function keymapExtension(): Extension {
  return keymap.of([
    {
      key: 'Mod-Enter',
      run: toggleTaskListCommand,
    },
  ]);
}
