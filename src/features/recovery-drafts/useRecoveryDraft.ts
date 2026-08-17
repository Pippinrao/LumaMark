import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import {
  clearRecoveryDraft,
  readRecoveryDraft,
  saveRecoveryDraft,
  type RecoveryDraft,
} from '../../services/drafts/draftStore';
import { createRecoveryDraftScheduler } from '../../services/drafts/recoveryDraftScheduler';

const RECOVERY_DRAFT_DELAY_MS = 500;

export type RecoveryDraftWorkflow = {
  clearRecoveryDraft: () => void;
  discardRecoveryDraft: () => void;
  pendingRecoveryDraft: RecoveryDraft | null;
  recoveryChecked: boolean;
  restoreRecoveryDraft: () => void;
  scheduleRecoveryDraft: () => void;
};

type UseRecoveryDraftOptions = {
  currentFilePath: string | null;
  editorReady: boolean;
  editorRef: RefObject<EditorDocumentPort | null>;
  onRestore: () => void;
};

export function useRecoveryDraft({
  currentFilePath,
  editorReady,
  editorRef,
  onRestore,
}: UseRecoveryDraftOptions): RecoveryDraftWorkflow {
  const [pendingRecoveryDraft, setPendingRecoveryDraft] =
    useState<RecoveryDraft | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const schedulerRef = useRef(
    createRecoveryDraftScheduler(saveRecoveryDraft, RECOVERY_DRAFT_DELAY_MS),
  );

  useEffect(() => {
    if (!editorReady || !editorRef.current) {
      return;
    }

    setPendingRecoveryDraft(readRecoveryDraft());
    setRecoveryChecked(true);
  }, [editorReady, editorRef]);

  useEffect(() => {
    const scheduler = schedulerRef.current;

    return () => {
      scheduler.cancel();
    };
  }, []);

  const clearPendingRecoveryDraft = useCallback(() => {
    schedulerRef.current.cancel();
    clearRecoveryDraft();
    setPendingRecoveryDraft(null);
  }, []);

  const currentFilePathRef = useRef(currentFilePath);

  useEffect(() => {
    currentFilePathRef.current = currentFilePath;
  }, [currentFilePath]);

  const scheduleRecoveryDraft = useCallback(() => {
    if (!editorRef.current) {
      return;
    }

    schedulerRef.current.schedule(() => {
      const editor = editorRef.current;
      if (!editor) {
        return null;
      }

      return {
        filePath: currentFilePathRef.current,
        text: editor.serializeText(),
      };
    });
  }, [editorRef]);

  const restoreRecoveryDraft = useCallback(() => {
    const editor = editorRef.current;

    if (!editor || !pendingRecoveryDraft) {
      return;
    }

    schedulerRef.current.cancel();
    saveRecoveryDraft({
      filePath: null,
      text: pendingRecoveryDraft.text,
    });
    editor.loadText(pendingRecoveryDraft.text, { saved: false });
    editor.setContext({ path: null });
    onRestore();
    setPendingRecoveryDraft(null);
    editor.focus();
  }, [editorRef, onRestore, pendingRecoveryDraft]);

  return {
    clearRecoveryDraft: clearPendingRecoveryDraft,
    discardRecoveryDraft: clearPendingRecoveryDraft,
    pendingRecoveryDraft,
    recoveryChecked,
    restoreRecoveryDraft,
    scheduleRecoveryDraft,
  };
}
