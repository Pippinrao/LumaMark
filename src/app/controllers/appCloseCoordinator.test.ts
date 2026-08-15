import { describe, expect, it, vi } from 'vitest';

import { createAppCloseCoordinator } from './appCloseCoordinator';

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve: () => resolve?.() };
}

describe('appCloseCoordinator', () => {
  it('prevents native close synchronously and destroys only after settings flush', async () => {
    const pending = deferred();
    const destroy = vi.fn().mockResolvedValue(true);
    const preventDefault = vi.fn();
    const order: string[] = [];
    const markAcceptanceCloseEntered = vi.fn(async () => {
      order.push('close-entered');
    });
    const coordinator = createAppCloseCoordinator({
      destroy,
      flushSettings: () => {
        order.push('flush-started');
        return pending.promise;
      },
      markAcceptanceCloseEntered,
      onCloseBlocked: vi.fn(),
    });

    const closing = coordinator.handleCloseRequested({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(markAcceptanceCloseEntered).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['flush-started', 'close-entered']);
    expect(destroy).not.toHaveBeenCalled();
    pending.resolve();
    await expect(closing).resolves.toBe('closed');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the window open when the acceptance close-entered signal fails closed', async () => {
    const signalError = Object.assign(new Error('close signal unavailable'), {
      code: 'settings.acceptance_write_barrier_failed',
    });
    const destroy = vi.fn().mockResolvedValue(true);
    const onCloseBlocked = vi.fn();
    const coordinator = createAppCloseCoordinator({
      destroy,
      flushSettings: vi.fn().mockResolvedValue(undefined),
      markAcceptanceCloseEntered: vi.fn().mockRejectedValue(signalError),
      onCloseBlocked,
    });

    await expect(coordinator.requestClose()).resolves.toBe('blocked');
    expect(destroy).not.toHaveBeenCalled();
    expect(onCloseBlocked).toHaveBeenCalledWith(signalError);
  });

  it('deduplicates concurrent title-bar and native close requests', async () => {
    const pending = deferred();
    const flushSettings = vi.fn(() => pending.promise);
    const destroy = vi.fn().mockResolvedValue(true);
    const coordinator = createAppCloseCoordinator({
      destroy,
      flushSettings,
      onCloseBlocked: vi.fn(),
    });

    const titleBarClose = coordinator.requestClose();
    const nativeClose = coordinator.handleCloseRequested({
      preventDefault: vi.fn(),
    });
    pending.resolve();
    await Promise.all([titleBarClose, nativeClose]);

    expect(flushSettings).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the window open after failure and retries the same flush on next close', async () => {
    const error = Object.assign(new Error('disk full'), {
      code: 'settings.write_failed',
    });
    const flushSettings = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);
    const destroy = vi.fn().mockResolvedValue(true);
    const onCloseBlocked = vi.fn();
    const coordinator = createAppCloseCoordinator({
      destroy,
      flushSettings,
      onCloseBlocked,
    });

    await expect(coordinator.requestClose()).resolves.toBe('blocked');
    expect(destroy).not.toHaveBeenCalled();
    expect(onCloseBlocked).toHaveBeenCalledWith(error);

    await expect(coordinator.requestClose()).resolves.toBe('closed');
    expect(flushSettings).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('reports destroy exceptions with a stable window-specific code', async () => {
    const onCloseBlocked = vi.fn();
    const coordinator = createAppCloseCoordinator({
      destroy: vi.fn().mockRejectedValue(new Error('native destroy failed')),
      flushSettings: vi.fn().mockResolvedValue(undefined),
      onCloseBlocked,
    });

    await expect(coordinator.requestClose()).resolves.toBe('blocked');
    expect(onCloseBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'window.destroy_failed' }),
    );
  });
});
