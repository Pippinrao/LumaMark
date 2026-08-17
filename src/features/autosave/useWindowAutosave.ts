import { useEffect, useMemo, useRef } from 'react';

import type { AutosaveSaveOutcome, AutosaveScheduler, AutosaveSessionState } from '../../services/autosave/autosaveScheduler';
import {
  createWindowAutosaveBinding,
  WINDOW_AUTOSAVE_DEBOUNCE_MS,
} from './windowAutosaveBinding';

type UseWindowAutosaveOptions = {
  autosaveEnabled: boolean;
  currentFilePath: string | null;
  dirty: boolean;
  externalConflict: boolean;
  fileOpening: boolean;
  readDirtyRevision: () => number;
  save: (revision: number) => Promise<AutosaveSaveOutcome>;
  subscribeDirtyRevision: (onRevision: (revision: number) => void) => () => void;
};

export function useWindowAutosave({
  autosaveEnabled,
  currentFilePath,
  dirty,
  externalConflict,
  fileOpening,
  readDirtyRevision,
  save,
  subscribeDirtyRevision,
}: UseWindowAutosaveOptions): AutosaveScheduler {
  const sessionRef = useRef<AutosaveSessionState>({
    dirty,
    externalConflict,
    fileOpening,
    hasPersistedPath: currentFilePath !== null,
    revision: readDirtyRevision(),
  });
  const saveRef = useRef(save);

  useEffect(() => {
    sessionRef.current = {
      dirty,
      externalConflict,
      fileOpening,
      hasPersistedPath: currentFilePath !== null,
      revision: readDirtyRevision(),
    };
    saveRef.current = save;
  });

  const binding = useMemo(
    () =>
      // Binding construction only stores callbacks; they run after render.
      // eslint-disable-next-line react-hooks/refs -- callbacks are invoked from timers, not during render
      createWindowAutosaveBinding({
        debounceMs: WINDOW_AUTOSAVE_DEBOUNCE_MS,
        readSession: () => sessionRef.current,
        save: (revision) => saveRef.current(revision),
      }),
    [],
  );

  useEffect(() => {
    binding.setEnabled(autosaveEnabled);
  }, [autosaveEnabled, binding]);

  useEffect(() => {
    if (dirty) {
      binding.notifyDirty(readDirtyRevision());
    }
  }, [binding, dirty, readDirtyRevision]);

  useEffect(() => {
    return subscribeDirtyRevision((revision) => {
      sessionRef.current = {
        ...sessionRef.current,
        dirty: true,
        revision,
      };
      binding.notifyDirty(revision);
    });
  }, [binding, subscribeDirtyRevision]);

  useEffect(() => {
    binding.notifyAvailabilityChanged();
  }, [binding, currentFilePath, externalConflict, fileOpening]);

  useEffect(() => () => binding.dispose(), [binding]);

  return binding;
}
