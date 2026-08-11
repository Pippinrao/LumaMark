import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createEditorCommandPort,
  createEditorDocumentPort,
  type EditorCommandPort,
  type EditorDocumentPort,
} from '../../editor/commands/editorCommandPort';
import type { MarkdownFormatCommand } from '../../editor/commands/markdownFormatCommands';
import type { EditorApi } from '../../editor/core/editorApi';
import type { EditorDisplayMode } from '../../editor/core/editorDisplayMode';
import { createLocalImageReferences } from '../../services/assets/assetCommands';
import { subscribeToLocalImageDrops } from '../../services/assets/localImageDrop';
import { resolveFileCommandClient } from '../../services/files/fileCommandClient';
import { showOpenImageDialog } from '../../services/files/fileCommands';
import { useAppStore } from '../stores/appStore';
import {
  reportImageInsertFailure,
  useAppImageAssets,
} from './useAppImageAssets';

export function useAppEditorCommands() {
  const { t } = useTranslation();
  const documentPortRef = useRef<EditorDocumentPort | null>(null);
  const commandPortRef = useRef<EditorCommandPort | null>(null);
  const pendingFocusRef = useRef(false);
  const imageAssets = useAppImageAssets(documentPortRef);
  const [editorDisplayMode, setEditorDisplayMode] =
    useState<EditorDisplayMode>('livePreview');
  const editorDisplayModeRef = useRef<EditorDisplayMode>('livePreview');
  const [editorReady, setEditorReady] = useState(false);
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
  }, []);

  const onEditorReady = useCallback((editor: EditorApi) => {
    documentPortRef.current = createEditorDocumentPort(editor);
    commandPortRef.current = createEditorCommandPort(editor);
    const displayMode = editor.getDisplayMode();
    editorDisplayModeRef.current = displayMode;
    setEditorReady(true);
    setEditorDisplayMode(displayMode);

    if (pendingFocusRef.current) {
      pendingFocusRef.current = false;
      editor.focus();
    }
  }, [setEditorDisplayMode, setEditorReady]);

  const runFormat = useCallback((command: MarkdownFormatCommand) => {
    commandPortRef.current?.runFormat(command);
  }, []);

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
  }, [t]);

  const redo = useCallback(() => {
    commandPortRef.current?.redo();
  }, []);

  const copyTable = useCallback(() => {
    commandPortRef.current?.copyTable();
  }, []);

  const deleteTable = useCallback(() => {
    commandPortRef.current?.deleteTable();
  }, []);

  const focusEditor = useCallback(() => {
    const commandPort = commandPortRef.current;

    if (commandPort) {
      commandPort.focus();
      return;
    }

    pendingFocusRef.current = true;
  }, []);

  const openSearch = useCallback(() => {
    commandPortRef.current?.openSearch();
  }, []);

  const selectPosition = useCallback((position: number) => {
    commandPortRef.current?.selectPosition(position);
  }, []);

  const setDisplayMode = useCallback((mode: EditorDisplayMode) => {
    commandPortRef.current?.setDisplayMode(mode);
    editorDisplayModeRef.current = mode;
    setEditorDisplayMode(mode);
  }, [setEditorDisplayMode]);

  const toggleDisplayMode = useCallback(() => {
    const current = editorDisplayModeRef.current;
    const mode =
      current === 'livePreview'
        ? 'source'
        : current === 'source'
          ? 'reading'
          : 'livePreview';
    commandPortRef.current?.setDisplayMode(mode);
    editorDisplayModeRef.current = mode;
    setEditorDisplayMode(mode);
  }, []);

  const undo = useCallback(() => {
    commandPortRef.current?.undo();
  }, []);

  return {
    copyTable,
    deleteTable,
    documentPortRef,
    editorReady,
    editorDisplayMode,
    focusEditor,
    imageAssetResolver: imageAssets.imageAssetResolver,
    imageImportErrorHandler: reportImageInsertFailure,
    imageImportHandler: imageAssets.imageImportHandler,
    insertLocalImages,
    onEditorReady,
    openSearch,
    runFormat,
    redo,
    refreshLocalImage: imageAssets.refreshLocalImage,
    selectPosition,
    setDisplayMode,
    toggleDisplayMode,
    undo,
  };
}
