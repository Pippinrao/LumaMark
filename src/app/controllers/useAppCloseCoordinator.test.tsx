import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WindowCloseRequestedEvent } from '../../services/window/windowControls';
import { useAppCloseCoordinator } from './useAppCloseCoordinator';

describe('useAppCloseCoordinator', () => {
  it('subscribes native close requests and removes the listener on unmount', async () => {
    let listener:
      | ((event: WindowCloseRequestedEvent) => void | Promise<void>)
      | undefined;
    const unlisten = vi.fn();
    const controls = {
      destroy: vi.fn().mockResolvedValue(true),
      onCloseRequested: vi.fn(async (nextListener) => {
        listener = nextListener;
        return unlisten;
      }),
    };
    const flushSettings = vi.fn().mockResolvedValue(undefined);
    const markAcceptanceCloseEntered = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useAppCloseCoordinator({
        controls,
        flushSettings,
        markAcceptanceCloseEntered,
        onCloseBlocked: vi.fn(),
      }),
    );

    await waitFor(() => expect(listener).toBeTypeOf('function'));
    const preventDefault = vi.fn();
    await act(async () => {
      await listener?.({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(flushSettings).toHaveBeenCalledTimes(1);
    expect(markAcceptanceCloseEntered).toHaveBeenCalledTimes(1);
    expect(controls.destroy).toHaveBeenCalledTimes(1);
    expect(result.current.requestClose).toBeTypeOf('function');

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('reports close-listener registration failures without treating browser unavailability as an error', async () => {
    const registrationError = Object.assign(new Error('listen failed'), {
      code: 'window.close_listener_failed',
    });
    const onCloseBlocked = vi.fn();
    const failingControls = {
      destroy: vi.fn().mockResolvedValue(true),
      onCloseRequested: vi.fn().mockRejectedValue(registrationError),
    };

    renderHook(() =>
      useAppCloseCoordinator({
        controls: failingControls,
        flushSettings: vi.fn().mockResolvedValue(undefined),
        onCloseBlocked,
      }),
    );

    await waitFor(() => {
      expect(onCloseBlocked).toHaveBeenCalledWith(registrationError);
    });

    onCloseBlocked.mockClear();
    renderHook(() =>
      useAppCloseCoordinator({
        controls: {
          destroy: vi.fn().mockResolvedValue(false),
          onCloseRequested: vi.fn().mockResolvedValue(null),
        },
        flushSettings: vi.fn().mockResolvedValue(undefined),
        onCloseBlocked,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCloseBlocked).not.toHaveBeenCalled();
  });
});
