import { syntaxTree } from '@codemirror/language';
import type { ChangeSpec, EditorState } from '@codemirror/state';
import type { Command } from '@codemirror/view';
import { parseTaskListMarker } from './taskListMarkers';

function taskMarkerOnLine(state: EditorState, position: number) {
  if (isPositionInsideFencedCode(state, position)) {
    return null;
  }

  const line = state.doc.lineAt(position);
  const marker = parseTaskListMarker(line.text);

  if (!marker) {
    return null;
  }

  return {
    checked: marker.checked,
    from: line.from + marker.taskMarkerFrom,
    to: line.from + marker.taskMarkerTo,
  };
}

function isPositionInsideFencedCode(state: EditorState, position: number): boolean {
  const initialNode = syntaxTree(state).resolveInner(position, -1);
  let node: typeof initialNode | null = initialNode;

  while (node) {
    if (node.name === 'FencedCode') {
      return true;
    }

    node = node.parent;
  }

  return false;
}

export function toggleTaskListAtSelection(
  state: EditorState,
): ChangeSpec | null {
  const marker = taskMarkerOnLine(state, state.selection.main.head);

  if (!marker) {
    return null;
  }

  return {
    from: marker.from,
    insert: marker.checked ? '[ ]' : '[x]',
    to: marker.to,
  };
}

export const toggleTaskListCommand: Command = (view) => {
  const changes = toggleTaskListAtSelection(view.state);

  if (!changes) {
    return false;
  }

  view.dispatch({
    changes,
    userEvent: 'input.toggle-task',
  });

  return true;
};
