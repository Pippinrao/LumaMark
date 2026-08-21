import { useState, type ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { SidebarTab } from './panelConstraints';
import type { SidebarLabels } from './shellTypes';

type WorkspaceSidebarProps = {
  fileTree: ReactNode;
  labels: SidebarLabels;
  onTabChange?: (tab: SidebarTab) => void;
  outline: ReactNode;
};

function isSidebarTab(value: string): value is SidebarTab {
  return value === 'files' || value === 'outline';
}

export function WorkspaceSidebar({
  fileTree,
  labels,
  onTabChange,
  outline,
}: WorkspaceSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>('files');

  return (
    <aside className="lm-sidebar" aria-label={labels.sidebar}>
      <Tabs.Root
        className="lm-sidebar-tabs"
        onValueChange={(nextTab) => {
          if (!isSidebarTab(nextTab)) {
            return;
          }

          setTab(nextTab);
          onTabChange?.(nextTab);
        }}
        value={tab}
      >
        <Tabs.List
          className="lm-sidebar-tabs-list"
          aria-label={labels.sidebar}
        >
          <Tabs.Trigger className="lm-sidebar-tab" value="files">
            {labels.files}
          </Tabs.Trigger>
          <Tabs.Trigger className="lm-sidebar-tab" value="outline">
            {labels.outline}
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content className="lm-sidebar-tab-panel" value="files">
          {tab === 'files' ? fileTree : null}
        </Tabs.Content>
        <Tabs.Content className="lm-sidebar-tab-panel" value="outline">
          {tab === 'outline' ? outline : null}
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}
