import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppShellSlots } from '../containers/useAppShellSlots';
import { useAppShellModel } from '../controllers/useAppShellModel';
import { ensureMenuDebugDomCapture } from '../../shared/debug/menuInteractionLog';
import { AppShellView } from './AppShellView';

export function AppShell() {
  const model = useAppShellModel();
  const [sidebarContentWidth, setSidebarContentWidth] = useState(0);
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
  const slotHandlers = useMemo(
    () => ({
      onReadOnlyEditAttempt,
      onSidebarContentWidthChange: setSidebarContentWidth,
    }),
    [onReadOnlyEditAttempt],
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
      sidebarContentWidth={sidebarContentWidth}
      sidebarOpen={model.sidebarOpen}
      slots={slots}
      statusLabels={model.labels.status}
      workspaceName={model.workspace.root?.name}
    />
  );
}
