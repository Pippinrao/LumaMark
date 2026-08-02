import { describe, expect, it, vi } from 'vitest';
import {
  invokeCommand,
  type InvokeCommandFunction,
} from '../tauri/invokeCommand';
import {
  readTextFile,
  showOpenFileDialog,
  showOpenImageDialog,
  showSaveFileDialog,
  writeTextFile,
} from './fileCommands';

describe('invokeCommand', () => {
  it('wraps successful Tauri responses in a stable command result', async () => {
    const invokeFn: InvokeCommandFunction = vi
      .fn()
      .mockResolvedValue({ path: 'note.md' });

    const result = await invokeCommand('files_read_text', { path: 'note.md' }, invokeFn);

    expect(result).toEqual({ ok: true, data: { path: 'note.md' } });
  });

  it('normalizes structured Tauri errors into a stable command result', async () => {
    const invokeFn: InvokeCommandFunction = vi.fn().mockRejectedValue({
      code: 'file.not_found',
      message: 'The file does not exist.',
      recoverable: true,
    });

    const result = await invokeCommand('files_read_text', { path: 'missing.md' }, invokeFn);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'file.not_found',
        message: 'The file does not exist.',
        recoverable: true,
      },
    });
  });
});

describe('file command clients', () => {
  it('invokes the Rust read command with a file path', async () => {
    const invokeFn = vi.fn().mockResolvedValue({
      byteLength: 12,
      path: 'E:/docs/note.md',
      text: '# LumaMark',
    });

    const result = await readTextFile('E:/docs/note.md', { invokeFn });

    expect(invokeFn).toHaveBeenCalledWith('files_read_text', {
      path: 'E:/docs/note.md',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        byteLength: 12,
        path: 'E:/docs/note.md',
        text: '# LumaMark',
      },
    });
  });

  it('invokes the Rust write command with text read from the editor path', async () => {
    const invokeFn = vi.fn().mockResolvedValue({
      byteLength: 11,
      path: 'E:/docs/note.md',
    });

    const result = await writeTextFile('E:/docs/note.md', '# LumaMark', {
      invokeFn,
    });

    expect(invokeFn).toHaveBeenCalledWith('files_write_text', {
      path: 'E:/docs/note.md',
      text: '# LumaMark',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        byteLength: 11,
        path: 'E:/docs/note.md',
      },
    });
  });

  it('maps dialog commands to stable Rust command names', async () => {
    const invokeFn = vi
      .fn()
      .mockResolvedValueOnce('E:/docs/open.md')
      .mockResolvedValueOnce('E:/docs/save.md')
      .mockResolvedValueOnce(['E:/images/cover.png', 'E:/images/map.webp']);

    await expect(showOpenFileDialog({ invokeFn })).resolves.toEqual({
      ok: true,
      data: 'E:/docs/open.md',
    });
    await expect(showSaveFileDialog({ invokeFn })).resolves.toEqual({
      ok: true,
      data: 'E:/docs/save.md',
    });
    await expect(showOpenImageDialog('Images', { invokeFn })).resolves.toEqual({
      ok: true,
      data: ['E:/images/cover.png', 'E:/images/map.webp'],
    });

    expect(invokeFn).toHaveBeenNthCalledWith(
      1,
      'files_show_open_file_dialog',
      undefined,
    );
    expect(invokeFn).toHaveBeenNthCalledWith(
      2,
      'files_show_save_file_dialog',
      undefined,
    );
    expect(invokeFn).toHaveBeenNthCalledWith(
      3,
      'files_show_open_image_dialog',
      { filterLabel: 'Images' },
    );
  });
});
