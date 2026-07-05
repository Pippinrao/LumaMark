import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  createEditorState,
  type CreateEditorStateOptions,
} from './createEditorState';
import {
  editorDisplayModeCompartment,
  editorDisplayModeExtension,
  type EditorDocumentContext,
  type EditorDisplayMode,
} from './editorDisplayMode';

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
  getDisplayMode: () => EditorDisplayMode;
  getDocumentText: () => string;
  loadDocument: (doc: string) => void;
  setDocumentContext: (context: EditorDocumentContext) => void;
  setDisplayMode: (mode: EditorDisplayMode) => void;
};

export class CodeMirrorEditorApi implements EditorApi {
  private readonly editorView: EditorView;
  private documentContext: EditorDocumentContext;
  private displayMode: EditorDisplayMode;

  constructor(options: CreateEditorApiOptions) {
    this.displayMode = options.displayMode ?? 'livePreview';
    this.documentContext = options.documentContext ?? { path: null };
    this.editorView = new EditorView({
      parent: options.parent,
      state: createEditorState({
        displayMode: this.displayMode,
        documentContext: this.documentContext,
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

  getDisplayMode(): EditorDisplayMode {
    return this.displayMode;
  }

  loadDocument(doc: string): void {
    this.editorView.dispatch({
      changes: {
        from: 0,
        insert: doc,
        to: this.editorView.state.doc.length,
      },
      selection: EditorSelection.cursor(0),
    });
    this.editorView.scrollDOM.scrollTop = 0;
    this.editorView.scrollDOM.scrollLeft = 0;
  }

  setDocumentContext(context: EditorDocumentContext): void {
    if (context.path === this.documentContext.path) {
      return;
    }

    this.documentContext = context;
    this.editorView.dispatch({
      effects: editorDisplayModeCompartment.reconfigure(
        editorDisplayModeExtension(this.displayMode, this.documentContext),
      ),
    });
  }

  setDisplayMode(mode: EditorDisplayMode): void {
    if (mode === this.displayMode) {
      return;
    }

    this.displayMode = mode;
    this.editorView.dispatch({
      effects: editorDisplayModeCompartment.reconfigure(
        editorDisplayModeExtension(mode, this.documentContext),
      ),
    });
  }
}

export function createEditorApi(options: CreateEditorApiOptions): EditorApi {
  return new CodeMirrorEditorApi(options);
}
