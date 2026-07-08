import type { ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { SidebarLabels } from './shellTypes';

type WorkspaceSidebarProps = {
  fileTree: ReactNode;
  labels: SidebarLabels;
  outline: ReactNode;
};

export function WorkspaceSidebar({
  fileTree,
  labels,
  outline,
}: WorkspaceSidebarProps) {
  return (
    <aside className="lm-sidebar" aria-label={labels.sidebar}>
      <Tabs.Root className="lm-sidebar-tabs" defaultValue="files">
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
          {fileTree}
        </Tabs.Content>
        <Tabs.Content className="lm-sidebar-tab-panel" value="outline">
          {outline}
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}
