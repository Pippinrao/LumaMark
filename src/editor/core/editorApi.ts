import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  createEditorState,
  type CreateEditorStateOptions,
  editorSearchPhrasesCompartment,
} from './createEditorState';
import { getEditorSearchPhrases } from '../../shared/i18n/editorSearchPhrases';
import type { AppLanguage } from '../../shared/i18n';
import {
  editorDisplayModeCompartment,
  editorDisplayModeExtension,
  type EditorDocumentContext,
  type EditorDisplayMode,
} from './editorDisplayMode';
import { invalidatePendingImageImports } from '../capabilities/image/imageInputExtension';

export type CreateEditorApiOptions = Omit<
  CreateEditorStateOptions,
  'extensions'
> & {
  extensions?: readonly Extension[];
  parent: HTMLElement;
};

export type LoadDocumentOptions = {
  preserveView?: boolean;
};

export type EditorApi = {
  readonly view: EditorView;
  destroy: () => void;
  focus: () => void;
  getDisplayMode: () => EditorDisplayMode;
  getDocumentText: () => string;
  loadDocument: (doc: string, options?: LoadDocumentOptions) => void;
  setLanguage: (language: AppLanguage) => void;
  setDocumentContext: (context: EditorDocumentContext) => void;
  setDisplayMode: (mode: EditorDisplayMode) => void;
};

export class CodeMirrorEditorApi implements EditorApi {
  private readonly editorView: EditorView;
  private documentContext: EditorDocumentContext;
  private displayMode: EditorDisplayMode;
  private language: AppLanguage;

  constructor(options: CreateEditorApiOptions) {
    this.displayMode = options.displayMode ?? 'livePreview';
    this.documentContext = options.documentContext ?? { path: null };
    this.language = options.language ?? 'zh-CN';
    this.editorView = new EditorView({
      parent: options.parent,
      state: createEditorState({
        displayMode: this.displayMode,
        documentContext: this.documentContext,
        doc: options.doc,
        extensions: options.extensions,
        language: this.language,
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

  loadDocument(doc: string, options: LoadDocumentOptions = {}): void {
    const preserveView = options.preserveView ?? false;
    const scrollLeft = this.editorView.scrollDOM.scrollLeft;
    const scrollTop = this.editorView.scrollDOM.scrollTop;
    const selection = preserveView
      ? EditorSelection.create(
          this.editorView.state.selection.ranges.map((range) =>
            EditorSelection.range(
              Math.min(range.anchor, doc.length),
              Math.min(range.head, doc.length),
            ),
          ),
          this.editorView.state.selection.mainIndex,
        )
      : EditorSelection.cursor(0);
    this.editorView.dispatch({
      changes: {
        from: 0,
        insert: doc,
        to: this.editorView.state.doc.length,
      },
      selection,
      effects: invalidatePendingImageImports.of(null),
    });
    this.editorView.scrollDOM.scrollTop = preserveView ? scrollTop : 0;
    this.editorView.scrollDOM.scrollLeft = preserveView ? scrollLeft : 0;
  }

  setLanguage(language: AppLanguage): void {
    if (language === this.language) {
      return;
    }

    this.language = language;
    this.editorView.dispatch({
      effects: editorSearchPhrasesCompartment.reconfigure(
        EditorState.phrases.of(getEditorSearchPhrases(language)),
      ),
    });
  }

  setDocumentContext(context: EditorDocumentContext): void {
    const nextContext = {
      ...this.documentContext,
      ...context,
    };

    if (
      nextContext.path === this.documentContext.path &&
      nextContext.imageAssetResolver === this.documentContext.imageAssetResolver &&
      nextContext.imageImportErrorHandler ===
        this.documentContext.imageImportErrorHandler &&
      nextContext.imageImportHandler === this.documentContext.imageImportHandler
    ) {
      return;
    }

    this.documentContext = nextContext;
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
