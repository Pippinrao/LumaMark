import { EditorState } from '@codemirror/state';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDocumentStatistics,
  type DocumentStatisticsModel,
} from './useDocumentStatistics';

function StatisticsHarness({
  getEditorState,
  onModel,
}: {
  getEditorState: () => EditorState | null;
  onModel: (model: DocumentStatisticsModel) => void;
}) {
  onModel(useDocumentStatistics({ getEditorState }));

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
    const getEditorState = vi.fn(() => EditorState.create({ doc: text }));
    const modelRef: { current: DocumentStatisticsModel | null } = {
      current: null,
    };

    render(
      <StatisticsHarness
        getEditorState={getEditorState}
        onModel={(nextModel) => {
          modelRef.current = nextModel;
        }}
      />,
    );

    text = '中文 text';
    modelRef.current?.scheduleRefresh();

    act(() => {
      vi.advanceTimersByTime(200);
      vi.runOnlyPendingTimers();
    });

    expect(modelRef.current?.statistics).toEqual({
      characters: 6,
      lines: 1,
      words: 3,
    });
    expect(getEditorState).toHaveBeenCalledTimes(1);
  });
});
