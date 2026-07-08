import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  useDefaultLayout,
} from 'react-resizable-panels';
import { panelLayoutStorage } from './panelLayoutStorage';
import { StatusBar } from './StatusBar';
import type { ShellSlots, StatusBarLabels } from './shellTypes';

const DEFAULT_LAYOUT = {
  editor: 74,
  sidebar: 26,
};

type AppShellViewProps = {
  dirty: boolean;
  currentFileName?: string;
  slots: ShellSlots;
  statusLabels: StatusBarLabels;
  workspaceName?: string;
};

export function AppShellView({
  currentFileName,
  dirty,
  slots,
  statusLabels,
  workspaceName,
}: AppShellViewProps) {
  const layout = useDefaultLayout({
    id: 'lumamark-v1-main-panels',
    onlySaveAfterUserInteractions: true,
    panelIds: ['sidebar', 'editor'],
    storage: panelLayoutStorage,
  });

  return (
    <div className="lm-app-shell" data-testid="app-shell">
      {slots.topChrome}

      <PanelGroup
        className="lm-workspace-shell"
        defaultLayout={layout.defaultLayout ?? DEFAULT_LAYOUT}
        id="lumamark-v1-main-panels"
        onLayoutChanged={layout.onLayoutChanged}
        orientation="horizontal"
      >
        <Panel
          className="lm-sidebar-panel"
          collapsible
          collapsedSize="0%"
          defaultSize="22%"
          id="sidebar"
          minSize="220px"
        >
          {slots.sidebar}
        </Panel>
        <PanelResizeHandle className="lm-resize-handle" />
        <Panel
          className="lm-editor-panel"
          defaultSize="74%"
          id="editor"
          minSize="360px"
        >
          {slots.editor}
        </Panel>
      </PanelGroup>

      <StatusBar
        currentFileName={currentFileName}
        dirty={dirty}
        labels={statusLabels}
        workspaceName={workspaceName}
      />

      {slots.dialogs}
    </div>
  );
}
