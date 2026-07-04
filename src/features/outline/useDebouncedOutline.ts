import { useCallback, useEffect, useRef, useState } from 'react';
import { parseMarkdownOutline, type OutlineHeading } from './outlineParser';

type UseDebouncedOutlineOptions = {
  delayMs?: number;
  getDocumentText: () => string;
};

const DEFAULT_OUTLINE_UPDATE_DELAY_MS = 120;

export function useDebouncedOutline({
  delayMs = DEFAULT_OUTLINE_UPDATE_DELAY_MS,
  getDocumentText,
}: UseDebouncedOutlineOptions) {
  const getDocumentTextRef = useRef(getDocumentText);
  const timeoutRef = useRef<number | null>(null);
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);

  useEffect(() => {
    getDocumentTextRef.current = getDocumentText;
  }, [getDocumentText]);

  const scheduleRefresh = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setHeadings(parseMarkdownOutline(getDocumentTextRef.current()));
    }, delayMs);
  }, [delayMs]);

  useEffect(() => {
    scheduleRefresh();

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [scheduleRefresh]);

  return {
    headings,
    scheduleRefresh,
  };
}
