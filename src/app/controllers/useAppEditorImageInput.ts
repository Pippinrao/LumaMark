import { useCallback, useEffect, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EditorCommandPort,
  EditorDocumentPort,
} from '../../editor/commands/editorCommandPort';
import { createLocalImageReferences } from '../../services/assets/assetCommands';
import { subscribeToLocalImageDrops } from '../../services/assets/localImageDrop';
import { resolveFileCommandClient } from '../../services/files/fileCommandClient';
import { showOpenImageDialog } from '../../services/files/fileCommands';
import { useAppStore } from '../stores/appStore';
import {
  reportImageInsertFailure,
  useAppImageAssets,
} from './useAppImageAssets';

export function useAppEditorImageInput(
  commandPortRef: RefObject<EditorCommandPort | null>,
  documentPortRef: RefObject<EditorDocumentPort | null>,
) {
  const { t } = useTranslation();
  const imageAssets = useAppImageAssets(documentPortRef);

  useEffect(() => {
    let disposed = false;
    let unlisten: () => void = () => undefined;

    void subscribeToLocalImageDrops((drop) => {
      const state = useAppStore.getState();
      const documentPath = state.currentFile?.path ?? null;
      void createLocalImageReferences({
        copyToAssets: state.copyImagesToAssets,
        documentPath,
        paths: drop.paths,
      })
        .then((images) => {
          if (
            disposed ||
            (useAppStore.getState().currentFile?.path ?? null) !== documentPath
          ) {
            return;
          }

          commandPortRef.current?.insertImages(images, drop.position);
        })
        .catch(reportImageInsertFailure);
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }

        unlisten = dispose;
      })
      .catch(reportImageInsertFailure);

    return () => {
      disposed = true;
      unlisten();
    };
  }, [commandPortRef]);

  const insertLocalImages = useCallback(async () => {
    if (!commandPortRef.current) {
      return;
    }

    const state = useAppStore.getState();
    const documentPath = state.currentFile?.path ?? null;

    try {
      const browserClient = resolveFileCommandClient();
      const result = browserClient?.showOpenImageDialog
        ? await browserClient.showOpenImageDialog()
        : await showOpenImageDialog(t('menu.image'));

      if (!result.ok) {
        throw new Error(result.error.code);
      }

      if (!result.data?.length) {
        return;
      }

      const images = await createLocalImageReferences({
        copyToAssets: state.copyImagesToAssets,
        documentPath,
        paths: result.data,
      });

      if ((useAppStore.getState().currentFile?.path ?? null) !== documentPath) {
        return;
      }

      commandPortRef.current?.insertImages(images);
    } catch (error) {
      reportImageInsertFailure(error);
    } finally {
      commandPortRef.current?.focus();
    }
  }, [commandPortRef, t]);

  return {
    imageAssetResolver: imageAssets.imageAssetResolver,
    imageImportErrorHandler: reportImageInsertFailure,
    imageImportHandler: imageAssets.imageImportHandler,
    insertLocalImages,
    refreshLocalImage: imageAssets.refreshLocalImage,
  };
}
