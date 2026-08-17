import type { EditorState } from '@codemirror/state';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseMarkdownOutlineFromState,
  type OutlineHeading,
} from './outlineParser';

type UseDebouncedOutlineOptions = {
  delayMs?: number;
  getEditorState: () => EditorState | null;
};

export type OutlineSnapshotOutcome =
  | {
      headings: readonly OutlineHeading[];
      revision: number;
      status: 'current';
    }
  | {
      status: 'superseded';
    };

type OutlineSnapshotWaiter = {
  resolve: (outcome: OutlineSnapshotOutcome) => void;
  revision: number;
};

const DEFAULT_OUTLINE_UPDATE_DELAY_MS = 120;

export function useDebouncedOutline({
  delayMs = DEFAULT_OUTLINE_UPDATE_DELAY_MS,
  getEditorState,
}: UseDebouncedOutlineOptions) {
  const getEditorStateRef = useRef(getEditorState);
  const completedRevisionRef = useRef(0);
  const headingsRef = useRef<OutlineHeading[]>([]);
  const mountedRef = useRef(false);
  const requestedRevisionRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const waitersRef = useRef(new Set<OutlineSnapshotWaiter>());
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);

  useEffect(() => {
    getEditorStateRef.current = getEditorState;
  }, [getEditorState]);

  const supersedeWaiters = useCallback((beforeRevision?: number) => {
    for (const waiter of waitersRef.current) {
      if (
        beforeRevision === undefined ||
        waiter.revision < beforeRevision
      ) {
        waitersRef.current.delete(waiter);
        waiter.resolve({ status: 'superseded' });
      }
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    requestedRevisionRef.current += 1;
    const revision = requestedRevisionRef.current;
    supersedeWaiters(revision);

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      if (
        !mountedRef.current ||
        revision !== requestedRevisionRef.current
      ) {
        return;
      }

      const editorState = getEditorStateRef.current();
      const parsedHeadings = editorState
        ? parseMarkdownOutlineFromState(editorState)
        : [];
      headingsRef.current = parsedHeadings;
      completedRevisionRef.current = revision;
      setHeadings(parsedHeadings);

      for (const waiter of waitersRef.current) {
        if (waiter.revision === revision) {
          waitersRef.current.delete(waiter);
          waiter.resolve({
            headings: parsedHeadings,
            revision,
            status: 'current',
          });
        }
      }
    }, delayMs);
  }, [delayMs, supersedeWaiters]);

  const awaitCurrentSnapshot = useCallback((): Promise<OutlineSnapshotOutcome> => {
    const revision = requestedRevisionRef.current;

    if (!mountedRef.current) {
      return Promise.resolve({ status: 'superseded' });
    }

    if (completedRevisionRef.current === revision) {
      return Promise.resolve({
        headings: headingsRef.current,
        revision,
        status: 'current',
      });
    }

    return new Promise((resolve) => {
      waitersRef.current.add({ resolve, revision });
    });
  }, []);

  const isCurrent = useCallback(
    () =>
      mountedRef.current &&
      completedRevisionRef.current === requestedRevisionRef.current,
    [],
  );
  const isCurrentHeading = useCallback(
    (heading: OutlineHeading | undefined) =>
      heading !== undefined &&
      mountedRef.current &&
      completedRevisionRef.current === requestedRevisionRef.current &&
      headingsRef.current.includes(heading),
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    scheduleRefresh();

    return () => {
      mountedRef.current = false;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      supersedeWaiters();
    };
  }, [scheduleRefresh, supersedeWaiters]);

  return {
    awaitCurrentSnapshot,
    headings,
    isCurrent,
    isCurrentHeading,
    scheduleRefresh,
  };
}
