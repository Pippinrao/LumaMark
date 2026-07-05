import { syntaxTree } from '@codemirror/language';
import type { EditorView, KeyBinding } from '@codemirror/view';
import { insertEmptyMarkdownTable } from 'codemirror-markdown-tables';

type MarkdownTableBlock = {
  from: number;
  to: number;
};

export function insertMarkdownTable(view: EditorView): boolean {
  return insertEmptyMarkdownTable()(view);
}

export async function copyCurrentMarkdownTable(
  view: EditorView,
): Promise<boolean> {
  const table = tableAtSelection(view);

  if (!table || !navigator.clipboard) {
    return false;
  }

  await navigator.clipboard.writeText(
    view.state.doc.sliceString(table.from, table.to),
  );

  return true;
}

export function deleteCurrentMarkdownTable(view: EditorView): boolean {
  const table = tableAtSelection(view);

  if (!table) {
    return false;
  }

  view.dispatch({
    changes: {
      from: table.from,
      to: table.to,
    },
    userEvent: 'delete.table',
  });

  return true;
}

export const tableKeymap: readonly KeyBinding[] = [
  {
    key: 'Alt-Mod-t',
    run: insertMarkdownTable,
  },
  {
    key: 'Alt-Mod-c',
    run(view) {
      const table = tableAtSelection(view);

      if (!table) {
        return false;
      }

      void copyCurrentMarkdownTable(view);

      return true;
    },
  },
  {
    key: 'Alt-Mod-Backspace',
    run: deleteCurrentMarkdownTable,
  },
];

function tableAtSelection(view: EditorView): MarkdownTableBlock | null {
  const head = view.state.selection.main.head;
  let table: MarkdownTableBlock | null = null;

  syntaxTree(view.state).iterate({
    enter(node) {
      if (table || node.name !== 'Table') {
        return;
      }

      if (head >= node.from && head <= node.to) {
        table = {
          from: node.from,
          to: node.to,
        };
      }
    },
  });

  return table;
}
