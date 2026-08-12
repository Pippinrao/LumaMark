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
    const windowHandle = {
      close: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(true),
      minimize: vi.fn().mockResolvedValue(undefined),
      onResized: vi.fn().mockResolvedValue(unlisten),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
    };
    const controls = createWindowControls(async () => windowHandle);

    await expect(controls.minimize()).resolves.toBe(true);
    await expect(controls.toggleMaximize()).resolves.toBe(true);
    await expect(controls.close()).resolves.toBe(true);
    await expect(controls.isMaximized()).resolves.toBe(true);
    await expect(controls.onResized(resizeListener)).resolves.toBe(unlisten);

    expect(windowHandle.minimize).toHaveBeenCalledTimes(1);
    expect(windowHandle.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(windowHandle.close).toHaveBeenCalledTimes(1);
    expect(windowHandle.isMaximized).toHaveBeenCalledTimes(1);
    expect(windowHandle.onResized).toHaveBeenCalledOnce();
    expect(windowHandle.onResized).toHaveBeenCalledWith(resizeListener);
  });

  it('safely no-ops when no Tauri window is available', async () => {
    const controls = createWindowControls(async () => null);

    await expect(controls.minimize()).resolves.toBe(false);
    await expect(controls.toggleMaximize()).resolves.toBe(false);
    await expect(controls.close()).resolves.toBe(false);
    await expect(controls.isMaximized()).resolves.toBeNull();
    await expect(controls.onResized(vi.fn())).resolves.toBeNull();
  });

  it('does not expose a second manual owner for native titlebar dragging', () => {
    const controls = createWindowControls(async () => null);

    expect(controls).not.toHaveProperty('startDragging');
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
      isMaximized: vi.fn().mockResolvedValue(false),
      minimize: vi.fn().mockResolvedValue(undefined),
      onResized: vi.fn().mockRejectedValue(new Error('resize unavailable')),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
    }));

    await expect(controls.onResized(vi.fn())).resolves.toBeNull();
  });
});
