import type { EditorState } from '@codemirror/state';
import {
  documentSourceFormatField,
  serializeDocumentSourceLines,
} from '../../editor/core/documentSourceFormat';

export type ImageDestinationReplacement = {
  destination: string;
  from: number;
  to: number;
};

export function rewriteDocumentImageDestinations(
  state: EditorState,
  replacements: readonly ImageDestinationReplacement[],
): string {
  const format = state.field(documentSourceFormatField);
  const source = state.doc.toString();

  if (replacements.length === 0) {
    return serializeDocumentSourceLines(source, new Map(), format);
  }

  const byLine = new Map<number, ImageDestinationReplacement[]>();
  const seen = new Set<string>();

  for (const replacement of replacements) {
    if (
      replacement.from < 0 ||
      replacement.to > state.doc.length ||
      replacement.from >= replacement.to
    ) {
      throw new Error('Image destination replacement range is invalid.');
    }
    const line = state.doc.lineAt(replacement.from);
    if (replacement.to > line.to) {
      throw new Error('Image destinations must be replaced within one line.');
    }
    const key = `${replacement.from}:${replacement.to}`;
    if (seen.has(key)) {
      throw new Error('Duplicate image destination replacement.');
    }
    seen.add(key);
    const lineNumber = line.number - 1;
    const list = byLine.get(lineNumber) ?? [];
    list.push(replacement);
    byLine.set(lineNumber, list);
  }

  const lineReplacements = new Map<number, string>();

  for (const [lineNumber, list] of byLine) {
    const line = state.doc.line(lineNumber + 1);
    list.sort((left, right) => right.from - left.from);
    let updated = state.doc.sliceString(line.from, line.to);
    let previousFrom = Number.POSITIVE_INFINITY;

    for (const replacement of list) {
      if (replacement.to > previousFrom) {
        throw new Error('Image destination replacements overlap.');
      }
      previousFrom = replacement.from;
      updated =
        updated.slice(0, replacement.from - line.from) +
        replacement.destination +
        updated.slice(replacement.to - line.from);
    }

    lineReplacements.set(lineNumber, updated);
  }

  return serializeDocumentSourceLines(source, lineReplacements, format);
}
