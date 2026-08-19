import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppShellSlots } from '../containers/useAppShellSlots';
import { useAppShellModel } from '../controllers/useAppShellModel';
import { ensureMenuDebugDomCapture } from '../../shared/debug/menuInteractionLog';
import { AppShellView } from './AppShellView';
import { FILE_TREE_CONTENT_CHROME_WIDTH } from './panelConstraints';

export function AppShell() {
  const model = useAppShellModel();
  const [sidebarContentWidth, setSidebarContentWidth] = useState(0);
  const [sidebarContentChromeWidth, setSidebarContentChromeWidth] = useState(
    FILE_TREE_CONTENT_CHROME_WIDTH,
  );
  const [readOnlyFlashing, setReadOnlyFlashing] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReadOnlyEditAttempt = useCallback(() => {
    setReadOnlyFlashing(true);
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = setTimeout(() => {
      setReadOnlyFlashing(false);
      flashTimerRef.current = null;
    }, 900);
  }, []);
  const onSidebarContentWidthChange = useCallback(
    (contentWidth: number, chromeWidth = FILE_TREE_CONTENT_CHROME_WIDTH) => {
      setSidebarContentWidth(contentWidth);
      setSidebarContentChromeWidth(chromeWidth);
    },
    [],
  );
  const slotHandlers = useMemo(
    () => ({
      onReadOnlyEditAttempt,
      onSidebarContentWidthChange,
    }),
    [onReadOnlyEditAttempt, onSidebarContentWidthChange],
  );
  const slots = useAppShellSlots(model, slotHandlers);

  useEffect(() => {
    ensureMenuDebugDomCapture();
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  return (
    <AppShellView
      currentFileName={model.currentFile?.name}
      dirty={model.dirty}
      focusMode={model.focusMode}
      focusModeExitLabel={model.labels.focusMode.exit}
      onExitFocusMode={model.toggleFocusMode}
      onSidebarCollapsedFocus={model.editor.focusEditor}
      onSidebarOpenChange={model.setSidebarOpen}
      readingMode={model.editor.editorDisplayMode === 'reading'}
      readOnlyFlashing={readOnlyFlashing}
      sidebarContentChromeWidth={sidebarContentChromeWidth}
      sidebarContentWidth={sidebarContentWidth}
      sidebarOpen={model.sidebarOpen}
      slots={slots}
      statusLabels={model.labels.status}
      workspaceName={model.workspace.root?.name}
    />
  );
}
