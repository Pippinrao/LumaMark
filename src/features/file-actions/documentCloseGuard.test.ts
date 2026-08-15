import { describe, expect, it, vi } from 'vitest';

import { createDocumentCloseGuard } from './documentCloseGuard';

describe('document close guard', () => {
  it('proceeds without prompting when the document is already clean', async () => {
    const prompt = vi.fn();
    const flushAutosave = vi.fn(async () => 'clean' as const);
    const archiveDiscard = vi.fn();
    const guard = createDocumentCloseGuard({
      archiveDiscard,
      bypass: () => false,
      flushAutosave,
      prompt,
      readSession: () => ({ dirty: false, hasPersistedPath: true }),
      save: vi.fn(),
    });

    await expect(guard.prepareClose()).resolves.toBe('proceed');
    expect(flushAutosave).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
    expect(archiveDiscard).not.toHaveBeenCalled();
  });

  it('flushes autosave then prompts once for a dirty document', async () => {
    const prompt = vi.fn(async () => 'cancel' as const);
    const flushAutosave = vi.fn(async () => 'dirty' as const);
    const guard = createDocumentCloseGuard({
      archiveDiscard: vi.fn(),
      bypass: () => false,
      flushAutosave,
      prompt,
      readSession: () => ({ dirty: true, hasPersistedPath: true }),
      save: vi.fn(),
    });

    await expect(guard.prepareClose()).resolves.toBe('cancelled');
    expect(flushAutosave).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('saves then proceeds when the user chooses save', async () => {
    const save = vi.fn(async () => ({ revision: 2, status: 'saved' as const }));
    const guard = createDocumentCloseGuard({
      archiveDiscard: vi.fn(),
      bypass: () => false,
      flushAutosave: vi.fn(async () => 'dirty' as const),
      prompt: vi.fn(async () => 'save' as const),
      readSession: () => ({ dirty: true, hasPersistedPath: true }),
      save,
    });

    await expect(guard.prepareClose()).resolves.toBe('proceed');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('blocks close when save fails or remains dirty', async () => {
    const guard = createDocumentCloseGuard({
      archiveDiscard: vi.fn(),
      bypass: () => false,
      flushAutosave: vi.fn(async () => 'dirty' as const),
      prompt: vi.fn(async () => 'save' as const),
      readSession: () => ({ dirty: true, hasPersistedPath: true }),
      save: vi.fn(async () => ({ revision: 2, status: 'failed' as const })),
    });

    await expect(guard.prepareClose()).resolves.toBe('blocked');
  });

  it('archives a discard snapshot then proceeds without writing the original path', async () => {
    const archiveDiscard = vi.fn(async () => ({ ok: true as const }));
    const save = vi.fn();
    const guard = createDocumentCloseGuard({
      archiveDiscard,
      bypass: () => false,
      flushAutosave: vi.fn(async () => 'dirty' as const),
      prompt: vi.fn(async () => 'discard' as const),
      readSession: () => ({ dirty: true, hasPersistedPath: true }),
      save,
    });

    await expect(guard.prepareClose()).resolves.toBe('proceed');
    expect(archiveDiscard).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('bypasses the prompt and still flushes autosave', async () => {
    const prompt = vi.fn();
    const flushAutosave = vi.fn(async () => 'clean' as const);
    const guard = createDocumentCloseGuard({
      archiveDiscard: vi.fn(),
      bypass: () => true,
      flushAutosave,
      prompt,
      readSession: () => ({ dirty: true, hasPersistedPath: true }),
      save: vi.fn(),
    });

    await expect(guard.prepareClose()).resolves.toBe('proceed');
    expect(flushAutosave).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent close requests into one transaction', async () => {
    let resolvePrompt!: (choice: 'save') => void;
    const prompt = vi.fn(
      () =>
        new Promise<'save'>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    const save = vi.fn(async () => ({ revision: 1, status: 'saved' as const }));
    const guard = createDocumentCloseGuard({
      archiveDiscard: vi.fn(),
      bypass: () => false,
      flushAutosave: vi.fn(async () => 'dirty' as const),
      prompt,
      readSession: () => ({ dirty: true, hasPersistedPath: true }),
      save,
    });

    const first = guard.prepareClose();
    const second = guard.prepareClose();
    await Promise.resolve();
    expect(prompt).toHaveBeenCalledTimes(1);
    resolvePrompt('save');
    await expect(Promise.all([first, second])).resolves.toEqual([
      'proceed',
      'proceed',
    ]);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
