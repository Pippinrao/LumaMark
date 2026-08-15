import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { createWindowControls } from './windowControls';

describe('windowControls', () => {
  afterEach(() => {
    clearMocks();
  });

  it('calls the current Tauri window for each native window action', async () => {
    const unlisten = vi.fn();
    const resizeListener = vi.fn();
    let closeListener:
      | ((event: { preventDefault: () => void }) => void)
      | undefined;
    const windowHandle = {
      close: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(true),
      minimize: vi.fn().mockResolvedValue(undefined),
      onResized: vi.fn().mockResolvedValue(unlisten),
      onCloseRequested: vi.fn(async (listener) => {
        closeListener = listener;
        return unlisten;
      }),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
    };
    const controls = createWindowControls(async () => windowHandle);

    await expect(controls.minimize()).resolves.toBe(true);
    await expect(controls.toggleMaximize()).resolves.toBe(true);
    await expect(controls.close()).resolves.toBe(true);
    await expect(
      controls.onCloseRequested((event) => event.preventDefault()),
    ).resolves.toBe(unlisten);
    const preventDefault = vi.fn();
    closeListener?.({ preventDefault });
    await expect(controls.destroy()).resolves.toBe(true);
    await expect(controls.isMaximized()).resolves.toBe(true);
    await expect(controls.onResized(resizeListener)).resolves.toBe(unlisten);

    expect(windowHandle.minimize).toHaveBeenCalledTimes(1);
    expect(windowHandle.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(windowHandle.close).toHaveBeenCalledTimes(1);
    expect(windowHandle.destroy).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(windowHandle.isMaximized).toHaveBeenCalledTimes(1);
    expect(windowHandle.onResized).toHaveBeenCalledOnce();
    expect(windowHandle.onResized).toHaveBeenCalledWith(resizeListener);
  });

  it('safely no-ops when no Tauri window is available', async () => {
    const controls = createWindowControls(async () => null);

    await expect(controls.minimize()).resolves.toBe(false);
    await expect(controls.toggleMaximize()).resolves.toBe(false);
    await expect(controls.close()).resolves.toBe(false);
    await expect(controls.destroy()).resolves.toBe(false);
    await expect(controls.onCloseRequested(vi.fn())).resolves.toBeNull();
    await expect(controls.isMaximized()).resolves.toBeNull();
    await expect(controls.onResized(vi.fn())).resolves.toBeNull();
  });

  it('does not expose a second manual owner for native titlebar dragging', () => {
    const controls = createWindowControls(async () => null);

    expect(controls).not.toHaveProperty('startDragging');
  });

  it('rejects close-listener registration failures with a stable code', async () => {
    const controls = createWindowControls(async () => ({
      close: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(false),
      minimize: vi.fn().mockResolvedValue(undefined),
      onResized: vi.fn().mockResolvedValue(vi.fn()),
      onCloseRequested: vi
        .fn()
        .mockRejectedValue(new Error('native listener unavailable')),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
    }));

    await expect(controls.onCloseRequested(vi.fn())).rejects.toMatchObject({
      code: 'window.close_listener_failed',
    });
  });

  it('uses the current Tauri window IPC commands when Tauri internals are available', async () => {
    const calls: string[] = [];
    mockWindows('main');
    mockIPC((command) => {
      calls.push(command);
      if (command === 'plugin:window|is_maximized') {
        return false;
      }

      return null;
    });
    const controls = createWindowControls();

    await expect(controls.minimize()).resolves.toBe(true);
    await expect(controls.toggleMaximize()).resolves.toBe(true);
    await expect(controls.close()).resolves.toBe(true);
    await expect(controls.isMaximized()).resolves.toBe(false);

    expect(calls).toEqual([
      'plugin:window|minimize',
      'plugin:window|toggle_maximize',
      'plugin:window|close',
      'plugin:window|is_maximized',
    ]);
  });

  it('safely reports a failed native resize subscription', async () => {
    const controls = createWindowControls(async () => ({
      close: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(false),
      minimize: vi.fn().mockResolvedValue(undefined),
      onCloseRequested: vi.fn().mockResolvedValue(vi.fn()),
      onResized: vi.fn().mockRejectedValue(new Error('resize unavailable')),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
    }));

    await expect(controls.onResized(vi.fn())).resolves.toBeNull();
  });
});
