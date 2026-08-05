import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCommandPaletteModel } from './useCommandPaletteModel';

describe('useCommandPaletteModel', () => {
  afterEach(cleanup);

  it('restores focus to the opener after the palette closes', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { result } = renderHook(() => useCommandPaletteModel());

    act(() => result.current.openPalette());
    expect(result.current.open).toBe(true);

    act(() => result.current.setOpen(false));

    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it('runs a deferred command instead of restoring opener focus', async () => {
    const run = vi.fn();
    const { result } = renderHook(() => useCommandPaletteModel());

    act(() => result.current.openPalette());
    act(() => {
      result.current.runAfterClose(run);
      result.current.setOpen(false);
    });

    await waitFor(() => expect(run).toHaveBeenCalledOnce());
  });
});
