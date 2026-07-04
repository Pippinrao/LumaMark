import { syntaxTree } from '@codemirror/language';
import { type Extension, RangeSetBuilder } from '@codemirror/state';
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
import { collectBlockquoteDecorations } from './blockquoteDecorations';
import {
  collectCodeDecorations,
  collectInlineCodeDecorations,
} from './codeDecorations';
import type { MarkdownDecorationRange } from './decorationTypes';
import { iterateLines } from './decorationTypes';
import { collectEmphasisDecorations } from './emphasisDecorations';
import { collectHeadingDecorations } from './headingDecorations';
import { collectListDecorations } from './listDecorations';
import { parseTaskListMarker } from './taskListMarkers';
import { toggleTaskListCommand } from './taskListCommands';
import './wysiwyg.css';

export type { MarkdownDecorationRange } from './decorationTypes';

type TaskMarker = {
  checked: boolean;
  from: number;
};

type AbsoluteRange = {
  from: number;
  to: number;
};

type CollectVisibleMarkdownDecorationRangesOptions = {
  codeBlockRanges: readonly AbsoluteRange[];
  markdown: string;
  offset: number;
};

export function collectMarkdownDecorationRanges(
  markdown: string,
): MarkdownDecorationRange[] {
  const codeRanges = collectCodeDecorations(markdown);
  const codeBlockRanges = codeRanges.filter(
    (range) => range.kind === 'codeBlock',
  );
  const blockRanges = [
    ...collectHeadingDecorations(markdown),
    ...collectBlockquoteDecorations(markdown),
    ...collectListDecorations(markdown),
  ].filter((range) => !isInsideCodeRange(range, codeBlockRanges));
  const emphasisRanges = collectEmphasisDecorations(markdown).filter(
    (range) => !isInsideCodeRange(range, codeRanges),
  );

  return [
    ...blockRanges,
    ...codeRanges,
    ...emphasisRanges,
  ].sort((left, right) => left.from - right.from || left.to - right.to);
}

export function collectVisibleMarkdownDecorationRanges({
  codeBlockRanges,
  markdown,
  offset,
}: CollectVisibleMarkdownDecorationRangesOptions): MarkdownDecorationRange[] {
  const blockRanges = [
    ...collectHeadingDecorations(markdown),
    ...collectBlockquoteDecorations(markdown),
    ...collectListDecorations(markdown),
  ]
    .map((range) => toAbsoluteRange(range, offset))
    .filter((range) => !isInsideAbsoluteRange(range, codeBlockRanges));
  const inlineCodeRanges = collectInlineCodeDecorations(markdown, offset).filter(
    (range) => !isInsideAbsoluteRange(range, codeBlockRanges),
  );
  const emphasisRanges = collectEmphasisDecorations(markdown)
    .map((range) => toAbsoluteRange(range, offset))
    .filter(
      (range) =>
        !isInsideAbsoluteRange(range, codeBlockRanges) &&
        !isInsideAbsoluteRange(range, inlineCodeRanges),
    );

  return [
    ...blockRanges,
    ...inlineCodeRanges,
    ...emphasisRanges,
  ].sort((left, right) => left.from - right.from || left.to - right.to);
}

function toAbsoluteRange(
  range: MarkdownDecorationRange,
  offset: number,
): MarkdownDecorationRange {
  return {
    ...range,
    from: offset + range.from,
    to: offset + range.to,
  };
}

function isInsideCodeRange(
  range: MarkdownDecorationRange,
  codeRanges: MarkdownDecorationRange[],
): boolean {
  return codeRanges.some(
    (codeRange) => range.from >= codeRange.from && range.to <= codeRange.to,
  );
}

function collectTaskMarkers(markdown: string, offset = 0): TaskMarker[] {
  const markers: TaskMarker[] = [];

  for (const line of iterateLines(markdown)) {
    const marker = parseTaskListMarker(line.text);

    if (!marker) {
      continue;
    }

    markers.push({
      checked: marker.checked,
      from: offset + line.from + marker.taskMarkerFrom,
    });
  }

  return markers;
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
  const decorations: Array<{
    decoration: Decoration;
    from: number;
    to: number;
  }> = [];

  for (const visibleRange of view.visibleRanges) {
    const fromLine = view.state.doc.lineAt(visibleRange.from);
    const toLine = view.state.doc.lineAt(visibleRange.to);
    const from = fromLine.from;
    const to = toLine.to;
    const markdown = view.state.doc.sliceString(from, to);
    const codeBlockRanges = collectVisibleCodeBlockRanges(view, from, to);

    for (const range of collectVisibleMarkdownDecorationRanges({
      codeBlockRanges,
      markdown,
      offset: from,
    })) {
      if (range.from === range.to) {
        continue;
      }

      if (range.to < visibleRange.from || range.from > visibleRange.to) {
        continue;
      }

      decorations.push({
        decoration: Decoration.mark({ class: range.className }),
        from: range.from,
        to: range.to,
      });
    }

    for (const range of codeBlockRanges) {
      decorations.push({
        decoration: Decoration.mark({ class: 'lm-md-code-block' }),
        from: Math.max(range.from, from),
        to: Math.min(range.to, to),
      });
    }

    for (const marker of collectTaskMarkers(markdown, from)) {
      if (marker.from < visibleRange.from || marker.from > visibleRange.to) {
        continue;
      }

      if (isInsideAbsoluteRange(marker.from, codeBlockRanges)) {
        continue;
      }

      decorations.push({
        decoration: Decoration.widget({
          side: -1,
          widget: new TaskCheckboxWidget(marker.checked, marker.from),
        }),
        from: marker.from,
        to: marker.from,
      });
    }
  }

  decorations.sort(
    (left, right) => left.from - right.from || left.to - right.to,
  );

  for (const item of decorations) {
    builder.add(item.from, item.to, item.decoration);
  }

  return builder.finish();
}

function collectVisibleCodeBlockRanges(
  view: EditorView,
  from: number,
  to: number,
): AbsoluteRange[] {
  const ranges: AbsoluteRange[] = [];

  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== 'FencedCode') {
        return;
      }

      ranges.push({
        from: node.from,
        to: node.to,
      });
    },
  });

  return ranges;
}

function isInsideAbsoluteRange(
  item: AbsoluteRange | number,
  ranges: readonly AbsoluteRange[],
): boolean {
  if (typeof item === 'number') {
    return ranges.some((range) => item >= range.from && item < range.to);
  }

  return ranges.some((range) => item.from >= range.from && item.to <= range.to);
}

const markdownDecorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

export function markdownWysiwygExtension(): Extension {
  return [markdownLanguage(), markdownDecorationsPlugin, keymapExtension()];
}

function keymapExtension(): Extension {
  return keymap.of([
    {
      key: 'Mod-Enter',
      run: toggleTaskListCommand,
    },
  ]);
}
