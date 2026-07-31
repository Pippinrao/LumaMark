import { syntaxTree } from '@codemirror/language';
import {
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import type { EditorInteractionRange } from './editorInteractionContext';

const CALLOUT_MARKER_PATTERN =
  /^>\s*\[![A-Za-z][A-Za-z0-9_-]*\](?:[+-])?(?:\s.*)?$/;
const FENCED_CODE_DELIMITER_PATTERN = /^(?:`{3,}|~{3,})$/;
export type ProtectedSourceRangeState = {
  readonly ranges: readonly EditorInteractionRange[];
  /** Test-visible only: increments when syntax must be rescanned. */
  readonly scanGeneration: number;
};
const protectedSourceRangeCache = new WeakMap<
  ReturnType<typeof syntaxTree>,
  readonly EditorInteractionRange[]
>();

function collectYamlFrontMatterRange(
  state: EditorState,
): EditorInteractionRange | null {
  if (
    state.doc.lines < 2 ||
    state.doc.line(1).text !== '---'
  ) {
    return null;
  }

  for (let lineNumber = 2; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);

    if (line.text === '---' || line.text === '...') {
      return {
        from: 0,
        to: line.to,
      };
    }
  }

  return null;
}

function isFootnoteLabel(source: string): boolean {
  return (
    source.startsWith('[^') &&
    source.endsWith(']') &&
    source.length > 3
  );
}

function mergeRanges(
  ranges: readonly EditorInteractionRange[],
): EditorInteractionRange[] {
  const sorted = [...ranges].sort(
    (left, right) =>
      left.from - right.from ||
      left.to - right.to,
  );
  const merged: { from: number; to: number }[] = [];

  for (const range of sorted) {
    const previous = merged.at(-1);

    if (previous && range.from < previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

function scanProtectedSourceRanges(
  state: EditorState,
): readonly EditorInteractionRange[] {
  const tree = syntaxTree(state);

  const ranges: EditorInteractionRange[] = [];
  const yamlFrontMatter = collectYamlFrontMatterRange(state);

  if (yamlFrontMatter) {
    ranges.push(yamlFrontMatter);
  }

  tree.iterate({
    enter(node) {
      if (node.name === 'LinkReference') {
        const label = node.node.getChild('LinkLabel');

        if (
          label &&
          isFootnoteLabel(
            state.doc.sliceString(label.from, label.to),
          )
        ) {
          ranges.push({ from: node.from, to: node.to });
        }
        return;
      }

      if (node.name === 'Link') {
        const source = state.doc.sliceString(node.from, node.to);

        if (isFootnoteLabel(source)) {
          ranges.push({ from: node.from, to: node.to });
          return;
        }

        if (source.toLowerCase() === '[toc]') {
          const line = state.doc.lineAt(node.from);

          if (line.text.trim().toLowerCase() === '[toc]') {
            ranges.push({ from: line.from, to: line.to });
          }
        }
        return;
      }

      if (node.name === 'Blockquote') {
        const firstLine = state.doc.lineAt(node.from);
        const firstLineSource = state.doc.sliceString(
          node.from,
          firstLine.to,
        );

        if (CALLOUT_MARKER_PATTERN.test(firstLineSource)) {
          ranges.push({ from: node.from, to: node.to });
        }
      }
    },
  });

  return mergeRanges(ranges);
}

function mapRanges(
  ranges: readonly EditorInteractionRange[],
  transaction: Transaction,
): readonly EditorInteractionRange[] {
  return ranges.map((range) => ({
    from: transaction.changes.mapPos(range.from, -1),
    to: transaction.changes.mapPos(range.to, 1),
  }));
}

function changesTouchProtectedRange(
  transaction: Transaction,
  ranges: readonly EditorInteractionRange[],
): boolean {
  let touches = false;

  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (!touches) {
      touches = ranges.some(
        (range) => fromA <= range.to && toA >= range.from,
      );
    }
  });

  return touches;
}

function rangeHasPotentialProtectedMarker(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const firstLine = state.doc.lineAt(from).number;
  const lastLine = state.doc.lineAt(to).number;

  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    const text = state.doc.line(lineNumber).text;
    const trimmed = text.trim();

    if (
      trimmed === '---' ||
      trimmed === '...' ||
      text.includes('[^') ||
      /\[toc/i.test(text) ||
      text.includes('[!')
    ) {
      return true;
    }
  }

  return false;
}

function rangeContainsFencedCodeDelimiter(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const lineFrom = state.doc.lineAt(from).from;
  const lineTo = state.doc.lineAt(to).to;
  let containsDelimiter = false;

  syntaxTree(state).iterate({
    from: lineFrom,
    to: lineTo,
    enter(node) {
      if (
        node.name === 'CodeMark' &&
        node.node.parent?.name === 'FencedCode' &&
        FENCED_CODE_DELIMITER_PATTERN.test(
          state.doc.sliceString(node.from, node.to),
        )
      ) {
        containsDelimiter = true;
      }
    },
  });

  return containsDelimiter;
}

function changesMayAffectProtectedMarkers(transaction: Transaction): boolean {
  let affectsMarkers = false;

  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (!affectsMarkers) {
      affectsMarkers =
        rangeHasPotentialProtectedMarker(transaction.startState, fromA, toA) ||
        rangeHasPotentialProtectedMarker(transaction.state, fromB, toB) ||
        rangeContainsFencedCodeDelimiter(
          transaction.startState,
          fromA,
          toA,
        ) ||
        rangeContainsFencedCodeDelimiter(transaction.state, fromB, toB);
    }
  });

  return affectsMarkers;
}

export const protectedSourceRangesField = StateField.define<ProtectedSourceRangeState>({
  create: (state) => ({
    ranges: scanProtectedSourceRanges(state),
    scanGeneration: 1,
  }),
  update: (value, transaction) => {
    if (!transaction.docChanged) {
      return value;
    }

    if (
      changesTouchProtectedRange(transaction, value.ranges) ||
      changesMayAffectProtectedMarkers(transaction)
    ) {
      return {
        ranges: scanProtectedSourceRanges(transaction.state),
        scanGeneration: value.scanGeneration + 1,
      };
    }

    return {
      ranges: mapRanges(value.ranges, transaction),
      scanGeneration: value.scanGeneration,
    };
  },
});

export function protectedSourceRangesExtension(): Extension {
  return protectedSourceRangesField;
}

export function collectProtectedSourceRanges(
  state: EditorState,
): readonly EditorInteractionRange[] {
  const fieldValue = state.field(protectedSourceRangesField, false);

  if (fieldValue) {
    return fieldValue.ranges;
  }

  const tree = syntaxTree(state);
  const cached = protectedSourceRangeCache.get(tree);

  if (cached) {
    return cached;
  }

  const ranges = scanProtectedSourceRanges(state);
  protectedSourceRangeCache.set(tree, ranges);
  return ranges;
}
