import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutosaveSaveOutcome, AutosaveSessionState } from '../../services/autosave/autosaveScheduler';
import { createWindowAutosaveBinding } from './windowAutosaveBinding';

describe('window autosave binding', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays off until the preference is enabled and never stores document text', async () => {
    const session: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 1,
    };
    const save = vi.fn(async (revision: number): Promise<AutosaveSaveOutcome> => {
      session.dirty = false;
      return { revision, status: 'saved' };
    });
    const binding = createWindowAutosaveBinding({
      debounceMs: 40,
      readSession: () => session,
      save,
    });

    binding.notifyDirty(1);
    await vi.advanceTimersByTimeAsync(40);
    expect(save).not.toHaveBeenCalled();

    binding.setEnabled(true);
    await vi.advanceTimersByTimeAsync(40);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(1);
    expect(session).not.toHaveProperty('text');
    binding.dispose();
  });

  it('blocks while a file is opening or an external conflict is active', async () => {
    const session: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: true,
      hasPersistedPath: true,
      revision: 2,
    };
    const save = vi.fn(async (revision: number): Promise<AutosaveSaveOutcome> => {
      session.dirty = false;
      return { revision, status: 'saved' };
    });
    const binding = createWindowAutosaveBinding({
      debounceMs: 40,
      readSession: () => session,
      save,
    });
    binding.setEnabled(true);
    binding.notifyDirty(2);
    await vi.advanceTimersByTimeAsync(40);
    expect(save).not.toHaveBeenCalled();

    session.fileOpening = false;
    binding.notifyAvailabilityChanged();
    await vi.advanceTimersByTimeAsync(40);
    expect(save).toHaveBeenCalledTimes(1);

    session.dirty = true;
    session.revision = 3;
    session.externalConflict = true;
    binding.notifyDirty(3);
    await vi.advanceTimersByTimeAsync(40);
    expect(save).toHaveBeenCalledTimes(1);
    binding.dispose();
  });

  it('does not autosave untitled documents that have no persisted path', async () => {
    const session: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: false,
      revision: 4,
    };
    const save = vi.fn(async (revision: number): Promise<AutosaveSaveOutcome> => {
      return { revision, status: 'saved' };
    });
    const binding = createWindowAutosaveBinding({
      debounceMs: 40,
      readSession: () => session,
      save,
    });
    binding.setEnabled(true);
    binding.notifyDirty(4);
    await vi.advanceTimersByTimeAsync(40);
    expect(save).not.toHaveBeenCalled();
    await expect(binding.flush()).resolves.toBe('untitled');
    binding.dispose();
  });
});
