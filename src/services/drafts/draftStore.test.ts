import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecoveryDraft,
  readRecoveryDraft,
  saveRecoveryDraft,
} from './draftStore';

describe('recovery draft store', () => {
  let storage: Storage;

  beforeEach(() => {
    const entries = new Map<string, string>();
    storage = {
      clear: () => entries.clear(),
      getItem: (key) => entries.get(key) ?? null,
      key: () => null,
      get length() {
        return entries.size;
      },
      removeItem: (key) => entries.delete(key),
      setItem: (key, value) => entries.set(key, value),
    };
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
  });

  it('round-trips the latest unsaved document snapshot', () => {
    saveRecoveryDraft({
      filePath: 'E:/notes/draft.md',
      text: '# Draft\n\nUnsaved text',
    });

    expect(readRecoveryDraft()).toEqual({
      filePath: 'E:/notes/draft.md',
      text: '# Draft\n\nUnsaved text',
    });
  });

  it('clears a recovered snapshot after the user saves or discards it', () => {
    saveRecoveryDraft({ filePath: null, text: 'Untitled draft' });

    clearRecoveryDraft();

    expect(readRecoveryDraft()).toBeNull();
  });

  it('does not interrupt editing when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage is unavailable.');
      },
      removeItem: () => {
        throw new Error('Storage is unavailable.');
      },
      setItem: () => {
        throw new Error('Storage is unavailable.');
      },
    } satisfies Partial<Storage>);

    expect(() => {
      saveRecoveryDraft({ filePath: null, text: 'Draft' });
      clearRecoveryDraft();
    }).not.toThrow();
    expect(readRecoveryDraft()).toBeNull();
  });

  it('does not read an accessor-only Node storage global', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    );
    const browserStorage = document.defaultView?.localStorage;
    let accessorReads = 0;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        accessorReads += 1;
        throw new Error('Node localStorage getter must not be used.');
      },
    });

    try {
      browserStorage?.clear();
      saveRecoveryDraft({ filePath: null, text: 'Browser-backed draft' });

      expect(accessorReads).toBe(0);
      expect(
        browserStorage?.getItem('lumamark-recovery-draft-v1'),
      ).toBeNull();
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'localStorage', descriptor);
      }
    }
  });
});
