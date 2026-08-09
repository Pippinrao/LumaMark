import { useEffect } from 'react';
import { useAppShellSlots } from '../containers/useAppShellSlots';
import { useAppShellModel } from '../controllers/useAppShellModel';
import { ensureMenuDebugDomCapture } from '../../shared/debug/menuInteractionLog';
import { AppShellView } from './AppShellView';

export function AppShell() {
  const model = useAppShellModel();
  const slots = useAppShellSlots(model);

  useEffect(() => {
    ensureMenuDebugDomCapture();
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
      sidebarOpen={model.sidebarOpen}
      slots={slots}
      statusLabels={model.labels.status}
      workspaceName={model.workspace.root?.name}
    />
  );
}
