import { Compartment, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createLivePreviewExtensions } from '../capabilities';
import type { EditorMediaPreviewRequestHandler } from './editorEvents';

export type EditorDisplayMode = 'livePreview' | 'source';
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

export function editorDisplayModeExtension(
  mode: EditorDisplayMode,
  context: EditorDocumentContext = { path: null },
): Extension {
  if (mode === 'source') {
    return EditorView.editorAttributes.of({
      class: 'lm-editor-source-mode',
    });
  }

  return [
    EditorView.editorAttributes.of({
      class: 'lm-editor-live-preview-mode',
    }),
    ...createLivePreviewExtensions(context),
  ];
}
