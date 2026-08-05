import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorMediaPreviewRequest } from '../../editor/core/editorEvents';

export function useMediaViewer(fallbackFocus: () => void) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<EditorMediaPreviewRequest | null>(null);
  const [sessionId, setSessionId] = useState(0);
  const focusGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingFocusFrameRef = useRef<number | null>(null);

  const cancelPendingFocusRestore = useCallback(() => {
    focusGenerationRef.current += 1;
    if (pendingFocusFrameRef.current !== null) {
      cancelAnimationFrame(pendingFocusFrameRef.current);
      pendingFocusFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelPendingFocusRestore();
      openerRef.current = null;
    };
  }, [cancelPendingFocusRestore]);

  const openMedia = useCallback(
    (nextRequest: EditorMediaPreviewRequest) => {
      cancelPendingFocusRestore();
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setRequest(nextRequest);
      setSessionId((current) => current + 1);
      setOpen(true);
    },
    [cancelPendingFocusRestore],
  );

  const returnFocus = useCallback(() => {
    cancelPendingFocusRestore();
    const focusGeneration = focusGenerationRef.current;
    const opener = openerRef.current;

    const isCurrentRestore = () =>
      mountedRef.current && focusGenerationRef.current === focusGeneration;
    const releaseClosedMedia = () => {
      if (!isCurrentRestore()) {
        return;
      }
      openerRef.current = null;
      setRequest(null);
    };
    const focusFallback = () => {
      if (!isCurrentRestore()) {
        return;
      }
      fallbackFocus();
      releaseClosedMedia();
    };
    const scheduleFocusRestore = (restore: () => void) => {
      pendingFocusFrameRef.current = requestAnimationFrame(() => {
        pendingFocusFrameRef.current = null;
        if (isCurrentRestore()) {
          restore();
        }
      });
    };

    if (opener?.isConnected) {
      opener.focus({ preventScroll: true });
      if (document.activeElement === opener) {
        releaseClosedMedia();
        return;
      }

      const focusScope = opener.closest<HTMLElement>('[tabindex]');
      if (focusScope && focusScope !== opener) {
        focusScope.focus({ preventScroll: true });
        scheduleFocusRestore(() => {
          if (!opener.isConnected) {
            focusFallback();
            return;
          }

          opener.focus({ preventScroll: true });
          if (document.activeElement === opener) {
            releaseClosedMedia();
            return;
          }

          focusScope.focus({ preventScroll: true });
          scheduleFocusRestore(() => {
            if (!opener.isConnected) {
              focusFallback();
              return;
            }

            opener.focus({ preventScroll: true });
            if (document.activeElement !== opener) {
              focusFallback();
              return;
            }
            releaseClosedMedia();
          });
        });
        return;
      }
    }
    focusFallback();
  }, [cancelPendingFocusRestore, fallbackFocus]);

  return {
    open,
    openMedia,
    request,
    returnFocus,
    sessionId,
    setOpen,
  };
}
