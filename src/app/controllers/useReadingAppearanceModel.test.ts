import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReadingAppearanceStore } from '../../features/reading-appearance/readingAppearanceStore';
import { useSettingsStore } from '../../features/settings/settingsStore';
import { createDefaultLumaMarkSettings } from '../../services/settings/settingsTypes';
import { useReadingAppearanceModel } from './useReadingAppearanceModel';

afterEach(() => {
  useReadingAppearanceStore.setState({ fontZoomPercent: 100 });
  useSettingsStore.setState({
    settings: createDefaultLumaMarkSettings(),
    writeState: { status: 'idle' },
  });
});

describe('useReadingAppearanceModel', () => {
  it('flushes reset zoom so a reload cannot restore the previous scale', async () => {
    const flushPendingWrites = vi.fn(async () => undefined);
    useSettingsStore.setState({ flushPendingWrites });
    useReadingAppearanceStore.setState({ fontZoomPercent: 250 });

    const { result } = renderHook(() => useReadingAppearanceModel(() => undefined));

    await act(async () => {
      result.current.resetZoom();
    });

    expect(useReadingAppearanceStore.getState().fontZoomPercent).toBe(100);
    expect(useSettingsStore.getState().settings.appearance.fontZoomPercent).toBe(
      100,
    );
    expect(flushPendingWrites).toHaveBeenCalledTimes(1);
  });
});
