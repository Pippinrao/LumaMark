import { describe, expect, it, vi } from 'vitest';
import { guardEditorCommand } from './editorCommandGuard';

describe('guardEditorCommand', () => {
  it('does not run an editor command while the start screen owns interaction', () => {
    const command = vi.fn();

    guardEditorCommand(false, command)();

    expect(command).not.toHaveBeenCalled();
  });

  it('runs the command when the editor workspace is interactive', () => {
    const command = vi.fn();

    guardEditorCommand(true, command)();

    expect(command).toHaveBeenCalledOnce();
  });
});
