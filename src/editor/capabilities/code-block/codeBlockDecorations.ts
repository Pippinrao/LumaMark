import { syntaxTree } from '@codemirror/language';
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { deriveEditorInteractionContext } from '../../interaction/editorInteractionContext';
import type { MarkdownDecorationRange } from '../../markdown/markdownDecorationTypes';
import { iterateLines } from '../../markdown/markdownDecorationTypes';
import { codeLanguageDisplayName } from '../../markdown/markdownLanguage';
import './codeBlock.css';

const INLINE_CODE_PATTERN = /`[^`\n]+?`/g;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;
const VIEWPORT_BUFFER_LINES = 20;

type MarkdownSyntaxNode = ReturnType<
  ReturnType<typeof syntaxTree>['resolveInner']
>;

type ActiveCodeFence = {
  char: '`' | '~';
  length: number;
  start: number;
};

type ActiveCodeBlockRange = {
  from: number;
  to: number;
};

export function collectCodeDecorations(
  markdown: string,
): MarkdownDecorationRange[] {
  const ranges: MarkdownDecorationRange[] = [];
  let activeFence: ActiveCodeFence | null = null;

  for (const line of iterateLines(markdown)) {
    const fence = parseFence(line.text);

    if (fence) {
      if (
        activeFence &&
        fence.char === activeFence.char &&
        fence.length >= activeFence.length
      ) {
        ranges.push({
          className: 'lm-md-code-block',
          from: activeFence.start,
          kind: 'codeBlock',
          to: line.to,
        });
        activeFence = null;
        continue;
      }

      if (!activeFence) {
        activeFence = {
          ...fence,
          start: line.from,
        };
      }
      continue;
    }

    if (activeFence) {
      continue;
    }

    for (const match of line.text.matchAll(INLINE_CODE_PATTERN)) {
      ranges.push({
        className: 'lm-md-inline-code',
        from: line.from + match.index,
        kind: 'inlineCode',
        to: line.from + match.index + match[0].length,
      });
    }
  }

  if (activeFence) {
    ranges.push({
      className: 'lm-md-code-block',
      from: activeFence.start,
      kind: 'codeBlock',
      to: markdown.length,
    });
  }

  return ranges;
}

export function collectInlineCodeDecorations(
  markdown: string,
  offset = 0,
): MarkdownDecorationRange[] {
  return iterateLines(markdown).flatMap<MarkdownDecorationRange>((line) =>
    [...line.text.matchAll(INLINE_CODE_PATTERN)].map((match) => ({
      className: 'lm-md-inline-code',
      from: offset + line.from + match.index,
      kind: 'inlineCode',
      to: offset + line.from + match.index + match[0].length,
    })),
  );
}

export function codeBlockSyntaxDecorationRange({
  from,
  name,
  to,
}: {
  from: number;
  name: string;
  to: number;
}): MarkdownDecorationRange | null {
  if (name === 'FencedCode') {
    return {
      className: 'lm-md-code-block',
      from,
      kind: 'codeBlock',
      to,
    };
  }

  if (name === 'InlineCode') {
    return {
      className: 'lm-md-inline-code',
      from,
      kind: 'inlineCode',
      to,
    };
  }

  return null;
}

export function codeBlockPreviewExtension(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        activeCodeBlocks: ActiveCodeBlockRange[];
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.activeCodeBlocks = activeCodeBlockRanges(view);
          this.decorations = buildCodeBlockLineDecorations(
            view,
            this.activeCodeBlocks,
          );
        }

        update(update: ViewUpdate) {
          const nextActiveCodeBlocks = activeCodeBlockRanges(update.view);
          const activeCodeBlocksChanged =
            activeCodeBlockKey(nextActiveCodeBlocks) !==
            activeCodeBlockKey(this.activeCodeBlocks);

          if (
            update.docChanged ||
            update.viewportChanged ||
            activeCodeBlocksChanged ||
            syntaxTree(update.startState) !== syntaxTree(update.state)
          ) {
            this.decorations = buildCodeBlockLineDecorations(
              update.view,
              nextActiveCodeBlocks,
            );
          }

          this.activeCodeBlocks = nextActiveCodeBlocks;
        }
      },
      {
        decorations: (plugin) => plugin.decorations,
      },
    ),
    EditorView.contentAttributes.of((view) => {
      const language = activeCodeBlockLanguage(view);

      return language ? { 'aria-description': language } : null;
    }),
  ];
}

function buildCodeBlockLineDecorations(
  view: EditorView,
  activeCodeBlocks: readonly ActiveCodeBlockRange[],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const state = view.state;

  for (const visibleRange of bufferedVisibleRanges(view)) {
    syntaxTree(state).iterate({
      from: visibleRange.from,
      to: visibleRange.to,
      enter(node) {
        if (node.name !== 'FencedCode') {
          return;
        }

        const firstLine = state.doc.lineAt(node.from);
        const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1));
        const firstVisibleLine = state.doc.lineAt(visibleRange.from).number;
        const lastVisibleLine = state.doc.lineAt(visibleRange.to).number;
        const isActive = activeCodeBlocks.some(
          ({ from, to }) => from === node.from && to === node.to,
        );
        const hasClosingFence = fencedCodeHasClosingMark(node.node);
        const language = isActive
          ? codeLanguageForFencedNode(state, node.node)
          : null;

        for (
          let lineNumber = Math.max(firstLine.number, firstVisibleLine);
          lineNumber <= Math.min(lastLine.number, lastVisibleLine);
          lineNumber += 1
        ) {
          const line = state.doc.line(lineNumber);
          const classes = ['lm-md-code-block-line'];

          if (lineNumber === firstLine.number) {
            classes.push('lm-md-code-block-start');
          }

          if (hasClosingFence && lineNumber === lastLine.number) {
            classes.push('lm-md-code-block-end');
          }

          if (isActive) {
            classes.push('lm-md-code-block-active');
          }

          builder.add(
            line.from,
            line.from,
            Decoration.line({
              class: classes.join(' '),
              ...(language
                ? {
                    attributes: {
                      'aria-description': language,
                      ...(lineNumber === firstLine.number
                        ? { 'data-lm-code-language': language }
                        : {}),
                    },
                  }
                : {}),
            }),
          );
        }
      },
    });
  }

  return builder.finish();
}

function activeCodeBlockLanguage(view: EditorView): string | null {
  const activeCodeBlock = activeCodeBlockRanges(view)[0];
  let language: string | null = null;

  if (!activeCodeBlock) {
    return null;
  }

  syntaxTree(view.state).iterate({
    from: activeCodeBlock.from,
    to: activeCodeBlock.to,
    enter(node) {
      if (
        node.name === 'FencedCode' &&
        node.from === activeCodeBlock.from &&
        node.to === activeCodeBlock.to
      ) {
        language = codeLanguageForFencedNode(view.state, node.node);
        return false;
      }
    },
  });

  return language;
}

function codeLanguageForFencedNode(
  state: EditorState,
  node: MarkdownSyntaxNode,
): string | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CodeInfo') {
      return codeLanguageDisplayName(
        state.doc.sliceString(child.from, child.to),
      );
    }
  }

  return null;
}

function fencedCodeHasClosingMark(node: MarkdownSyntaxNode): boolean {
  const openingMark = node.firstChild;

  if (openingMark?.name !== 'CodeMark') {
    return false;
  }

  for (
    let child = openingMark.nextSibling;
    child;
    child = child.nextSibling
  ) {
    if (child.name === 'CodeMark') {
      return true;
    }
  }

  return false;
}

function activeCodeBlockRanges(view: EditorView): ActiveCodeBlockRange[] {
  if (view.state.readOnly) {
    return [];
  }

  return deriveEditorInteractionContext(
    view.state,
    view.composing,
  ).activeBlocks.flatMap((block) =>
    block.kind === 'FencedCode'
      ? [{ from: block.from, to: block.to }]
      : [],
  );
}

function activeCodeBlockKey(
  activeCodeBlocks: readonly ActiveCodeBlockRange[],
): string {
  return activeCodeBlocks.map(({ from, to }) => `${from}:${to}`).join('|');
}

function bufferedVisibleRanges(view: EditorView): { from: number; to: number }[] {
  const ranges = view.visibleRanges.map(({ from, to }) => {
    const firstLine = view.state.doc.lineAt(from).number;
    const lastLine = view.state.doc.lineAt(to).number;

    return {
      from: view.state.doc.line(Math.max(1, firstLine - VIEWPORT_BUFFER_LINES)).from,
      to: view.state.doc.line(
        Math.min(view.state.doc.lines, lastLine + VIEWPORT_BUFFER_LINES),
      ).to,
    };
  });

  const mergedRanges: { from: number; to: number }[] = [];

  for (const range of ranges) {
    const previous = mergedRanges.at(-1);

    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      mergedRanges.push(range);
    }
  }

  return mergedRanges;
}

function parseFence(text: string): Pick<ActiveCodeFence, 'char' | 'length'> | null {
  const match = text.match(FENCE_PATTERN);

  if (!match) {
    return null;
  }

  return {
    char: match[1][0] as '`' | '~',
    length: match[1].length,
  };
}
