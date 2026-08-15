import { describe, expect, it, vi } from 'vitest';

import { restoreTrashAsUnsavedSnapshot } from './restoreTrashAsUnsavedSnapshot';

describe('restoreTrashAsUnsavedSnapshot', () => {
  it('loads restored text as a new unsaved document and never writes the original path', async () => {
    const loadUnsavedDocument = vi.fn();
    const writeOriginalPath = vi.fn();
    const restore = vi.fn(async () => ({
      data: {
        entry: {
          byteLength: 12,
          createdAtMs: 1,
          fingerprint: 'fp',
          id: 'entry-1',
          reason: 'close_discard' as const,
          sourcePath: 'E:/docs/note.md',
        },
        text: '# restored\n',
      },
      ok: true as const,
    }));

    const result = await restoreTrashAsUnsavedSnapshot('entry-1', {
      loadUnsavedDocument,
      restore,
      writeOriginalPath,
    });

    expect(restore).toHaveBeenCalledWith('entry-1');
    expect(loadUnsavedDocument).toHaveBeenCalledWith('# restored\n');
    expect(writeOriginalPath).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, status: 'restoredUnsaved' });
  });

  it('does not load a snapshot when restore fails', async () => {
    const loadUnsavedDocument = vi.fn();
    const result = await restoreTrashAsUnsavedSnapshot('missing', {
      loadUnsavedDocument,
      restore: vi.fn(async () => ({
        error: {
          code: 'trash.not_found',
          message: 'missing',
          recoverable: true,
        },
        ok: false as const,
      })),
      writeOriginalPath: vi.fn(),
    });

    expect(loadUnsavedDocument).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'trash.not_found' },
    });
  });
});
