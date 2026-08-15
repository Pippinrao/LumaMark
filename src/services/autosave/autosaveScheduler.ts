export type AutosaveSessionState = {
  dirty: boolean;
  externalConflict: boolean;
  fileOpening: boolean;
  hasPersistedPath: boolean;
  revision: number;
};

export type AutosaveSaveOutcome = {
  revision: number;
  status: 'saved' | 'failed' | 'cancelled' | 'superseded' | 'stillDirty';
};

type CreateAutosaveSchedulerOptions = {
  debounceMs: number;
  readSession: () => AutosaveSessionState;
  save: (revision: number) => Promise<AutosaveSaveOutcome>;
};

export type AutosaveScheduler = {
  dispose: () => void;
  flush: () => Promise<
    'blocked' | 'clean' | 'dirty' | 'disabled' | 'failed' | 'untitled'
  >;
  notifyAvailabilityChanged: () => void;
  notifyDirty: (revision: number) => void;
  setEnabled: (enabled: boolean) => void;
};

function sessionBlockReason(
  state: AutosaveSessionState,
): 'blocked' | 'untitled' | null {
  if (!state.hasPersistedPath) {
    return 'untitled';
  }
  if (state.fileOpening || state.externalConflict) {
    return 'blocked';
  }
  return null;
}

export function createAutosaveScheduler({
  debounceMs,
  readSession,
  save,
}: CreateAutosaveSchedulerOptions): AutosaveScheduler {
  let enabled = false;
  let disposed = false;
  let latestRevision = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeSave: Promise<void> | null = null;
  let lastAttemptedSessionRevision: number | null = null;
  let lastOutcome: AutosaveSaveOutcome | null = null;
  let trailingRequested = false;

  const runSave = () => {
    if (disposed) {
      return;
    }
    if (activeSave !== null) {
      trailingRequested = true;
      return;
    }

    const state = readSession();
    if (!enabled || !state.dirty || sessionBlockReason(state) !== null) {
      return;
    }
    const attemptedRevision = Math.max(latestRevision, state.revision);
    lastAttemptedSessionRevision = state.revision;
    const operation = (async () => {
      try {
        lastOutcome = await save(attemptedRevision);
      } catch {
        lastOutcome = { revision: attemptedRevision, status: 'failed' };
      }
    })();
    activeSave = operation;
    void operation.finally(() => {
      if (activeSave !== operation) {
        return;
      }
      activeSave = null;
      if (
        trailingRequested &&
        enabled &&
        readSession().dirty &&
        latestRevision > attemptedRevision
      ) {
        trailingRequested = false;
        runSave();
      } else {
        trailingRequested = false;
      }
    });
  };

  const schedule = () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      const state = readSession();
      if (
        !enabled ||
        !state.dirty ||
        sessionBlockReason(state) !== null
      ) {
        return;
      }
      runSave();
    }, debounceMs);
  };

  return {
    dispose() {
      disposed = true;
      enabled = false;
      trailingRequested = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    async flush() {
      if (disposed) {
        return 'disabled';
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      for (;;) {
        const pendingSave = activeSave;
        if (pendingSave !== null) {
          await pendingSave;
          continue;
        }

        const state = readSession();
        if (!state.dirty) {
          return 'clean';
        }
        const blocked = sessionBlockReason(state);
        if (blocked !== null) {
          return blocked;
        }
        if (
          lastAttemptedSessionRevision === state.revision &&
          lastOutcome?.status === 'failed'
        ) {
          return 'failed';
        }
        if (!enabled) {
          return 'disabled';
        }
        if (
          lastAttemptedSessionRevision === state.revision &&
          lastOutcome !== null &&
          lastOutcome.status !== 'failed'
        ) {
          return 'dirty';
        }
        runSave();
      }
    },
    notifyAvailabilityChanged() {
      if (disposed) {
        return;
      }
      const state = readSession();
      if (
        !enabled ||
        !state.dirty ||
        sessionBlockReason(state) !== null
      ) {
        return;
      }
      latestRevision = Math.max(latestRevision, state.revision);
      if (activeSave !== null) {
        trailingRequested = true;
      } else {
        schedule();
      }
    },
    notifyDirty(revision) {
      if (disposed) {
        return;
      }
      latestRevision = Math.max(latestRevision, revision);
      if (enabled) {
        if (activeSave !== null) {
          trailingRequested = true;
        } else {
          schedule();
        }
      }
    },
    setEnabled(nextEnabled) {
      if (disposed) {
        return;
      }
      const wasEnabled = enabled;
      enabled = nextEnabled;
      if (!enabled && timer !== null) {
        clearTimeout(timer);
        timer = null;
      } else if (!wasEnabled && enabled) {
        const state = readSession();
        if (state.dirty && sessionBlockReason(state) === null) {
          latestRevision = Math.max(latestRevision, state.revision);
          schedule();
        }
      }
    },
  };
}
