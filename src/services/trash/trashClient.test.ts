import { describe, expect, it, vi } from 'vitest';
import {
  archiveTrashDocument,
  emptyTrash,
  listTrashEntries,
  readTrashDocument,
  removeTrashEntry,
  restoreTrashDocument,
} from './trashClient';

describe('trash command client', () => {
  it('sends an exact snapshot and disposition reason to the archive command', async () => {
    const invokeFn = vi.fn().mockResolvedValue({
      cleanupPending: false,
      entry: {
        byteLength: 8,
        createdAtMs: 10,
        fingerprint: 'abc',
        id: 'entry-1',
        reason: 'close_discard',
        sourcePath: 'E:/notes/note.md',
      },
    });

    const result = await archiveTrashDocument(
      {
        reason: 'close_discard',
        sourcePath: 'E:/notes/note.md',
        text: '\ufeff# 标题\r\n',
      },
      { invokeFn },
    );

    expect(invokeFn).toHaveBeenCalledWith('trash_archive', {
      request: {
        reason: 'close_discard',
        sourcePath: 'E:/notes/note.md',
        text: '\ufeff# 标题\r\n',
      },
    });
    expect(result).toMatchObject({
      ok: true,
      data: { cleanupPending: false, entry: { id: 'entry-1' } },
    });
  });

  it('uses focused commands for list, read, restore, remove, and empty', async () => {
    const invokeFn = vi.fn().mockResolvedValue(null);

    await listTrashEntries({ invokeFn });
    await readTrashDocument('entry-1', { invokeFn });
    await restoreTrashDocument('entry-1', { invokeFn });
    await removeTrashEntry('entry-1', { invokeFn });
    await emptyTrash({ invokeFn });

    expect(invokeFn.mock.calls).toEqual([
      ['trash_list', undefined],
      ['trash_read', { id: 'entry-1' }],
      ['trash_restore', { id: 'entry-1' }],
      ['trash_remove', { id: 'entry-1' }],
      ['trash_empty', undefined],
    ]);
  });
});
