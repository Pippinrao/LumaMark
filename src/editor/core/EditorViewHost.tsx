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
} from './editorEvents';
import './editor.css';

const DEFAULT_EDITOR_DOCUMENT = '# LumaMark\n';

export type EditorViewHostProps = {
  accessibleTitle?: string;
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
};

export function EditorViewHost({
  accessibleTitle,
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
}: EditorViewHostProps) {
  const editorParentRef = useRef<HTMLDivElement>(null);
  const initialDocRef = useRef(initialDoc);
  const initialImageAssetResolverRef = useRef(imageAssetResolver);
  const initialImageImportErrorHandlerRef = useRef(imageImportErrorHandler);
  const initialImageImportHandlerRef = useRef(imageImportHandler);
  const initialLanguageRef = useRef(language);
  const editorRef = useRef<EditorApi | null>(null);
  const onDocumentChangedRef = useRef(onDocumentChanged);
  const onEditorReadyRef = useRef(onEditorReady);
  const onFocusChangedRef = useRef(onFocusChanged);
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
    editorRef.current?.setLanguage(language);
  }, [language]);

  useEffect(() => {
    const parent = editorParentRef.current;

    if (!parent) {
      return;
    }

    const editor = createEditorApi({
      doc: initialDocRef.current,
      onDocumentChanged: (event) => {
        onDocumentChangedRef.current?.(event);
      },
      onFocusChanged: (event) => {
        onFocusChangedRef.current?.(event);
      },
      parent,
      documentContext: {
        imageAssetResolver: initialImageAssetResolverRef.current,
        imageImportErrorHandler: initialImageImportErrorHandlerRef.current,
        imageImportHandler: initialImageImportHandlerRef.current,
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
