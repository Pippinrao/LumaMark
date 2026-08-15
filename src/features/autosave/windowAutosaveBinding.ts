import {
  createAutosaveScheduler,
  type AutosaveScheduler,
  type AutosaveSaveOutcome,
  type AutosaveSessionState,
} from '../../services/autosave/autosaveScheduler';

export const WINDOW_AUTOSAVE_DEBOUNCE_MS = 1000;

type CreateWindowAutosaveBindingOptions = {
  debounceMs?: number;
  readSession: () => AutosaveSessionState;
  save: (revision: number) => Promise<AutosaveSaveOutcome>;
};

export function createWindowAutosaveBinding({
  debounceMs = WINDOW_AUTOSAVE_DEBOUNCE_MS,
  readSession,
  save,
}: CreateWindowAutosaveBindingOptions): AutosaveScheduler {
  return createAutosaveScheduler({
    debounceMs,
    readSession,
    save,
  });
}
