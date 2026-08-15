import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export function createCodeBlockCommands(view: EditorView): {
  wrapCodeBlock(): boolean;
} {
  return {
    wrapCodeBlock: () => wrapCodeBlockSelection(view),
  };
}

function isClosingFenceLine(line: string): boolean {
  return /^\s{0,3}(?:`{3,}|~{3,})\s*$/.test(line);
}

export function shouldInsertAfterFinalFence({
  document,
  from,
  to,
}: {
  document: string;
  from: number;
  to: number;
}): boolean {
  if (from !== to || from !== document.length) {
    return false;
  }

  return isClosingFenceLine(document.slice(document.lastIndexOf('\n') + 1));
}

export function wrapCodeBlockSelection(view: EditorView): boolean {
  const selection = view.state.selection.main;
  const selectedText = view.state.doc.sliceString(selection.from, selection.to);
  const content = selectedText;
  const insert = `\`\`\`\n${content}\n\`\`\``;
  const cursorFrom = selection.from + 4;
  const cursorTo = cursorFrom + content.length;

  view.dispatch({
    changes: {
      from: selection.from,
      insert,
      to: selection.to,
    },
    selection: EditorSelection.range(cursorFrom, cursorTo),
    userEvent: 'input.format',
  });
  view.focus();

  return true;
}
