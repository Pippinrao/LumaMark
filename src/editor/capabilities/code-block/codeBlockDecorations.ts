import { syntaxTree } from '@codemirror/language';
import {
  type Extension,
  RangeSetBuilder,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from '@codemirror/view';
import type { MarkdownDecorationRange } from '../../markdown/markdownDecorationTypes';
import { iterateLines } from '../../markdown/markdownDecorationTypes';

const INLINE_CODE_PATTERN = /`[^`\n]+?`/g;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;

type ActiveCodeFence = {
  char: '`' | '~';
  length: number;
  start: number;
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
  return StateField.define<DecorationSet>({
    create(state) {
      return buildCodeBlockLineDecorations(state);
    },
    update(value, transaction) {
      if (transaction.docChanged) {
        return buildCodeBlockLineDecorations(transaction.state);
      }

      return value.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function buildCodeBlockLineDecorations(
  state: EditorView['state'],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') {
        return;
      }

      const firstLine = state.doc.lineAt(node.from);
      const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1));

      for (
        let lineNumber = firstLine.number;
        lineNumber <= lastLine.number;
        lineNumber += 1
      ) {
        const line = state.doc.line(lineNumber);
        const classes = ['lm-md-code-block-line'];

        if (lineNumber === firstLine.number) {
          classes.push('lm-md-code-block-start');
        }

        if (lineNumber === lastLine.number) {
          classes.push('lm-md-code-block-end');
        }

        builder.add(
          line.from,
          line.from,
          Decoration.line({
            class: classes.join(' '),
          }),
        );
      }
    },
  });

  return builder.finish();
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
