import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDocumentStatistics,
  type DocumentStatistics,
} from '../../editor/metrics/documentStatistics';

const STATISTICS_REFRESH_DELAY_MS = 200;

export type DocumentStatisticsModel = {
  scheduleRefresh: () => void;
  statistics: DocumentStatistics;
};

type UseDocumentStatisticsOptions = {
  getDocumentText: () => string;
};

export function useDocumentStatistics({
  getDocumentText,
}: UseDocumentStatisticsOptions): DocumentStatisticsModel {
  const [statistics, setStatistics] = useState<DocumentStatistics>({
    characters: 0,
    lines: 0,
    words: 0,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setStatistics(getDocumentStatistics(getDocumentText()));
    }, STATISTICS_REFRESH_DELAY_MS);
  }, [getDocumentText]);

  useEffect(() => {
    scheduleRefresh();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [scheduleRefresh]);

  return { scheduleRefresh, statistics };
}
