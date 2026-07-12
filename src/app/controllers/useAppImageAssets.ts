import { useCallback, useMemo, useRef, type RefObject } from 'react';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import type {
  ImageAssetResolver,
  ImageImportRequest,
} from '../../editor/core/editorDisplayMode';
import {
  cachedImagePathToAssetUrl,
  createRemoteImageAssetResolver,
  importDocumentImage,
  importDraftImage,
  normalizeLocalPathKey,
} from '../../services/assets/assetCommands';
import { useAppStore } from '../stores/appStore';

export function useAppImageAssets(
  documentPortRef: RefObject<EditorDocumentPort | null>,
) {
  const draftIdRef = useRef(`draft-${crypto.randomUUID()}`);
  const draftImagePathsRef = useRef(new Map<string, string>());
  const localImageRevisions = useMemo(
    () => new LocalImageRevisionStore(),
    [],
  );
  const remoteImageResolver = useMemo(
    () =>
      createRemoteImageAssetResolver({
        getLocalImageRevision: localImageRevisions.get,
        onLocalImageWatchError: reportLocalImageWatchFailure,
      }),
    [localImageRevisions],
  );
  const imageAssetResolver = useMemo<ImageAssetResolver>(() => {
    const resolver: ImageAssetResolver = async (request) => {
      const draftPath = draftImagePathsRef.current.get(request.source);
      return draftPath
        ? { kind: 'resolved', src: cachedImagePathToAssetUrl(draftPath) }
        : remoteImageResolver(request);
    };
    resolver.getLocalSourceRevision =
      remoteImageResolver.getLocalSourceRevision;
    resolver.syncLocalSources = remoteImageResolver.syncLocalSources;
    return resolver;
  }, [remoteImageResolver]);
  const imageImportHandler = useCallback(async (request: ImageImportRequest) => {
    if (!request.documentPath) {
      const result = await importDraftImage({
        bytes: request.bytes,
        draftId: draftIdRef.current,
        mimeType: request.mimeType,
      });
      if (!result.ok) {
        throw new Error(result.error.code);
      }
      draftImagePathsRef.current.set(
        result.data.markdownSource,
        result.data.path,
      );
      return { markdownSource: result.data.markdownSource };
    }

    const result = await importDocumentImage({
      bytes: request.bytes,
      documentPath: request.documentPath,
      mimeType: request.mimeType,
    });
    if (!result.ok) {
      throw new Error(result.error.code);
    }
    return { markdownSource: result.data.markdownSource };
  }, []);
  const refreshLocalImage = useCallback(
    ({ path, revision }: { path: string; revision: number }) => {
      localImageRevisions.set(path, revision);
      remoteImageResolver.invalidateLocalPath(path);
      documentPortRef.current?.refreshImages?.(path);
    },
    [documentPortRef, localImageRevisions, remoteImageResolver],
  );

  return { imageAssetResolver, imageImportHandler, refreshLocalImage };
}

export function reportImageInsertFailure(error: unknown): void {
  useAppStore.getState().setLastFileError({
    code: 'asset.image_insert_failed',
    message: error instanceof Error ? error.message : 'Image insertion failed.',
    recoverable: true,
  });
}

function reportLocalImageWatchFailure(error: unknown): void {
  useAppStore.getState().setLastFileError({
    code: 'file.watch_error',
    message:
      error instanceof Error ? error.message : 'Image file watching failed.',
    recoverable: true,
  });
}

class LocalImageRevisionStore {
  private readonly revisions = new Map<string, number>();

  readonly get = (path: string): number | undefined =>
    this.revisions.get(normalizeLocalPathKey(path));

  set(path: string, revision: number): void {
    this.revisions.set(normalizeLocalPathKey(path), revision);
  }
}
