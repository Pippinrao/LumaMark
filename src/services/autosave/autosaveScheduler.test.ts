import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAutosaveScheduler,
  type AutosaveSessionState,
} from './autosaveScheduler';

describe('autosave scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces and coalesces dirty revisions without carrying document text', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 1,
    };
    const save = vi.fn(async (revision: number) => {
      state.dirty = false;
      return { revision, status: 'saved' } as const;
    });
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);

    scheduler.notifyDirty(1);
    await vi.advanceTimersByTimeAsync(90);
    state.revision = 2;
    scheduler.notifyDirty(2);
    await vi.advanceTimersByTimeAsync(99);

    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(2);
  });

  it('runs at most one trailing save for every in-flight burst', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 1,
    };
    let resolveFirst!: (outcome: { revision: number; status: 'stillDirty' }) => void;
    const firstSave = new Promise<{ revision: number; status: 'stillDirty' }>((resolve) => {
      resolveFirst = resolve;
    });
    const save = vi.fn((revision: number) => {
      if (revision === 1) {
        return firstSave;
      }
      state.dirty = false;
      return Promise.resolve({ revision, status: 'saved' } as const);
    });
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);
    scheduler.notifyDirty(1);
    await vi.advanceTimersByTimeAsync(100);

    state.revision = 2;
    scheduler.notifyDirty(2);
    state.revision = 3;
    scheduler.notifyDirty(3);
    await vi.advanceTimersByTimeAsync(100);

    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst({ revision: 1, status: 'stillDirty' });
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(3);
  });

  it('reports a failed flush without clearing dirty state or retrying forever', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 4,
    };
    const save = vi.fn(async (revision: number) => ({
      revision,
      status: 'failed' as const,
    }));
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);
    scheduler.notifyDirty(4);
    await vi.advanceTimersByTimeAsync(100);

    const outcome = await scheduler.flush();
    await vi.runAllTimersAsync();

    expect(outcome).toBe('failed');
    expect(state.dirty).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending debounce immediately and waits until the session is clean', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 7,
    };
    const save = vi.fn(async (revision: number) => {
      state.dirty = false;
      return { revision, status: 'saved' } as const;
    });
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);
    scheduler.notifyDirty(7);

    const outcome = await scheduler.flush();
    await vi.runAllTimersAsync();

    expect(outcome).toBe('clean');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(7);
  });

  it.each([
    {
      expected: 'blocked' as const,
      state: { externalConflict: false, fileOpening: true, hasPersistedPath: true },
    },
    {
      expected: 'blocked' as const,
      state: { externalConflict: true, fileOpening: false, hasPersistedPath: true },
    },
    {
      expected: 'untitled' as const,
      state: { externalConflict: false, fileOpening: false, hasPersistedPath: false },
    },
  ])('does not save while the session is unavailable: $expected', async ({ expected, state: blockedState }) => {
    const state: AutosaveSessionState = {
      dirty: true,
      revision: 9,
      ...blockedState,
    };
    const save = vi.fn(async (revision: number) => ({
      revision,
      status: 'saved' as const,
    }));
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);
    scheduler.notifyDirty(9);

    await vi.advanceTimersByTimeAsync(100);

    expect(save).not.toHaveBeenCalled();
    await expect(scheduler.flush()).resolves.toBe(expected);
    expect(save).not.toHaveBeenCalled();
  });

  it('reschedules the latest dirty revision when a blocked session becomes available', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: true,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 11,
    };
    const save = vi.fn(async (revision: number) => {
      state.dirty = false;
      return { revision, status: 'saved' } as const;
    });
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);
    scheduler.notifyDirty(11);
    await vi.advanceTimersByTimeAsync(100);
    expect(save).not.toHaveBeenCalled();

    state.externalConflict = false;
    scheduler.notifyAvailabilityChanged();
    await vi.advanceTimersByTimeAsync(99);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(11);
  });

  it('cancels pending work and ignores later events after disposal', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 12,
    };
    const save = vi.fn(async (revision: number) => ({
      revision,
      status: 'saved' as const,
    }));
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);
    scheduler.notifyDirty(12);

    scheduler.dispose();
    state.revision = 13;
    scheduler.notifyDirty(13);
    scheduler.notifyAvailabilityChanged();
    await vi.runAllTimersAsync();

    expect(save).not.toHaveBeenCalled();
    await expect(scheduler.flush()).resolves.toBe('disabled');
  });

  it('keeps timers and revisions isolated between window sessions', async () => {
    const firstState: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 21,
    };
    const secondState: AutosaveSessionState = {
      dirty: false,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 34,
    };
    const firstSave = vi.fn(async (revision: number) => ({
      revision,
      status: 'stillDirty' as const,
    }));
    const secondSave = vi.fn(async (revision: number) => ({
      revision,
      status: 'stillDirty' as const,
    }));
    const first = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => firstState,
      save: firstSave,
    });
    const second = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => secondState,
      save: secondSave,
    });
    first.setEnabled(true);
    second.setEnabled(true);

    first.notifyDirty(21);
    await vi.advanceTimersByTimeAsync(100);

    expect(firstSave).toHaveBeenCalledWith(21);
    expect(secondSave).not.toHaveBeenCalled();

    secondState.dirty = true;
    second.notifyDirty(34);
    await vi.advanceTimersByTimeAsync(100);

    expect(firstSave).toHaveBeenCalledTimes(1);
    expect(secondSave).toHaveBeenCalledWith(34);
  });

  it('normalizes a rejected save port to a failed flush', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 55,
    };
    const save = vi.fn(async () => {
      throw new Error('synthetic save rejection');
    });
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);
    scheduler.notifyDirty(55);

    await expect(scheduler.flush()).resolves.toBe('failed');
    expect(state.dirty).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('schedules an already-dirty named session when autosave is enabled', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 89,
    };
    const save = vi.fn(async (revision: number) => {
      state.dirty = false;
      return { revision, status: 'saved' } as const;
    });
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });

    scheduler.setEnabled(true);
    await vi.advanceTimersByTimeAsync(100);

    expect(save).toHaveBeenCalledWith(89);
  });

  it('flush waits for an in-flight save and its coalesced trailing revision', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 100,
    };
    let resolveFirst!: (outcome: { revision: number; status: 'stillDirty' }) => void;
    const firstSave = new Promise<{ revision: number; status: 'stillDirty' }>((resolve) => {
      resolveFirst = resolve;
    });
    const save = vi.fn((revision: number) => {
      if (revision === 100) {
        return firstSave;
      }
      state.dirty = false;
      return Promise.resolve({ revision, status: 'saved' } as const);
    });
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);
    await vi.advanceTimersByTimeAsync(100);
    state.revision = 101;
    scheduler.notifyDirty(101);

    const flush = scheduler.flush();
    resolveFirst({ revision: 100, status: 'stillDirty' });

    await expect(flush).resolves.toBe('clean');
    expect(save.mock.calls).toEqual([[100], [101]]);
  });

  it('flush waits through edits that arrive during consecutive trailing saves', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 200,
    };
    const resolvers = new Map<
      number,
      (outcome: { revision: number; status: 'stillDirty' }) => void
    >();
    const save = vi.fn((revision: number) => {
      return new Promise<{ revision: number; status: 'stillDirty' }>((resolve) => {
        resolvers.set(revision, resolve);
      });
    });
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);
    await vi.advanceTimersByTimeAsync(100);
    state.revision = 201;
    scheduler.notifyDirty(201);

    const flush = scheduler.flush();
    resolvers.get(200)?.({ revision: 200, status: 'stillDirty' });
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledWith(201);

    state.revision = 202;
    scheduler.notifyDirty(202);
    resolvers.get(201)?.({ revision: 201, status: 'stillDirty' });
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledWith(202);

    let flushSettled = false;
    void flush.then(() => {
      flushSettled = true;
    });
    await Promise.resolve();
    expect(flushSettled).toBe(false);
    state.dirty = false;
    resolvers.get(202)?.({ revision: 202, status: 'stillDirty' });

    await expect(flush).resolves.toBe('clean');
    expect(save.mock.calls).toEqual([[200], [201], [202]]);
  });

  it('flush stops after one no-progress save when notified revision is ahead of session state', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 9,
    };
    const save = vi.fn(async (revision: number) => {
      if (save.mock.calls.length > 1) {
        state.dirty = false;
        return { revision, status: 'saved' } as const;
      }
      return { revision, status: 'stillDirty' } as const;
    });
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);
    scheduler.notifyDirty(10);

    await expect(scheduler.flush()).resolves.toBe('dirty');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(10);
  });

  it('flush ignores a mismatched port revision when deciding whether progress was made', async () => {
    const state: AutosaveSessionState = {
      dirty: true,
      externalConflict: false,
      fileOpening: false,
      hasPersistedPath: true,
      revision: 5,
    };
    const save = vi.fn(async () => {
      if (save.mock.calls.length > 1) {
        state.dirty = false;
        return { revision: 5, status: 'saved' } as const;
      }
      return { revision: 999, status: 'stillDirty' } as const;
    });
    const scheduler = createAutosaveScheduler({
      debounceMs: 100,
      readSession: () => state,
      save,
    });
    scheduler.setEnabled(true);

    await expect(scheduler.flush()).resolves.toBe('dirty');
    expect(save).toHaveBeenCalledTimes(1);
  });
});
