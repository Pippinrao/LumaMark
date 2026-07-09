import { useCallback, useRef, useState } from 'react';
import {
  createEditorCommandPort,
  createEditorDocumentPort,
  type EditorCommandPort,
  type EditorDocumentPort,
} from '../../editor/commands/editorCommandPort';
import type { MarkdownFormatCommand } from '../../editor/commands/markdownFormatCommands';
import type { EditorApi } from '../../editor/core/editorApi';
import type { EditorDisplayMode } from '../../editor/core/editorDisplayMode';

export function useAppEditorCommands() {
  const documentPortRef = useRef<EditorDocumentPort | null>(null);
  const commandPortRef = useRef<EditorCommandPort | null>(null);
  const [editorDisplayMode, setEditorDisplayMode] =
    useState<EditorDisplayMode>('livePreview');

  const onEditorReady = useCallback((editor: EditorApi) => {
    documentPortRef.current = createEditorDocumentPort(editor);
    commandPortRef.current = createEditorCommandPort(editor);
    setEditorDisplayMode(editor.getDisplayMode());
  }, []);

  const runFormat = useCallback((command: MarkdownFormatCommand) => {
    commandPortRef.current?.runFormat(command);
  }, []);

  const copyTable = useCallback(() => {
    commandPortRef.current?.copyTable();
  }, []);

  const deleteTable = useCallback(() => {
    commandPortRef.current?.deleteTable();
  }, []);

  const focusEditor = useCallback(() => {
    commandPortRef.current?.focus();
  }, []);

  const selectPosition = useCallback((position: number) => {
    commandPortRef.current?.selectPosition(position);
  }, []);

  const setDisplayMode = useCallback((mode: EditorDisplayMode) => {
    commandPortRef.current?.setDisplayMode(mode);
    setEditorDisplayMode(mode);
  }, []);

  return {
    copyTable,
    deleteTable,
    documentPortRef,
    editorDisplayMode,
    focusEditor,
    onEditorReady,
    runFormat,
    selectPosition,
    setDisplayMode,
  };
}
