import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  createEditorState,
  type CreateEditorStateOptions,
} from './createEditorState';

export type CreateEditorApiOptions = Omit<
  CreateEditorStateOptions,
  'extensions'
> & {
  extensions?: readonly Extension[];
  parent: HTMLElement;
};

export type EditorApi = {
  readonly view: EditorView;
  destroy: () => void;
  focus: () => void;
  getDocumentText: () => string;
  loadDocument: (doc: string) => void;
};

export class CodeMirrorEditorApi implements EditorApi {
  private readonly editorView: EditorView;

  constructor(options: CreateEditorApiOptions) {
    this.editorView = new EditorView({
      parent: options.parent,
      state: createEditorState({
        doc: options.doc,
        extensions: options.extensions,
        onDocumentChanged: options.onDocumentChanged,
        onFocusChanged: options.onFocusChanged,
      }),
    });
  }

  get view(): EditorView {
    return this.editorView;
  }

  destroy(): void {
    this.editorView.destroy();
  }

  focus(): void {
    this.editorView.focus();
  }

  getDocumentText(): string {
    return this.editorView.state.doc.toString();
  }

  loadDocument(doc: string): void {
    this.editorView.dispatch({
      changes: {
        from: 0,
        insert: doc,
        to: this.editorView.state.doc.length,
      },
      selection: EditorSelection.cursor(doc.length),
      scrollIntoView: true,
    });
  }
}

export function createEditorApi(options: CreateEditorApiOptions): EditorApi {
  return new CodeMirrorEditorApi(options);
}
