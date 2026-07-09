import {
  defaultKeymap,
  history,
  historyKeymap,
} from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { mermaidLanguageExtension } from './mermaidLanguageService';

type CreateMermaidInlineEditorOptions = {
  doc: string;
  onChange: (content: string) => void;
  onEscape: () => void;
  onFocusIn: () => void;
  parent: HTMLElement;
};

export function createMermaidInlineEditor({
  doc,
  onChange,
  onEscape,
  onFocusIn,
  parent,
}: CreateMermaidInlineEditorOptions): EditorView {
  const editor = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        EditorView.lineWrapping,
        mermaidLanguageExtension(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
      ],
    }),
  });

  editor.dom.addEventListener('focusin', onFocusIn);
  editor.dom.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    onEscape();
  });
  editor.contentDOM.addEventListener('input', () => {
    const stateContent = editor.state.doc.toString();
    onChange(stateContent && stateContent !== doc
      ? stateContent
      : editor.contentDOM.textContent ?? '');
  });

  return editor;
}
