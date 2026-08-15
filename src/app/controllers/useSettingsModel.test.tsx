import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '../../features/settings/settingsStore';
import { useSettingsModel } from './useSettingsModel';

describe('useSettingsModel structured persistence state', () => {
  afterEach(() => {
    useSettingsStore.setState({
      loadState: { status: 'idle' },
      recoveryState: { kind: 'none' },
      writeState: { status: 'idle' },
    });
  });

  it('projects structured load, recovery, and write state with a retry action', async () => {
    const retryPendingWrites = vi.fn(async () => undefined);
    useSettingsStore.setState({
      loadState: {
        code: 'settings.unsupported_version',
        status: 'unsupportedVersion',
      },
      recoveryState: {
        backupPath: 'C:/LumaMark/settings.corrupt-1.json',
        kind: 'corruption',
      },
      retryPendingWrites,
      writeState: {
        code: 'settings.write_failed',
        status: 'failed',
      },
    });

    const { result } = renderHook(() => useSettingsModel());

    expect(result.current.settingsLoadState).toEqual({
      code: 'settings.unsupported_version',
      status: 'unsupportedVersion',
    });
    expect(result.current.settingsRecoveryState).toEqual({
      backupPath: 'C:/LumaMark/settings.corrupt-1.json',
      kind: 'corruption',
    });
    expect(result.current.settingsWriteState).toEqual({
      code: 'settings.write_failed',
      status: 'failed',
    });

    await act(async () => result.current.retrySettingsWrite());
    expect(retryPendingWrites).toHaveBeenCalledTimes(1);
  });
});
