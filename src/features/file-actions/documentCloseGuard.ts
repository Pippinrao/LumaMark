import type { AutosaveSaveOutcome } from '../../services/autosave/autosaveScheduler';

export type DocumentCloseChoice = 'save' | 'discard' | 'cancel';
export type DocumentCloseDecision = 'proceed' | 'cancelled' | 'blocked';

type DocumentCloseGuardOptions = {
  archiveDiscard: () => Promise<{ ok: boolean }>;
  bypass: () => boolean;
  flushAutosave: () => Promise<string>;
  prompt: () => Promise<DocumentCloseChoice>;
  readSession: () => { dirty: boolean; hasPersistedPath: boolean };
  save: () => Promise<AutosaveSaveOutcome>;
};

export type DocumentCloseGuard = {
  prepareClose: () => Promise<DocumentCloseDecision>;
};

export function createDocumentCloseGuard({
  archiveDiscard,
  bypass,
  flushAutosave,
  prompt,
  readSession,
  save,
}: DocumentCloseGuardOptions): DocumentCloseGuard {
  let inFlight: Promise<DocumentCloseDecision> | null = null;

  const run = async (): Promise<DocumentCloseDecision> => {
    await flushAutosave();

    if (bypass() || !readSession().dirty) {
      return 'proceed';
    }

    const choice = await prompt();
    if (choice === 'cancel') {
      return 'cancelled';
    }

    if (choice === 'save') {
      const outcome = await save();
      if (outcome.status === 'saved' && !readSession().dirty) {
        return 'proceed';
      }
      if (outcome.status === 'saved') {
        return 'proceed';
      }
      if (outcome.status === 'cancelled') {
        return 'cancelled';
      }
      return 'blocked';
    }

    const archived = await archiveDiscard();
    return archived.ok ? 'proceed' : 'blocked';
  };

  return {
    prepareClose() {
      if (inFlight) {
        return inFlight;
      }

      inFlight = run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
