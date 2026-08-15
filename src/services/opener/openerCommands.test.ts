import { describe, expect, it, vi } from 'vitest';
import { openExternalUrl, revealPathInOs } from './openerCommands';

describe('openExternalUrl', () => {
  it('rejects disallowed protocols without invoking Tauri', async () => {
    const invokeFn = vi.fn();

    const result = await openExternalUrl('javascript:alert(1)', { invokeFn });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'link.protocol_javascript',
        message: 'URL protocol is not allowed.',
        recoverable: true,
      },
    });
    expect(invokeFn).not.toHaveBeenCalled();
  });

  it('invokes the Rust opener command for allowed absolute URLs', async () => {
    const invokeFn = vi.fn().mockResolvedValue({ opened: true });

    const result = await openExternalUrl('https://example.com', { invokeFn });

    expect(result).toEqual({ ok: true, data: { opened: true } });
    expect(invokeFn).toHaveBeenCalledWith('opener_open_url', {
      url: 'https://example.com',
    });
  });

  it('does not open relative paths through the system opener', async () => {
    const invokeFn = vi.fn();

    const result = await openExternalUrl('./note.md', { invokeFn });

    expect(result.ok).toBe(false);
    expect(invokeFn).not.toHaveBeenCalled();
  });
});

describe('revealPathInOs', () => {
  it('invokes the Rust reveal command with workspace and document context', async () => {
    const invokeFn = vi.fn().mockResolvedValue({ revealed: true });

    const result = await revealPathInOs(
      'E:\\notes\\assets\\pic.png',
      {
        documentPath: 'E:\\notes\\doc.md',
        workspaceRoot: 'E:\\notes',
      },
      { invokeFn },
    );

    expect(result).toEqual({ ok: true, data: { revealed: true } });
    expect(invokeFn).toHaveBeenCalledWith('opener_reveal_path', {
      documentPath: 'E:\\notes\\doc.md',
      path: 'E:\\notes\\assets\\pic.png',
      workspaceRoot: 'E:\\notes',
    });
  });

  it('rejects empty paths without invoking Tauri', async () => {
    const invokeFn = vi.fn();

    const result = await revealPathInOs('   ', {}, { invokeFn });

    expect(result.ok).toBe(false);
    expect(invokeFn).not.toHaveBeenCalled();
  });
});
