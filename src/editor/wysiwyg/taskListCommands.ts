import { syntaxTree } from '@codemirror/language';
import type { ChangeSpec, EditorState } from '@codemirror/state';
import type { Command } from '@codemirror/view';

function innermostListItemAtPosition(state: EditorState, position: number) {
  const tree = syntaxTree(state);
  const resolveListItem = (bias: -1 | 1) => {
    const initialNode = tree.resolveInner(position, bias);
    let node: typeof initialNode | null = initialNode;

    while (node) {
      if (node.name === 'FencedCode') {
        return { blocked: true, listItem: null };
      }

      if (node.name === 'ListItem') {
        return { blocked: false, listItem: node };
      }

      node = node.parent;
    }

    return { blocked: false, listItem: null };
  };
  const before = resolveListItem(-1);
  const after = resolveListItem(1);

  if (before.blocked || after.blocked) {
    return null;
  }

  if (!before.listItem || !after.listItem) {
    return before.listItem ?? after.listItem;
  }

  return before.listItem.to - before.listItem.from <=
    after.listItem.to - after.listItem.from ? before.listItem : after.listItem;
}

export function toggleTaskAtPosition(
  state: EditorState,
  position: number,
): ChangeSpec | null {
  if (state.readOnly) {
    return null;
  }

  const listItem = innermostListItemAtPosition(state, position);
  const task = listItem?.getChild('Task');
  const marker = task?.getChild('TaskMarker');

  if (!marker) {
    return null;
  }

  const stateCharacter = state.doc.sliceString(marker.from + 1, marker.from + 2);
  const insert = stateCharacter === ' ' ? 'x' :
    stateCharacter === 'x' || stateCharacter === 'X' ? ' ' : null;

  if (insert === null) {
    return null;
  }

  return {
    from: marker.from + 1,
    insert,
    to: marker.from + 2,
  };
}

export function toggleTaskListAtSelection(
  state: EditorState,
): ChangeSpec | null {
  return toggleTaskAtPosition(state, state.selection.main.head);
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
