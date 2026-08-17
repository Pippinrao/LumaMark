import type { EditorState } from '@codemirror/state';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  scheduleDocumentStatisticsFromText,
  type DocumentStatistics,
} from '../../editor/metrics/documentStatistics';

const STATISTICS_REFRESH_DELAY_MS = 200;
const emptyStatistics: DocumentStatistics = {
  characters: 0,
  lines: 0,
  words: 0,
};

export type DocumentStatisticsModel = {
  scheduleRefresh: () => void;
  statistics: DocumentStatistics;
};

type UseDocumentStatisticsOptions = {
  getEditorState: () => EditorState | null;
};

export function useDocumentStatistics({
  getEditorState,
}: UseDocumentStatisticsOptions): DocumentStatisticsModel {
  const getEditorStateRef = useRef(getEditorState);
  const cancelScheduledRef = useRef<(() => void) | null>(null);
  const [statistics, setStatistics] =
    useState<DocumentStatistics>(emptyStatistics);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getEditorStateRef.current = getEditorState;
  }, [getEditorState]);

  const scheduleRefresh = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      cancelScheduledRef.current?.();
      const editorState = getEditorStateRef.current();
      if (!editorState) {
        cancelScheduledRef.current = null;
        setStatistics(emptyStatistics);
        return;
      }

      cancelScheduledRef.current = scheduleDocumentStatisticsFromText(
        editorState.doc,
        (nextStatistics) => {
          cancelScheduledRef.current = null;
          setStatistics(nextStatistics);
        },
      ).cancel;
    }, STATISTICS_REFRESH_DELAY_MS);
  }, []);

  useEffect(() => {
    scheduleRefresh();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      cancelScheduledRef.current?.();
    };
  }, [scheduleRefresh]);

  return { scheduleRefresh, statistics };
}
