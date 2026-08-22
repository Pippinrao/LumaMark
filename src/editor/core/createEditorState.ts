import {
  defaultKeymap,
  history,
  historyKeymap,
} from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from '@codemirror/search';
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Text,
  type Extension,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { getEditorSearchPhrases } from '../../shared/i18n/editorSearchPhrases';
import type { AppLanguage } from '../../shared/i18n';
import { markdownFormatKeymap } from '../commands/markdownFormatKeymap';
import { editorMathPreferencesField } from '../capabilities/math/mathPreferences';
import { tableCellRenderLockBaseExtension } from '../capabilities/table/tableCellRenderLock';
import { recordEditorTransactionMetric } from '../metrics/editorMetrics';
import {
  markdownLanguage,
  markdownSyntaxHighlighting,
} from '../markdown/markdownLanguage';
import {
  DEFAULT_EDITOR_APPEARANCE,
  editorAppearanceCompartment,
  editorAppearanceExtension,
  type EditorAppearance,
  type EditorZoomRequestedHandler,
} from './editorAppearance';
import { editorAvailableWidthExtension } from './editorAvailableWidth';
import {
  editorDisplayModeCompartment,
  editorDisplayModeExtension,
  editorDocumentContextCompartment,
  editorDocumentContextExtension,
  editorReadOnlyCompartment,
  editorReadOnlyExtension,
  type EditorDocumentContext,
  type EditorDisplayMode,
} from './editorDisplayMode';
import type {
  EditorDocumentChangedHandler,
  EditorFocusChangedHandler,
} from './editorEvents';
import {
  readOnlyEditAttemptExtension,
  type ReadOnlyEditAttemptHandler,
} from './readOnlyEditAttempt';
import { editorZoomWheelExtension } from './editorZoomWheelExtension';
import {
  documentSourceFormatExtension,
  documentSourceFormatField,
  documentSourceFormatsEqual,
  parseDocumentSource,
  type DocumentSourceFormat,
} from './documentSourceFormat';

export type CreateEditorStateOptions = {
  appearance?: EditorAppearance;
  doc?: string;
  documentContext?: EditorDocumentContext;
  extensions?: readonly Extension[];
  displayMode?: EditorDisplayMode;
  isMacPlatform?: boolean;
  language?: AppLanguage;
  searchPhrases?: Record<string, string>;
  onDocumentChanged?: EditorDocumentChangedHandler;
  onFocusChanged?: EditorFocusChangedHandler;
  onReadOnlyEditAttempt?: ReadOnlyEditAttemptHandler;
  onZoomRequested?: EditorZoomRequestedHandler;
};

export const editorHistoryCompartment = new Compartment();
export const editorMarkdownLanguageCompartment = new Compartment();
export type DocumentSavepoint = {
  readonly doc: Text;
  readonly sourceFormat: DocumentSourceFormat;
};
export const setDocumentSavepoint =
  StateEffect.define<DocumentSavepoint | null>();
type DocumentSavepointState = {
  dirty: boolean;
  savepoint: DocumentSavepoint | null;
};

export function captureDocumentSavepoint(
  state: EditorState,
): DocumentSavepoint {
  return {
    doc: state.doc,
    sourceFormat: state.field(documentSourceFormatField),
  };
}

export const documentSavepointField = StateField.define<DocumentSavepointState>({
  create: (state) => ({
    dirty: false,
    savepoint: captureDocumentSavepoint(state),
  }),
  update: (value, transaction) => {
    let savepoint = value.savepoint;
    let savepointChanged = false;

    for (const effect of transaction.effects) {
      if (effect.is(setDocumentSavepoint)) {
        savepoint = effect.value;
        savepointChanged = true;
      }
    }

    const sourceFormatChanged =
      transaction.startState.field(documentSourceFormatField) !==
      transaction.state.field(documentSourceFormatField);

    if (!transaction.docChanged && !sourceFormatChanged && !savepointChanged) {
      return value;
    }

    const dirty =
      savepoint === null ||
      !transaction.state.doc.eq(savepoint.doc) ||
      !documentSourceFormatsEqual(
        transaction.state.field(documentSourceFormatField),
        savepoint.sourceFormat,
      );

    return { dirty, savepoint };
  },
});

export function isDocumentDirty(state: EditorState): boolean {
  return state.field(documentSavepointField).dirty;
}

export function createEditorState(
  options: CreateEditorStateOptions = {},
): EditorState {
  const {
    appearance = DEFAULT_EDITOR_APPEARANCE,
    doc = '',
    documentContext = { documentId: 'document:unsaved', path: null },
    displayMode = 'livePreview',
    extensions = [],
    isMacPlatform,
    language = 'zh-CN',
    searchPhrases = getEditorSearchPhrases(language),
    onDocumentChanged,
    onFocusChanged,
    onReadOnlyEditAttempt,
    onZoomRequested,
  } = options;
  const parsedDocument = parseDocumentSource(doc);
  let docVersion = 0;

  const documentChangeListener = EditorView.updateListener.of((update) => {
    const metric = recordEditorTransactionMetric({
      docChanged: update.docChanged,
      transactionCount: update.transactions.length,
    });

    const dirty = isDocumentDirty(update.state);
    const dirtyChanged = dirty !== isDocumentDirty(update.startState);

    if (!update.docChanged && !dirtyChanged) {
      return;
    }

    if (update.docChanged) {
      docVersion += 1;
    }
    onDocumentChanged?.({
      type: 'documentChanged',
      dirty,
      documentChanged: update.docChanged,
      docVersion,
      documentLength: update.state.doc.length,
      transactionCount: metric.transactionCount,
      transactionDurationMs: metric.durationMs,
    });
  });

  const focusExtensions: Extension[] = onFocusChanged
    ? [
        EditorView.domEventHandlers({
          blur: () => {
            onFocusChanged({
              type: 'focusChanged',
              focused: false,
            });
            return false;
          },
          focus: () => {
            onFocusChanged({
              type: 'focusChanged',
              focused: true,
            });
            return false;
          },
        }),
      ]
    : [];
  const zoomExtensions: Extension[] = onZoomRequested
    ? [editorZoomWheelExtension(onZoomRequested, isMacPlatform)]
    : [];

  return EditorState.create({
    doc: parsedDocument.text,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      editorMarkdownLanguageCompartment.of(markdownLanguage()),
      markdownSyntaxHighlighting(),
      editorMathPreferencesField,
      documentSourceFormatExtension(parsedDocument.format),
      editorAppearanceCompartment.of(editorAppearanceExtension(appearance)),
      editorAvailableWidthExtension,
      editorDocumentContextCompartment.of(
        editorDocumentContextExtension(documentContext),
      ),
      editorDisplayModeCompartment.of(
        editorDisplayModeExtension(displayMode, documentContext),
      ),
      editorReadOnlyCompartment.of(editorReadOnlyExtension(displayMode)),
      tableCellRenderLockBaseExtension(),
      EditorState.phrases.of(searchPhrases),
      documentSavepointField,
      editorHistoryCompartment.of(history()),
      autocompletion(),
      search({ top: true }),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      documentChangeListener,
      ...focusExtensions,
      ...zoomExtensions,
      readOnlyEditAttemptExtension(onReadOnlyEditAttempt),
      keymap.of(markdownFormatKeymap),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      ...extensions,
    ],
  });
}
