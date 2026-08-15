import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFocusMode } from './useFocusMode';

describe('useFocusMode startup setting', () => {
  it('applies focus mode only once at shell startup and restores the prior sidebar state', () => {
    const focusEditor = vi.fn();
    const setSidebarOpen = vi.fn();
    const { result, rerender } = renderHook(
      ({ initialFocusMode }) =>
        useFocusMode({
          focusEditor,
          initialFocusMode,
          setSidebarOpen,
          sidebarOpen: true,
        }),
      { initialProps: { initialFocusMode: true } },
    );

    expect(result.current.focusMode).toBe(true);
    expect(setSidebarOpen).toHaveBeenCalledTimes(1);
    expect(setSidebarOpen).toHaveBeenLastCalledWith(false);

    rerender({ initialFocusMode: false });
    expect(result.current.focusMode).toBe(true);
    expect(setSidebarOpen).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.exitFocusMode();
    });

    expect(result.current.focusMode).toBe(false);
    expect(setSidebarOpen).toHaveBeenLastCalledWith(true);
    expect(focusEditor).toHaveBeenCalledTimes(1);
  });
});
