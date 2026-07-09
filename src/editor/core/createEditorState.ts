import {
  defaultKeymap,
  history,
  historyKeymap,
} from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { recordEditorTransactionMetric } from '../metrics/editorMetrics';
import { markdownLanguage } from '../markdown/markdownLanguage';
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
  onDocumentChanged?: EditorDocumentChangedHandler;
  onFocusChanged?: EditorFocusChangedHandler;
};

export function createEditorState(
  options: CreateEditorStateOptions = {},
): EditorState {
  const {
    doc = '',
    documentContext = { path: null },
    displayMode = 'livePreview',
    extensions = [],
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
      editorDisplayModeCompartment.of(
        editorDisplayModeExtension(displayMode, documentContext),
      ),
      history(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      documentChangeListener,
      ...focusExtensions,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      ...extensions,
    ],
  });
}
