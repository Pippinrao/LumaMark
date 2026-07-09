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
import { codeBlockSyntaxDecorationRange } from '../capabilities/code-block/codeBlockDecorations';
import { markdownLanguage } from '../markdown/markdownLanguage';
import type { MarkdownDecorationRange } from './decorationTypes';
import { toggleTaskListCommand } from './taskListCommands';
import './wysiwyg.css';

export type { MarkdownDecorationRange } from './decorationTypes';

type TaskMarker = {
  checked: boolean;
  from: number;
};

type DecorationItem = {
  decoration: Decoration;
  from: number;
  to: number;
};

const INLINE_MARK_NODE_NAMES = new Set([
  'CodeMark',
  'EmphasisMark',
  'StrikethroughMark',
]);

export function collectMarkdownDecorationRanges(
  markdown: string,
): MarkdownDecorationRange[] {
  const state = EditorState.create({
    doc: markdown,
    extensions: [markdownLanguage()],
  });

  return collectSyntaxDecorationRanges(state).sort(
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

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly markerPosition: number,
  ) {
    super();
  }

  eq(widget: TaskCheckboxWidget): boolean {
    return (
      widget.checked === this.checked &&
      widget.markerPosition === this.markerPosition
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement('button');
    checkbox.type = 'button';
    checkbox.className = 'lm-md-task-checkbox';
    checkbox.dataset.checked = String(this.checked);
    checkbox.setAttribute('aria-hidden', 'true');
    checkbox.tabIndex = -1;
    checkbox.addEventListener('click', (event) => {
      event.preventDefault();
      view.dispatch({
        changes: {
          from: this.markerPosition,
          insert: this.checked ? '[ ]' : '[x]',
          to: this.markerPosition + 3,
        },
        userEvent: 'input.toggle-task',
      });
      view.focus();
    });

    return checkbox;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const decorations: DecorationItem[] = [];

  for (const item of collectListLineDecorations(view.state, view.visibleRanges)) {
    decorations.push(item);
  }

  for (const range of collectSyntaxDecorationRanges(view.state, view.visibleRanges)) {
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

  for (const marker of collectTaskMarkersFromSyntax(view.state, view.visibleRanges)) {
    decorations.push({
      decoration: Decoration.widget({
        side: -1,
        widget: new TaskCheckboxWidget(marker.checked, marker.from),
      }),
      from: marker.from,
      to: marker.from,
    });
  }

  for (const marker of collectUnorderedListMarkers(view)) {
    decorations.push(marker);
  }

  for (const mark of collectHiddenMarkdownMarks(view)) {
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
): MarkdownDecorationRange[] {
  const decorationRanges: MarkdownDecorationRange[] = [];

  for (const range of ranges ?? [{ from: 0, to: state.doc.length }]) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
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
  const codeDecoration = codeBlockSyntaxDecorationRange({ from, name, to });

  if (codeDecoration) {
    return codeDecoration;
  }

  if (/^ATXHeading[1-6]$/.test(name)) {
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

function collectUnorderedListMarkers(view: EditorView): DecorationItem[] {
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
        if (
          !/^[-*+]$/.test(marker) ||
          taskMarker ||
          isRangeOnActiveLine(view, node.from, node.to)
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
): TaskMarker[] {
  const markers: TaskMarker[] = [];

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'TaskMarker') {
          return;
        }

        markers.push({
          checked: state.doc.sliceString(node.from, node.to).toLowerCase() === '[x]',
          from: node.from,
        });
      }
    });
  }

  return markers;
}

function collectListLineDecorations(
  state: EditorView['state'],
  ranges: readonly { from: number; to: number }[],
): DecorationItem[] {
  const items: DecorationItem[] = [];

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'ListItem') {
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

function collectHiddenMarkdownMarks(view: EditorView): DecorationItem[] {
  const marks: DecorationItem[] = [];

  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (
          !shouldHideSyntaxNode(node.name, node.node.parent?.name) ||
          isRangeOnActiveLine(view, node.from, node.to)
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
    INLINE_MARK_NODE_NAMES.has(name)
  ) {
    return true;
  }

  return name === 'URL' && parentName === 'Link';
}

function isRangeOnActiveLine(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some((selectionRange) => {
    const selectionLine = view.state.doc.lineAt(selectionRange.head);
    return from >= selectionLine.from && to <= selectionLine.to;
  });
}

const markdownDecorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

export function markdownWysiwygExtension(): Extension {
  return [markdownDecorationsPlugin, keymapExtension()];
}

function keymapExtension(): Extension {
  return keymap.of([
    {
      key: 'Mod-Enter',
      run: toggleTaskListCommand,
    },
  ]);
}
