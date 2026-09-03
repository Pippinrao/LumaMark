import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '../../features/settings/settingsStore';
import { createDefaultLumaMarkSettings } from '../../services/settings/settingsTypes';
import { useUpdateModel } from './useUpdateModel';

const updaterMocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn().mockResolvedValue({ kind: 'upToDate' }),
}));

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  isTauri: () => true,
}));

vi.mock('../../services/updater/updaterService', () => ({
  checkForUpdate: updaterMocks.checkForUpdate,
}));

describe('useUpdateModel settings integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updaterMocks.checkForUpdate.mockClear();
    const settings = createDefaultLumaMarkSettings();
    settings.updates.autoCheckOnStartup = false;
    useSettingsStore.setState({
      loadState: { status: 'ready' },
      settings,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('reads and writes auto-check through the unified settings store', () => {
    const { result } = renderHook(() => useUpdateModel());

    expect(result.current.autoCheckOnStartup).toBe(false);

    act(() => {
      result.current.setAutoCheckOnStartup(true);
    });

    expect(result.current.autoCheckOnStartup).toBe(true);
    expect(
      useSettingsStore.getState().settings.updates.autoCheckOnStartup,
    ).toBe(true);
  });

  it('does not auto-check until settings hydration settles', async () => {
    const settings = createDefaultLumaMarkSettings();
    settings.updates.autoCheckOnStartup = true;
    useSettingsStore.setState({
      loadState: { status: 'hydrating' },
      settings,
    });

    renderHook(() => useUpdateModel());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(updaterMocks.checkForUpdate).not.toHaveBeenCalled();

    act(() => {
      useSettingsStore.setState({ loadState: { status: 'ready' } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(updaterMocks.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it('auto-checks after unsupported settings versions fall back to defaults', async () => {
    const settings = createDefaultLumaMarkSettings();
    settings.updates.autoCheckOnStartup = true;
    useSettingsStore.setState({
      loadState: {
        code: 'settings.unsupported_version',
        status: 'unsupportedVersion',
      },
      settings,
    });

    renderHook(() => useUpdateModel());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(updaterMocks.checkForUpdate).toHaveBeenCalledTimes(1);
  });
});
