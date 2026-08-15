import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { insertEmptyMarkdownTable } from 'codemirror-markdown-tables';
import type { EditorInteractionRange } from '../../interaction';

type MarkdownTableBlock = {
  from: number;
  to: number;
};

export function insertMarkdownTable(view: EditorView): boolean {
  if (view.state.readOnly) {
    return false;
  }

  return insertEmptyMarkdownTable()(view);
}

export async function copyCurrentMarkdownTable(
  view: EditorView,
  range?: EditorInteractionRange,
  writeClipboardText: ((text: string) => Promise<void>) | null = null,
): Promise<boolean> {
  const table = resolveTable(view, range);

  if (!table || !writeClipboardText) {
    return false;
  }

  await writeClipboardText(view.state.doc.sliceString(table.from, table.to));

  return true;
}

export function deleteCurrentMarkdownTable(
  view: EditorView,
  range?: EditorInteractionRange,
): boolean {
  if (view.state.readOnly) {
    return false;
  }

  const table = resolveTable(view, range);

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

export function createTableCommands(
  view: EditorView,
  writeClipboardText?: (text: string) => Promise<void>,
): {
  copyTable(range?: EditorInteractionRange): Promise<boolean>;
  deleteTable(range?: EditorInteractionRange): boolean;
  insertTable(): boolean;
} {
  return {
    copyTable: (range) =>
      copyCurrentMarkdownTable(
        view,
        range,
        writeClipboardText ?? null,
      ),
    deleteTable: (range) => deleteCurrentMarkdownTable(view, range),
    insertTable: () => insertMarkdownTable(view),
  };
}

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

function resolveTable(
  view: EditorView,
  range?: EditorInteractionRange,
): MarkdownTableBlock | null {
  if (!range) {
    return tableAtSelection(view);
  }

  let table: MarkdownTableBlock | null = null;
  syntaxTree(view.state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      if (
        !table &&
        node.name === 'Table' &&
        node.from === range.from &&
        node.to === range.to
      ) {
        table = { from: node.from, to: node.to };
      }
    },
  });

  return table;
}
