import { useEffect, useId, useRef } from 'react';
import { createEditorApi, type EditorApi } from './editorApi';
import type {
  ImageAssetResolver,
  ImageImportErrorHandler,
  ImageImportHandler,
} from './editorDisplayMode';
import type { AppLanguage } from '../../shared/i18n';
import type {
  EditorDocumentChangedHandler,
  EditorFocusChangedHandler,
  EditorMediaPreviewRequestHandler,
} from './editorEvents';
import type { ReadOnlyEditAttemptHandler } from './readOnlyEditAttempt';
import {
  editorLinkNavigationExtension,
  type EditorLinkNavigationRequestHandler,
} from './editorLinkNavigationExtension';
import type {
  EditorAppearance,
  EditorZoomRequestedHandler,
} from './editorAppearance';
import './editor.css';

const DEFAULT_EDITOR_DOCUMENT = '# LumaMark\n';

export type EditorViewHostProps = {
  accessibleTitle?: string;
  appearance: EditorAppearance;
  ariaLabel?: string;
  className?: string;
  initialDoc?: string;
  imageAssetResolver?: ImageAssetResolver;
  imageImportErrorHandler?: ImageImportErrorHandler;
  imageImportHandler?: ImageImportHandler;
  language: AppLanguage;
  onDocumentChanged?: EditorDocumentChangedHandler;
  onEditorReady?: (editor: EditorApi) => void;
  onFocusChanged?: EditorFocusChangedHandler;
  onLinkNavigationRequest: EditorLinkNavigationRequestHandler;
  onZoomRequested: EditorZoomRequestedHandler;
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler;
  onReadOnlyEditAttempt?: ReadOnlyEditAttemptHandler;
};

export function EditorViewHost({
  accessibleTitle,
  appearance,
  ariaLabel,
  className,
  initialDoc = DEFAULT_EDITOR_DOCUMENT,
  imageAssetResolver,
  imageImportErrorHandler,
  imageImportHandler,
  language,
  onDocumentChanged,
  onEditorReady,
  onFocusChanged,
  onLinkNavigationRequest,
  onZoomRequested,
  onMediaPreviewRequest,
  onReadOnlyEditAttempt,
}: EditorViewHostProps) {
  const editorParentRef = useRef<HTMLDivElement>(null);
  const initialDocRef = useRef(initialDoc);
  const initialAppearanceRef = useRef(appearance);
  const initialImageAssetResolverRef = useRef(imageAssetResolver);
  const initialImageImportErrorHandlerRef = useRef(imageImportErrorHandler);
  const initialImageImportHandlerRef = useRef(imageImportHandler);
  const initialLanguageRef = useRef(language);
  const initialMediaPreviewRequestHandlerRef = useRef(onMediaPreviewRequest);
  const editorRef = useRef<EditorApi | null>(null);
  const onDocumentChangedRef = useRef(onDocumentChanged);
  const onEditorReadyRef = useRef(onEditorReady);
  const onFocusChangedRef = useRef(onFocusChanged);
  const onLinkNavigationRequestRef = useRef(onLinkNavigationRequest);
  const onZoomRequestedRef = useRef(onZoomRequested);
  const onReadOnlyEditAttemptRef = useRef(onReadOnlyEditAttempt);
  const titleId = useId();

  useEffect(() => {
    onDocumentChangedRef.current = onDocumentChanged;
  }, [onDocumentChanged]);

  useEffect(() => {
    onEditorReadyRef.current = onEditorReady;
  }, [onEditorReady]);

  useEffect(() => {
    onFocusChangedRef.current = onFocusChanged;
  }, [onFocusChanged]);

  useEffect(() => {
    onLinkNavigationRequestRef.current = onLinkNavigationRequest;
  }, [onLinkNavigationRequest]);

  useEffect(() => {
    onZoomRequestedRef.current = onZoomRequested;
  }, [onZoomRequested]);

  useEffect(() => {
    onReadOnlyEditAttemptRef.current = onReadOnlyEditAttempt;
  }, [onReadOnlyEditAttempt]);

  useEffect(() => {
    editorRef.current?.setLanguage(language);
  }, [language]);

  useEffect(() => {
    editorRef.current?.setAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    const parent = editorParentRef.current;

    if (!parent) {
      return;
    }

    const editor = createEditorApi({
      appearance: initialAppearanceRef.current,
      doc: initialDocRef.current,
      onDocumentChanged: (event) => {
        onDocumentChangedRef.current?.(event);
      },
      onFocusChanged: (event) => {
        onFocusChangedRef.current?.(event);
      },
      onReadOnlyEditAttempt: () => {
        onReadOnlyEditAttemptRef.current?.();
      },
      onZoomRequested: (direction) => {
        onZoomRequestedRef.current(direction);
      },
      parent,
      extensions: [
        editorLinkNavigationExtension((href) => {
          onLinkNavigationRequestRef.current?.(href);
        }),
      ],
      documentContext: {
        imageAssetResolver: initialImageAssetResolverRef.current,
        imageImportErrorHandler: initialImageImportErrorHandlerRef.current,
        imageImportHandler: initialImageImportHandlerRef.current,
        onMediaPreviewRequest: initialMediaPreviewRequestHandlerRef.current,
        path: null,
      },
      language: initialLanguageRef.current,
    });

    editorRef.current = editor;

    onEditorReadyRef.current?.(editor);

    return () => {
      editorRef.current = null;
      editor.destroy();
    };
  }, []);

  return (
    <section
      className={['lm-editor-host', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
      aria-labelledby={accessibleTitle ? titleId : undefined}
    >
      {accessibleTitle ? (
        <h2 className="lm-editor-accessible-title" id={titleId}>
          {accessibleTitle}
        </h2>
      ) : null}
      <div className="lm-codemirror" ref={editorParentRef} />
    </section>
  );
}
