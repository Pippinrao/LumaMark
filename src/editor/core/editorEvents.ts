export type EditorDocumentChangedEvent = {
  type: 'documentChanged';
  dirty: true;
  docVersion: number;
  documentLength: number;
  transactionCount: number;
  transactionDurationMs: number;
};

export type EditorFocusChangedEvent = {
  type: 'focusChanged';
  focused: boolean;
};

export type EditorEvent =
  | EditorDocumentChangedEvent
  | EditorFocusChangedEvent;

export type EditorDocumentChangedHandler = (
  event: EditorDocumentChangedEvent,
) => void;

export type EditorFocusChangedHandler = (
  event: EditorFocusChangedEvent,
) => void;
