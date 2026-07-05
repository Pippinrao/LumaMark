import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { createWindowControls } from './windowControls';

describe('windowControls', () => {
  afterEach(() => {
    clearMocks();
  });

  it('calls the current Tauri window for each native window action', async () => {
    const windowHandle = {
      close: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(true),
      minimize: vi.fn().mockResolvedValue(undefined),
      startDragging: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
    };
    const controls = createWindowControls(async () => windowHandle);

    await expect(controls.minimize()).resolves.toBe(true);
    await expect(controls.toggleMaximize()).resolves.toBe(true);
    await expect(controls.close()).resolves.toBe(true);
    await expect(controls.startDragging()).resolves.toBe(true);
    await expect(controls.isMaximized()).resolves.toBe(true);

    expect(windowHandle.minimize).toHaveBeenCalledTimes(1);
    expect(windowHandle.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(windowHandle.close).toHaveBeenCalledTimes(1);
    expect(windowHandle.startDragging).toHaveBeenCalledTimes(1);
    expect(windowHandle.isMaximized).toHaveBeenCalledTimes(1);
  });

  it('safely no-ops when no Tauri window is available', async () => {
    const controls = createWindowControls(async () => null);

    await expect(controls.minimize()).resolves.toBe(false);
    await expect(controls.toggleMaximize()).resolves.toBe(false);
    await expect(controls.close()).resolves.toBe(false);
    await expect(controls.startDragging()).resolves.toBe(false);
    await expect(controls.isMaximized()).resolves.toBeNull();
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
    await expect(controls.startDragging()).resolves.toBe(true);
    await expect(controls.isMaximized()).resolves.toBe(false);

    expect(calls).toEqual([
      'plugin:window|minimize',
      'plugin:window|toggle_maximize',
      'plugin:window|close',
      'plugin:window|start_dragging',
      'plugin:window|is_maximized',
    ]);
  });
});
