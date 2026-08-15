import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createEditorCommandPort,
  createEditorDocumentPort,
  type EditorClipboardError,
  type EditorCommandPort,
  type EditorDocumentPort,
  type EditorEditState,
} from '../../editor/commands/editorCommandPort';
import type { MarkdownFormatCommand } from '../../editor/commands/markdownFormatCommands';
import type { EditorApi } from '../../editor/core/editorApi';
import type { EditorDisplayMode } from '../../editor/core/editorDisplayMode';
import type { EditorInteractionRange } from '../../editor/interaction';
import { useSettingsStore } from '../../features/settings/settingsStore';
import { resolveClipboardTextPort } from '../../services/clipboard/clipboardTextClient';
import { useAppStore } from '../stores/appStore';
import { useAppEditorImageInput } from './useAppEditorImageInput';

export function useAppEditorCommands() {
  const { t } = useTranslation();
  const documentPortRef = useRef<EditorDocumentPort | null>(null);
  const commandPortRef = useRef<EditorCommandPort | null>(null);
  const pendingFocusRef = useRef(false);
  const initializedEditorInstancesRef = useRef(new WeakSet<EditorApi>());
  const imageInput = useAppEditorImageInput(commandPortRef, documentPortRef);
  const [editorDisplayMode, setEditorDisplayMode] =
    useState<EditorDisplayMode>('livePreview');
  const editorDisplayModeRef = useRef<EditorDisplayMode>('livePreview');
  const [editorReady, setEditorReady] = useState(false);
  const reportClipboardError = useCallback(
    ({ operation }: EditorClipboardError) => {
      useAppStore.getState().setLastFileError({
        code: `clipboard.${operation}_failed`,
        message: t(`clipboardError.${operation}Failed`),
        recoverable: true,
      });
    },
    [t],
  );

  const onEditorReady = useCallback((editor: EditorApi) => {
    documentPortRef.current = createEditorDocumentPort(editor);
    commandPortRef.current = createEditorCommandPort(editor, {
      onClipboardError: reportClipboardError,
      resolveClipboard: resolveClipboardTextPort,
    });
    if (!initializedEditorInstancesRef.current.has(editor)) {
      initializedEditorInstancesRef.current.add(editor);
      editor.setDisplayMode(
        useSettingsStore.getState().settings.editor.defaultDisplayMode,
      );
    }
    const displayMode = editor.getDisplayMode();
    editorDisplayModeRef.current = displayMode;
    setEditorReady(true);
    setEditorDisplayMode(displayMode);

    if (pendingFocusRef.current) {
      pendingFocusRef.current = false;
      editor.focus();
    }
  }, [reportClipboardError, setEditorDisplayMode, setEditorReady]);

  const runFormat = useCallback((command: MarkdownFormatCommand) => {
    commandPortRef.current?.runFormat(command);
  }, []);

  const redo = useCallback(() => {
    commandPortRef.current?.redo();
  }, []);

  const copy = useCallback(() => {
    return commandPortRef.current?.copy() ?? Promise.resolve(false);
  }, []);

  const closeContextMenu = useCallback((restoreFocus: boolean) => {
    commandPortRef.current?.closeContextMenu(restoreFocus);
  }, []);

  const copyTable = useCallback((range?: EditorInteractionRange) => {
    return commandPortRef.current?.copyTable(range) ?? Promise.resolve(false);
  }, []);

  const cut = useCallback(() => {
    return commandPortRef.current?.cut() ?? Promise.resolve(false);
  }, []);

  const deleteTable = useCallback((range?: EditorInteractionRange) => {
    return commandPortRef.current?.deleteTable(range) ?? false;
  }, []);

  const deleteSelection = useCallback(() => {
    return commandPortRef.current?.deleteSelection() ?? false;
  }, []);

  const deleteImageReference = useCallback(
    (range?: EditorInteractionRange) => {
      if (!range) {
        return;
      }

      commandPortRef.current?.deleteImageReference(range);
    },
    [],
  );

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

  const paste = useCallback(() => {
    return commandPortRef.current?.paste() ?? Promise.resolve(false);
  }, []);

  const prepareContextMenu = useCallback(
    (...args: Parameters<EditorCommandPort['prepareContextMenu']>) => {
      commandPortRef.current?.prepareContextMenu(...args);
    },
    [],
  );

  const selectAll = useCallback(() => {
    return commandPortRef.current?.selectAll() ?? false;
  }, []);

  const getEditState = useCallback((): EditorEditState => {
    return commandPortRef.current?.getEditState() ?? unavailableEditorEditState;
  }, []);

  const revealPosition = useCallback((position: number) => {
    commandPortRef.current?.revealPosition(position);
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
    closeContextMenu,
    copy,
    copyTable,
    cut,
    deleteImageReference,
    deleteSelection,
    deleteTable,
    documentPortRef,
    editorReady,
    editorDisplayMode,
    focusEditor,
    getEditState,
    ...imageInput,
    onEditorReady,
    openSearch,
    paste,
    prepareContextMenu,
    runFormat,
    redo,
    selectAll,
    revealPosition,
    setDisplayMode,
    toggleDisplayMode,
    undo,
  };
}

const unavailableEditorEditState: EditorEditState = {
  canFormat: false,
  canInsert: false,
  canRedo: false,
  canUndo: false,
  clipboardReadAvailable: false,
  clipboardWriteAvailable: false,
  composing: false,
  eligibleFindSelection: false,
  readOnly: true,
  selectionCount: 1,
  selectionEmpty: true,
  selectionLength: 0,
};
