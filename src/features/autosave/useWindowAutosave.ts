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
  dirtyRevision: number;
  externalConflict: boolean;
  fileOpening: boolean;
  save: (revision: number) => Promise<AutosaveSaveOutcome>;
};

export function useWindowAutosave({
  autosaveEnabled,
  currentFilePath,
  dirty,
  dirtyRevision,
  externalConflict,
  fileOpening,
  save,
}: UseWindowAutosaveOptions): AutosaveScheduler {
  const sessionRef = useRef<AutosaveSessionState>({
    dirty,
    externalConflict,
    fileOpening,
    hasPersistedPath: currentFilePath !== null,
    revision: dirtyRevision,
  });
  const saveRef = useRef(save);

  useEffect(() => {
    sessionRef.current = {
      dirty,
      externalConflict,
      fileOpening,
      hasPersistedPath: currentFilePath !== null,
      revision: dirtyRevision,
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
      binding.notifyDirty(dirtyRevision);
    }
  }, [binding, dirty, dirtyRevision]);

  useEffect(() => {
    binding.notifyAvailabilityChanged();
  }, [binding, currentFilePath, externalConflict, fileOpening]);

  useEffect(() => () => binding.dispose(), [binding]);

  return binding;
}
