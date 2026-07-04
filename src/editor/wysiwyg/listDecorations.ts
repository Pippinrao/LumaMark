import type { MarkdownDecorationRange } from './decorationTypes';
import { iterateLines } from './decorationTypes';
import { parseTaskListMarker } from './taskListMarkers';

const UNORDERED_PATTERN = /^(\s{0,3}[-*+])\s+/;
const ORDERED_PATTERN = /^(\s{0,3}\d+[.)])\s+/;

export function collectListDecorations(
  markdown: string,
): MarkdownDecorationRange[] {
  return iterateLines(markdown).flatMap<MarkdownDecorationRange>((line) => {
    const taskMarker = parseTaskListMarker(line.text);
    if (taskMarker) {
      return [
        {
          className: 'lm-md-list lm-md-task-list lm-md-list-marker',
          from: line.from + taskMarker.listMarkerFrom,
          kind: 'taskList',
          to: line.from + taskMarker.listMarkerTo,
        },
      ];
    }

    const unorderedMatch = line.text.match(UNORDERED_PATTERN);
    if (unorderedMatch) {
      return [
        {
          className: 'lm-md-list lm-md-unordered-list lm-md-list-marker',
          from: line.from,
          kind: 'unorderedList',
          to: line.from + unorderedMatch[1].length,
        },
      ];
    }

    const orderedMatch = line.text.match(ORDERED_PATTERN);
    if (orderedMatch) {
      return [
        {
          className: 'lm-md-list lm-md-ordered-list lm-md-list-marker',
          from: line.from,
          kind: 'orderedList',
          to: line.from + orderedMatch[1].length,
        },
      ];
    }

    return [];
  });
}
