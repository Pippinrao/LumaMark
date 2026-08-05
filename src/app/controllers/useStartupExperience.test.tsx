import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStartupStore } from '../../features/startup/startupStore';
import type { RecoveryDraft } from '../../services/drafts/draftStore';
import { useStartupExperience } from './useStartupExperience';

function createOptions() {
  return {
    currentFilePath: null,
    dirty: false,
    editorReady: true,
    fileWorkflow: {
      createNewDocument: vi.fn(),
      openFromDialog: vi.fn(),
      openPath: vi.fn(),
    },
    recoveryDraft: {
      pendingRecoveryDraft: null as RecoveryDraft | null,
      recoveryChecked: true,
    },
    workspace: {
      openPath: vi.fn(),
      openWorkspace: vi.fn(),
      root: null,
    },
  };
}

describe('useStartupExperience', () => {
  afterEach(cleanup);
  beforeEach(() => {
    useStartupStore.setState({
      lastSession: null,
      recentWorkspaces: [],
      startScreenOpen: true,
      startupBehavior: 'home',
    });
  });

  it('keeps the start screen open after a cancelled file picker and closes it after success', async () => {
    const options = createOptions();
    options.fileWorkflow.openFromDialog
      .mockResolvedValueOnce({ status: 'cancelled' })
      .mockResolvedValueOnce({
        file: { name: 'today.md', path: 'E:/notes/today.md' },
        status: 'opened',
      });
    const { result } = renderHook(() => useStartupExperience(options));

    await act(async () => { await result.current.openFile(); });
    expect(result.current.visible).toBe(true);

    await act(async () => { await result.current.openFile(); });
    expect(result.current.visible).toBe(false);
    expect(useStartupStore.getState().lastSession).toEqual({
      kind: 'file',
      path: 'E:/notes/today.md',
    });
  });

  it('waits for recovery resolution before restoring the last session', async () => {
    useStartupStore.setState({
      lastSession: { kind: 'file', path: 'E:/notes/last.md' },
      startupBehavior: 'restoreLastSession',
    });
    const options = createOptions();
    options.recoveryDraft.recoveryChecked = false;
    options.fileWorkflow.openPath.mockResolvedValue({
      file: { name: 'last.md', path: 'E:/notes/last.md' },
      status: 'opened',
    });
    const { rerender, result } = renderHook(() => useStartupExperience(options));

    expect(options.fileWorkflow.openPath).not.toHaveBeenCalled();
    options.recoveryDraft.recoveryChecked = true;
    options.recoveryDraft.pendingRecoveryDraft = {
      filePath: null,
      text: '# recovered',
    };
    rerender();
    expect(options.fileWorkflow.openPath).not.toHaveBeenCalled();

    options.recoveryDraft.pendingRecoveryDraft = null;
    rerender();
    await waitFor(() => {
      expect(options.fileWorkflow.openPath).toHaveBeenCalledWith('E:/notes/last.md');
      expect(result.current.visible).toBe(false);
    });
  });

  it('applies a changed startup preference on the next launch, not immediately', async () => {
    useStartupStore.setState({
      lastSession: { kind: 'file', path: 'E:/notes/next-launch.md' },
      startupBehavior: 'home',
    });
    const options = createOptions();
    const { result } = renderHook(() => useStartupExperience(options));

    act(() => {
      useStartupStore.getState().setStartupBehavior('restoreLastSession');
    });
    await act(async () => { await Promise.resolve(); });

    expect(options.fileWorkflow.openPath).not.toHaveBeenCalled();
    expect(result.current.visible).toBe(true);
  });
});
