import { useCallback, useRef, useState } from 'react';
import type { EditorMediaPreviewRequest } from '../../editor/core/editorEvents';

export function useMediaViewer(fallbackFocus: () => void) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<EditorMediaPreviewRequest | null>(null);
  const [sessionId, setSessionId] = useState(0);
  const openerRef = useRef<HTMLElement | null>(null);

  const openMedia = useCallback((nextRequest: EditorMediaPreviewRequest) => {
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setRequest(nextRequest);
    setSessionId((current) => current + 1);
    setOpen(true);
  }, []);

  const returnFocus = useCallback(() => {
    const opener = openerRef.current;
    if (opener?.isConnected) {
      opener.focus();
      return;
    }
    fallbackFocus();
  }, [fallbackFocus]);

  return {
    open,
    openMedia,
    request,
    returnFocus,
    sessionId,
    setOpen,
  };
}
