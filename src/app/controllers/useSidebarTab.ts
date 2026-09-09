import { useCallback, useState } from 'react';
import type { SidebarTab } from '../shell/panelConstraints';

/** Keep manual selection within a session, and reset when its workspace changes. */
export function useSidebarTab(workspacePath: string | null) {
  const defaultTab: SidebarTab = workspacePath === null ? 'outline' : 'files';
  const [selection, setSelection] = useState({ workspacePath, tab: defaultTab });
  if (selection.workspacePath !== workspacePath) {
    setSelection({ workspacePath, tab: defaultTab });
  }
  const tab = selection.workspacePath === workspacePath ? selection.tab : defaultTab;
  const setTab = useCallback((nextTab: SidebarTab) => {
    setSelection({ workspacePath, tab: nextTab });
  }, [workspacePath]);
  return [tab, setTab] as const;
}
