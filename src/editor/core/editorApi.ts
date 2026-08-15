import {
  EditorSelection,
  type Extension,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, isolateHistory } from '@codemirror/commands';
import {
  captureDocumentSavepoint,
  createEditorState,
  editorHistoryCompartment,
  setDocumentSavepoint,
  type CreateEditorStateOptions,
} from './createEditorState';
import type { AppLanguage } from '../../shared/i18n';
import { getEditorSearchPhrases } from '../../shared/i18n/editorSearchPhrases';
import {
  editorReadOnlyCompartment,
  editorReadOnlyExtension,
  editorDisplayModeCompartment,
  editorDisplayModeExtension,
  type EditorDocumentContext,
  type EditorDisplayMode,
} from './editorDisplayMode';
import { allowReadOnlyDocumentChange } from './readOnlyEditAttempt';
import { invalidatePendingImageImports } from '../capabilities/image/imageInputExtension';
import { relabelMediaPreviewButtons } from '../capabilities/mediaPreviewButton';
import { relabelTaskCheckboxes } from '../wysiwyg/markdownDecorations';
import {
  documentSourceFormatField,
  documentSourceFormatsEqual,
  parseDocumentSource,
  serializeDocumentSource,
  setDocumentSourceFormat,
} from './documentSourceFormat';
import { createExactDocumentChanges } from './documentChangeMapping';
import {
  DEFAULT_EDITOR_APPEARANCE,
  editorAppearanceCompartment,
  editorAppearanceExtension,
  type EditorAppearance,
} from './editorAppearance';

export type CreateEditorApiOptions = Omit<
  CreateEditorStateOptions,
  'extensions' | 'isMacPlatform'
> & {
  extensions?: readonly Extension[];
  parent: HTMLElement;
};

export type LoadDocumentOptions = {
  preserveView?: boolean;
  resetHistory?: boolean;
  saved?: boolean;
};

const snapshotSavepoint = Symbol('editorDocumentSnapshotSavepoint');

export type EditorDocumentSnapshot = {
  readonly serializedText: string;
};

type InternalEditorDocumentSnapshot = EditorDocumentSnapshot & {
  readonly [snapshotSavepoint]: ReturnType<typeof captureDocumentSavepoint>;
};

export type EditorApi = {
  readonly view: EditorView;
  captureDocumentSnapshot: () => EditorDocumentSnapshot;
  destroy: () => void;
  focus: () => void;
  getDisplayMode: () => EditorDisplayMode;
  getDocumentText: () => string;
  getSerializedDocumentText: () => string;
  isDocumentSnapshotCurrent: (snapshot: EditorDocumentSnapshot) => boolean;
  loadDocument: (doc: string, options?: LoadDocumentOptions) => void;
  markDocumentSaved: (snapshot: EditorDocumentSnapshot) => void;
  markDocumentUnsaved: () => void;
  setDocumentTransitionLocked: (locked: boolean) => void;
  setLanguage: (language: AppLanguage) => void;
  setAppearance: (appearance: EditorAppearance) => void;
  setDocumentContext: (context: EditorDocumentContext) => void;
  setDisplayMode: (mode: EditorDisplayMode) => void;
};

export class CodeMirrorEditorApi implements EditorApi {
  private readonly editorView: EditorView;
  private appearance: EditorAppearance;
  private documentContext: EditorDocumentContext;
  private displayMode: EditorDisplayMode;
  private language: AppLanguage;
  private readonly searchPhrases: Record<string, string>;
  private transitionLocked = false;

  constructor(options: CreateEditorApiOptions) {
    this.appearance = options.appearance ?? DEFAULT_EDITOR_APPEARANCE;
    this.displayMode = options.displayMode ?? 'livePreview';
    this.documentContext = options.documentContext ?? { path: null };
    this.language = options.language ?? 'zh-CN';
    this.searchPhrases = {
      ...(options.searchPhrases ?? getEditorSearchPhrases(this.language)),
    };
    this.editorView = new EditorView({
      parent: options.parent,
      state: createEditorState({
        appearance: this.appearance,
        displayMode: this.displayMode,
        documentContext: this.documentContext,
        doc: options.doc,
        extensions: options.extensions,
        language: this.language,
        onDocumentChanged: options.onDocumentChanged,
        onFocusChanged: options.onFocusChanged,
        onReadOnlyEditAttempt: options.onReadOnlyEditAttempt,
        onZoomRequested: options.onZoomRequested,
        searchPhrases: this.searchPhrases,
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

  captureDocumentSnapshot(): EditorDocumentSnapshot {
    const snapshot = Object.freeze({
      serializedText: serializeDocumentSource(this.editorView.state),
      [snapshotSavepoint]: captureDocumentSavepoint(this.editorView.state),
    });
    this.editorView.dispatch({
      annotations: isolateHistory.of('after'),
    });

    return snapshot;
  }

  getDocumentText(): string {
    return this.editorView.state.doc.toString();
  }

  getSerializedDocumentText(): string {
    return serializeDocumentSource(this.editorView.state);
  }

  getDisplayMode(): EditorDisplayMode {
    return this.displayMode;
  }

  isDocumentSnapshotCurrent(snapshot: EditorDocumentSnapshot): boolean {
    const savepoint = (snapshot as InternalEditorDocumentSnapshot)[
      snapshotSavepoint
    ];

    return (
      savepoint !== undefined &&
      this.editorView.state.doc.eq(savepoint.doc) &&
      documentSourceFormatsEqual(
        this.editorView.state.field(documentSourceFormatField),
        savepoint.sourceFormat,
      )
    );
  }

  loadDocument(doc: string, options: LoadDocumentOptions = {}): void {
    const preserveView = options.preserveView ?? false;
    const resetHistory = options.resetHistory ?? true;
    const saved = options.saved ?? true;
    const parsedDocument = parseDocumentSource(doc);
    const documentText = this.editorView.state.toText(parsedDocument.text);
    const mapPreparedDocument =
      preserveView && resetHistory === false;
    const scrollLeft = this.editorView.scrollDOM.scrollLeft;
    const scrollTop = this.editorView.scrollDOM.scrollTop;
    const selection = preserveView && !mapPreparedDocument
      ? EditorSelection.create(
          this.editorView.state.selection.ranges.map((range) =>
            EditorSelection.range(
              Math.min(range.anchor, documentText.length),
              Math.min(range.head, documentText.length),
            ),
          ),
          this.editorView.state.selection.mainIndex,
        )
      : EditorSelection.cursor(0);
    const scrollSnapshot = mapPreparedDocument
      ? this.editorView.scrollSnapshot()
      : null;
    if (resetHistory) {
      this.editorView.dispatch({
        effects: editorHistoryCompartment.reconfigure([]),
      });
    }
    this.editorView.dispatch({
      annotations: allowReadOnlyDocumentChange.of(true),
      changes: mapPreparedDocument
        ? createExactDocumentChanges(
            this.editorView.state.doc,
            documentText,
          )
        : {
            from: 0,
            insert: documentText,
            to: this.editorView.state.doc.length,
          },
      ...(mapPreparedDocument ? {} : { selection }),
      effects: [
        ...(scrollSnapshot ? [scrollSnapshot] : []),
        invalidatePendingImageImports.of(null),
        setDocumentSourceFormat.of(parsedDocument.format),
        setDocumentSavepoint.of(
          saved
            ? {
                doc: documentText,
                sourceFormat: parsedDocument.format,
              }
            : null,
        ),
      ],
    });
    if (resetHistory) {
      this.editorView.dispatch({
        effects: editorHistoryCompartment.reconfigure(history()),
      });
    }
    if (!mapPreparedDocument) {
      this.editorView.scrollDOM.scrollTop = preserveView ? scrollTop : 0;
      this.editorView.scrollDOM.scrollLeft = preserveView ? scrollLeft : 0;
    }
  }

  markDocumentSaved(snapshot: EditorDocumentSnapshot): void {
    const savepoint = (snapshot as InternalEditorDocumentSnapshot)[
      snapshotSavepoint
    ];

    if (!savepoint) {
      throw new Error('The document savepoint must be an editor snapshot.');
    }

    this.editorView.dispatch({
      annotations: isolateHistory.of('full'),
      effects: setDocumentSavepoint.of(savepoint),
    });
  }

  markDocumentUnsaved(): void {
    this.editorView.dispatch({
      effects: setDocumentSavepoint.of(null),
    });
  }

  setLanguage(language: AppLanguage): void {
    if (language === this.language) {
      return;
    }

    this.language = language;
    Object.assign(this.searchPhrases, getEditorSearchPhrases(language));
    relabelMediaPreviewButtons(this.editorView.dom, language);
    relabelTaskCheckboxes(
      this.editorView.dom,
      this.searchPhrases['Toggle task completion'],
    );
    relabelEditorSearchPanel(this.editorView.dom, this.searchPhrases);
  }

  setAppearance(appearance: EditorAppearance): void {
    if (
      appearance.fontZoomPercent === this.appearance.fontZoomPercent &&
      appearance.pageWidthPx === this.appearance.pageWidthPx
    ) {
      return;
    }

    this.appearance = appearance;
    this.editorView.dispatch({
      effects: [
        this.editorView.scrollSnapshot(),
        editorAppearanceCompartment.reconfigure(
          editorAppearanceExtension(appearance),
        ),
      ],
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
      nextContext.imageImportHandler === this.documentContext.imageImportHandler &&
      nextContext.onMediaPreviewRequest ===
        this.documentContext.onMediaPreviewRequest
    ) {
      return;
    }

    this.documentContext = nextContext;
    this.editorView.dispatch({
      effects: [
        editorDisplayModeCompartment.reconfigure(
          editorDisplayModeExtension(
            this.displayMode,
            this.documentContext,
            this.transitionLocked,
          ),
        ),
        editorReadOnlyCompartment.reconfigure(
          editorReadOnlyExtension(this.displayMode, this.transitionLocked),
        ),
      ],
    });
  }

  setDocumentTransitionLocked(locked: boolean): void {
    if (locked === this.transitionLocked) {
      return;
    }

    this.transitionLocked = locked;
    this.editorView.dispatch({
      effects: [
        editorDisplayModeCompartment.reconfigure(
          editorDisplayModeExtension(
            this.displayMode,
            this.documentContext,
            this.transitionLocked,
          ),
        ),
        editorReadOnlyCompartment.reconfigure(
          editorReadOnlyExtension(this.displayMode, this.transitionLocked),
        ),
      ],
    });
  }

  setDisplayMode(mode: EditorDisplayMode): void {
    if (mode === this.displayMode) {
      return;
    }

    this.displayMode = mode;
    this.editorView.dispatch({
      effects: [
        this.editorView.scrollSnapshot(),
        editorDisplayModeCompartment.reconfigure(
          editorDisplayModeExtension(
            mode,
            this.documentContext,
            this.transitionLocked,
          ),
        ),
        editorReadOnlyCompartment.reconfigure(
          editorReadOnlyExtension(mode, this.transitionLocked),
        ),
      ],
    });
  }
}

export function createEditorApi(options: CreateEditorApiOptions): EditorApi {
  return new CodeMirrorEditorApi(options);
}

function relabelEditorSearchPanel(
  root: ParentNode,
  phrases: Record<string, string>,
): void {
  relabelSearchInput(root, 'search', phrases.Find);
  relabelSearchInput(root, 'replace', phrases.Replace);

  for (const [name, phrase] of [
    ['next', phrases.next],
    ['prev', phrases.previous],
    ['select', phrases.all],
    ['replace', phrases.replace],
    ['replaceAll', phrases['replace all']],
  ] as const) {
    const button = root.querySelector<HTMLButtonElement>(
      `.cm-search button[name="${name}"]`,
    );
    if (button) {
      button.textContent = phrase;
    }
  }

  for (const [name, phrase] of [
    ['case', phrases['match case']],
    ['re', phrases.regexp],
    ['word', phrases['by word']],
  ] as const) {
    const label = root
      .querySelector<HTMLInputElement>(`.cm-search input[name="${name}"]`)
      ?.closest('label');
    if (label?.lastChild) {
      label.lastChild.textContent = phrase;
    }
  }

  root
    .querySelector<HTMLButtonElement>('.cm-search button[name="close"]')
    ?.setAttribute('aria-label', phrases.close);
}

function relabelSearchInput(
  root: ParentNode,
  name: 'replace' | 'search',
  phrase: string,
): void {
  const input = root.querySelector<HTMLInputElement>(
    `.cm-search input[name="${name}"]`,
  );
  if (input) {
    input.placeholder = phrase;
    input.setAttribute('aria-label', phrase);
  }
}
