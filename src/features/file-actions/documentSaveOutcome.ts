import type { CommandResult } from '../../services/tauri/invokeCommand';
import type { AutosaveSaveOutcome } from '../../services/autosave/autosaveScheduler';

export type DocumentSaveSessionAfter = {
  dirty: boolean;
  revision: number;
};

export function interpretDocumentSaveResult({
  attemptedRevision,
  result,
  sessionAfter,
}: {
  attemptedRevision: number;
  result: CommandResult<unknown>;
  sessionAfter: DocumentSaveSessionAfter;
}): AutosaveSaveOutcome {
  if (!result.ok) {
    return { revision: attemptedRevision, status: 'failed' };
  }

  if (result.data === null) {
    return { revision: attemptedRevision, status: 'cancelled' };
  }

  if (!sessionAfter.dirty) {
    return { revision: attemptedRevision, status: 'saved' };
  }

  if (sessionAfter.revision !== attemptedRevision) {
    return { revision: attemptedRevision, status: 'superseded' };
  }

  return { revision: attemptedRevision, status: 'stillDirty' };
}

export async function saveVoidAsOutcome({
  attemptedRevision,
  readSessionAfter,
  save,
}: {
  attemptedRevision: number;
  readSessionAfter: () => DocumentSaveSessionAfter;
  save: () => Promise<void>;
}): Promise<AutosaveSaveOutcome> {
  try {
    await save();
  } catch {
    return { revision: attemptedRevision, status: 'failed' };
  }

  const sessionAfter = readSessionAfter();
  if (!sessionAfter.dirty) {
    return { revision: attemptedRevision, status: 'saved' };
  }
  if (sessionAfter.revision !== attemptedRevision) {
    return { revision: attemptedRevision, status: 'superseded' };
  }
  return { revision: attemptedRevision, status: 'stillDirty' };
}
