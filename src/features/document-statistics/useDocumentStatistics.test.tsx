import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDocumentStatistics,
  type DocumentStatisticsModel,
} from './useDocumentStatistics';

function StatisticsHarness({
  getDocumentText,
  onModel,
}: {
  getDocumentText: () => string;
  onModel: (model: DocumentStatisticsModel) => void;
}) {
  onModel(useDocumentStatistics({ getDocumentText }));

  return null;
}

describe('useDocumentStatistics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces editor reads and exposes the latest document statistics', () => {
    let text = 'First';
    const getDocumentText = vi.fn(() => text);
    const modelRef: { current: DocumentStatisticsModel | null } = {
      current: null,
    };

    render(
      <StatisticsHarness
        getDocumentText={getDocumentText}
        onModel={(nextModel) => {
          modelRef.current = nextModel;
        }}
      />,
    );

    text = '中文 text';
    modelRef.current?.scheduleRefresh();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(modelRef.current?.statistics).toEqual({
      characters: 6,
      lines: 1,
      words: 3,
    });
    expect(getDocumentText).toHaveBeenCalledTimes(1);
  });
});
