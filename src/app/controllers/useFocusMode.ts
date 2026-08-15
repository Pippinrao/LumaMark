import { useCallback, useEffect, useRef, useState } from 'react';

type UseFocusModeOptions = {
  focusEditor: () => void;
  initialFocusMode?: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarOpen: boolean;
};

export function useFocusMode({
  focusEditor,
  initialFocusMode = false,
  setSidebarOpen,
  sidebarOpen,
}: UseFocusModeOptions) {
  const initialFocusModeRef = useRef(initialFocusMode);
  const startupAppliedRef = useRef(false);
  const [focusMode, setFocusMode] = useState(initialFocusMode);
  const sidebarOpenBeforeFocusRef = useRef(sidebarOpen);

  useEffect(() => {
    if (startupAppliedRef.current) {
      return;
    }

    startupAppliedRef.current = true;
    if (initialFocusModeRef.current) {
      setSidebarOpen(false);
    }
  }, [setSidebarOpen]);

  const exitFocusMode = useCallback(() => {
    if (!focusMode) {
      return;
    }

    setFocusMode(false);
    setSidebarOpen(sidebarOpenBeforeFocusRef.current);
    focusEditor();
  }, [focusEditor, focusMode, setSidebarOpen]);

  const toggleFocusMode = useCallback(() => {
    if (focusMode) {
      exitFocusMode();
      return;
    }

    sidebarOpenBeforeFocusRef.current = sidebarOpen;
    setSidebarOpen(false);
    setFocusMode(true);
    focusEditor();
  }, [exitFocusMode, focusEditor, focusMode, setSidebarOpen, sidebarOpen]);

  return { exitFocusMode, focusMode, toggleFocusMode };
}
