import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WindowControls } from '../../services/window/windowControls';
import { useAppWindowControls } from './useAppWindowControls';

function createControls(
  onCloseRequested: WindowControls['onCloseRequested'],
): Pick<WindowControls, 'destroy' | 'onCloseRequested'> {
  return {
    destroy: vi.fn().mockResolvedValue(true),
    onCloseRequested,
  };
}

describe('useAppWindowControls', () => {
  it('opens settings with the close-listener failure code', async () => {
    const error = Object.assign(new Error('listen failed'), {
      code: 'window.close_listener_failed',
    });
    const setSettingsOpen = vi.fn();
    const controls = createControls(vi.fn().mockRejectedValue(error));
    const { result } = renderHook(() =>
      useAppWindowControls(
        vi.fn().mockResolvedValue(undefined),
        setSettingsOpen,
        controls,
      ),
    );

    await waitFor(() => expect(setSettingsOpen).toHaveBeenCalledWith(true));
    expect(result.current.closeErrorCode).toBe('window.close_listener_failed');
  });

  it('does not report normal browser unavailability as a close error', async () => {
    const setSettingsOpen = vi.fn();
    const controls = createControls(vi.fn().mockResolvedValue(null));
    const { result } = renderHook(() =>
      useAppWindowControls(
        vi.fn().mockResolvedValue(undefined),
        setSettingsOpen,
        controls,
      ),
    );

    await waitFor(() => expect(controls.onCloseRequested).toHaveBeenCalled());
    expect(setSettingsOpen).not.toHaveBeenCalled();
    expect(result.current.closeErrorCode).toBeNull();
  });

  it('propagates a destroy failure code through the title-bar close path', async () => {
    const setSettingsOpen = vi.fn();
    const controls = {
      destroy: vi.fn().mockResolvedValue(false),
      onCloseRequested: vi.fn().mockResolvedValue(null),
    };
    const { result } = renderHook(() =>
      useAppWindowControls(
        vi.fn().mockResolvedValue(undefined),
        setSettingsOpen,
        controls,
      ),
    );

    act(() => {
      result.current.onControl('close');
    });

    await waitFor(() => expect(setSettingsOpen).toHaveBeenCalledWith(true));
    expect(result.current.closeErrorCode).toBe('window.destroy_failed');
  });
});
