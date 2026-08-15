import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWindowControlsModel } from './useWindowControlsModel';

const windowMocks = vi.hoisted(() => ({
  close: vi.fn().mockResolvedValue(true),
  isMaximized: vi.fn().mockResolvedValue(false),
  minimize: vi.fn().mockResolvedValue(true),
  onResized: vi.fn().mockResolvedValue(vi.fn()),
  toggleMaximize: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/window/windowControls', () => ({
  windowControls: windowMocks,
}));

describe('useWindowControlsModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes the title-bar close control through the app close coordinator', () => {
    const requestClose = vi.fn().mockResolvedValue('closed');
    const { result } = renderHook(() =>
      useWindowControlsModel({ requestClose }),
    );

    act(() => {
      result.current.onControl('close');
    });

    expect(requestClose).toHaveBeenCalledTimes(1);
    expect(windowMocks.close).not.toHaveBeenCalled();
  });
});
