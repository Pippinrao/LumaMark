import {
  defaultKeymap,
  history,
  historyKeymap,
} from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { getEditorSearchPhrases } from '../../shared/i18n/editorSearchPhrases';
import type { AppLanguage } from '../../shared/i18n';
import { markdownFormatKeymap } from '../commands/markdownFormatKeymap';
import { recordEditorTransactionMetric } from '../metrics/editorMetrics';
import {
  markdownLanguage,
  markdownSyntaxHighlighting,
} from '../markdown/markdownLanguage';
import {
  editorDisplayModeCompartment,
  editorDisplayModeExtension,
  type EditorDocumentContext,
  type EditorDisplayMode,
} from './editorDisplayMode';
import type {
  EditorDocumentChangedHandler,
  EditorFocusChangedHandler,
} from './editorEvents';

export type CreateEditorStateOptions = {
  doc?: string;
  documentContext?: EditorDocumentContext;
  extensions?: readonly Extension[];
  displayMode?: EditorDisplayMode;
  language?: AppLanguage;
  onDocumentChanged?: EditorDocumentChangedHandler;
  onFocusChanged?: EditorFocusChangedHandler;
};

export const editorSearchPhrasesCompartment = new Compartment();

export function createEditorState(
  options: CreateEditorStateOptions = {},
): EditorState {
  const {
    doc = '',
    documentContext = { path: null },
    displayMode = 'livePreview',
    extensions = [],
    language = 'zh-CN',
    onDocumentChanged,
    onFocusChanged,
  } = options;
  let docVersion = 0;

  const documentChangeListener = EditorView.updateListener.of((update) => {
    const metric = recordEditorTransactionMetric({
      docChanged: update.docChanged,
      transactionCount: update.transactions.length,
    });

    if (!update.docChanged) {
      return;
    }

    docVersion += 1;
    onDocumentChanged?.({
      type: 'documentChanged',
      dirty: true,
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

  return EditorState.create({
    doc,
    extensions: [
      markdownLanguage(),
      markdownSyntaxHighlighting(),
      editorDisplayModeCompartment.of(
        editorDisplayModeExtension(displayMode, documentContext),
      ),
      editorSearchPhrasesCompartment.of(
        EditorState.phrases.of(getEditorSearchPhrases(language)),
      ),
      history(),
      autocompletion(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      documentChangeListener,
      ...focusExtensions,
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
