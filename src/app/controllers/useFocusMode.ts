import { useCallback, useRef, useState } from 'react';

type UseFocusModeOptions = {
  focusEditor: () => void;
  setSidebarOpen: (open: boolean) => void;
  sidebarOpen: boolean;
};

export function useFocusMode({
  focusEditor,
  setSidebarOpen,
  sidebarOpen,
}: UseFocusModeOptions) {
  const [focusMode, setFocusMode] = useState(false);
  const sidebarOpenBeforeFocusRef = useRef(true);

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
