import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandMenuInvocation } from '../../features/commands/commandTypes';
import { useCommandPaletteModel } from './useCommandPaletteModel';

describe('useCommandPaletteModel', () => {
  afterEach(cleanup);

  it('restores focus to the opener after the palette closes', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { result } = renderHook(() => useCommandPaletteModel(vi.fn()));

    act(() => result.current.openPalette());
    expect(result.current.open).toBe(true);

    act(() => result.current.setOpen(false));

    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it('dispatches a typed invocation and restores opener focus for menu-managed actions', async () => {
    const opener = document.createElement('button');
    const actionTarget = document.createElement('button');
    document.body.append(opener, actionTarget);
    opener.focus();
    const runInvocation = vi.fn(() => actionTarget.focus());
    const { result } = renderHook(() =>
      useCommandPaletteModel(runInvocation),
    );
    const invocation: CommandMenuInvocation = {
      action: 'save',
      kind: 'action',
    };

    act(() => result.current.openPalette());
    act(() => {
      result.current.runAfterClose(invocation);
      result.current.setOpen(false);
    });

    await waitFor(() => expect(runInvocation).toHaveBeenCalledWith(invocation));
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
    actionTarget.remove();
  });

  it('preserves focus chosen by an action-managed typed invocation', async () => {
    const opener = document.createElement('button');
    const actionTarget = document.createElement('button');
    document.body.append(opener, actionTarget);
    opener.focus();
    const runInvocation = vi.fn(() => actionTarget.focus());
    const { result } = renderHook(() =>
      useCommandPaletteModel(runInvocation),
    );
    const invocation: CommandMenuInvocation = {
      action: 'openSettings',
      focusManagement: 'action',
      kind: 'action',
    };

    act(() => result.current.openPalette());
    act(() => {
      result.current.runAfterClose(invocation);
      result.current.setOpen(false);
    });

    await waitFor(() => expect(runInvocation).toHaveBeenCalledWith(invocation));
    await waitFor(() => expect(actionTarget).toHaveFocus());
    opener.remove();
    actionTarget.remove();
  });
});
