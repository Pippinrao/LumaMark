import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createLivePreviewExtensions } from '../capabilities';
import type { EditorMediaPreviewRequestHandler } from './editorEvents';
import { editorRenderLockExtension } from './editorRenderLock';

export type EditorDisplayMode = 'livePreview' | 'reading' | 'source';
export type ImageAssetRequest = {
  documentPath: string | null;
  source: string;
};
export type ImageAssetResolution =
  | {
      kind: 'error';
      reason:
        | 'local_authorization_failed'
        | 'remote_cache_failed'
        | 'unsaved_remote_cache_unavailable';
    }
  | { kind: 'resolved'; src: string };
export type ImageAssetResolver = ((
  request: ImageAssetRequest,
) => Promise<ImageAssetResolution>) & {
  getLocalSourceRevision?: (source: string) => number | undefined;
  syncLocalSources?: (input: {
    documentPath: string | null;
    sources: readonly string[];
  }) => Promise<void>;
};
export type ImageImportRequest = {
  bytes: Uint8Array;
  documentPath: string | null;
  mimeType: string;
};
export type ImageImportResult = {
  markdownSource: string;
};
export type ImageImportHandler = (
  request: ImageImportRequest,
) => Promise<ImageImportResult>;
export type ImageImportErrorHandler = (error: unknown) => void;
export type EditorDocumentContext = {
  imageAssetResolver?: ImageAssetResolver;
  imageImportErrorHandler?: ImageImportErrorHandler;
  imageImportHandler?: ImageImportHandler;
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler;
  path: string | null;
};

export const editorDisplayModeCompartment = new Compartment();
export const editorReadOnlyCompartment = new Compartment();

export function editorReadOnlyExtension(
  mode: EditorDisplayMode,
  transitionLocked = false,
): Extension {
  return EditorState.readOnly.of(mode === 'reading' || transitionLocked);
}

export function editorDisplayModeExtension(
  mode: EditorDisplayMode,
  context: EditorDocumentContext = { path: null },
  _transitionLocked = false,
): Extension {
  if (mode === 'source') {
    return [
      editorRenderLockExtension(false),
      EditorView.editorAttributes.of({
        class: 'lm-editor-source-mode',
      }),
    ];
  }

  if (mode === 'reading') {
    return [
      editorRenderLockExtension(true),
      EditorView.editorAttributes.of({
        class: 'lm-editor-reading-mode',
      }),
      ...createLivePreviewExtensions(context, true),
    ];
  }

  return [
    editorRenderLockExtension(false),
    EditorView.editorAttributes.of({
      class: 'lm-editor-live-preview-mode',
    }),
    ...createLivePreviewExtensions(context, false),
  ];
}
