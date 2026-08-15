import { useCallback, useMemo, useRef, useState } from 'react';

import { archiveTrashDocument } from '../../services/trash/trashClient';
import {
  createDocumentCloseGuard,
  type DocumentCloseChoice,
} from './documentCloseGuard';
import { saveVoidAsOutcome } from './documentSaveOutcome';

type DocumentCloseSession = {
  dirty: boolean;
  hasPersistedPath: boolean;
  revision: number;
};

type UseDocumentCloseControllerOptions = {
  bypass?: () => boolean;
  currentFilePath: string | null;
  flushAutosave: () => Promise<string>;
  getSession: () => DocumentCloseSession;
  readDocumentText: () => string;
  save: () => Promise<void>;
};

export function useDocumentCloseController({
  bypass = () => false,
  currentFilePath,
  flushAutosave,
  getSession,
  readDocumentText,
  save,
}: UseDocumentCloseControllerOptions) {
  const [open, setOpen] = useState(false);
  const pendingChoice = useRef<((choice: DocumentCloseChoice) => void) | null>(
    null,
  );
  const currentFilePathRef = useRef(currentFilePath);
  currentFilePathRef.current = currentFilePath;
  const getSessionRef = useRef(getSession);
  getSessionRef.current = getSession;
  const saveRef = useRef(save);
  saveRef.current = save;
  const flushAutosaveRef = useRef(flushAutosave);
  flushAutosaveRef.current = flushAutosave;
  const readDocumentTextRef = useRef(readDocumentText);
  readDocumentTextRef.current = readDocumentText;

  const guard = useMemo(
    () =>
      createDocumentCloseGuard({
        archiveDiscard: async () => {
          const result = await archiveTrashDocument({
            reason: 'close_discard',
            sourcePath: currentFilePathRef.current,
            text: readDocumentTextRef.current(),
          });
          return { ok: result.ok };
        },
        bypass,
        flushAutosave: () => flushAutosaveRef.current(),
        prompt: () =>
          new Promise<DocumentCloseChoice>((resolve) => {
            pendingChoice.current = resolve;
            setOpen(true);
          }),
        readSession: () => getSessionRef.current(),
        save: () => {
          const attemptedRevision = getSessionRef.current().revision;
          return saveVoidAsOutcome({
            attemptedRevision,
            readSessionAfter: () => getSessionRef.current(),
            save: () => saveRef.current(),
          });
        },
      }),
    [bypass],
  );

  const settle = useCallback((choice: DocumentCloseChoice) => {
    pendingChoice.current?.(choice);
    pendingChoice.current = null;
    setOpen(false);
  }, []);

  return {
    chooseCancel: () => settle('cancel'),
    chooseDiscard: () => settle('discard'),
    chooseSave: () => settle('save'),
    open,
    prepareClose: guard.prepareClose,
    setOpen: (nextOpen: boolean) => {
      if (!nextOpen) {
        settle('cancel');
      }
    },
  };
}
