import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  useDefaultLayout,
  usePanelRef,
} from 'react-resizable-panels';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { panelLayoutStorage } from './panelLayoutStorage';
import { StatusBar } from './StatusBar';
import type { ShellSlots, StatusBarLabels } from './shellTypes';

const DEFAULT_LAYOUT = {
  editor: 74,
  sidebar: 26,
};

type AppShellViewProps = {
  dirty: boolean;
  focusMode: boolean;
  focusModeExitLabel: string;
  onExitFocusMode: () => void;
  currentFileName?: string;
  onSidebarCollapsedFocus: () => void;
  onSidebarOpenChange: (open: boolean) => void;
  sidebarOpen: boolean;
  slots: ShellSlots;
  statusLabels: StatusBarLabels;
  workspaceName?: string;
};

export function AppShellView({
  currentFileName,
  dirty,
  focusMode,
  focusModeExitLabel,
  onExitFocusMode,
  onSidebarCollapsedFocus,
  onSidebarOpenChange,
  sidebarOpen,
  slots,
  statusLabels,
  workspaceName,
}: AppShellViewProps) {
  const layout = useDefaultLayout({
    id: 'lumamark-v1-main-panels',
    panelIds: ['sidebar', 'editor'],
    storage: panelLayoutStorage,
  });
  const sidebarPanelRef = usePanelRef();
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const sidebarHadFocusRef = useRef(false);
  const restoredSidebarOpen =
    (layout.defaultLayout?.sidebar ?? DEFAULT_LAYOUT.sidebar) > 0;
  const sidebarHydratedRef = useRef(false);
  const onSidebarResize = useCallback(
    (size: { asPercentage: number }) => {
      const nextSidebarOpen = size.asPercentage > 0;

      if (sidebarHydratedRef.current && nextSidebarOpen !== sidebarOpen) {
        onSidebarOpenChange(nextSidebarOpen);
      }
    },
    [onSidebarOpenChange, sidebarOpen],
  );

  useLayoutEffect(() => {
    if (sidebarHydratedRef.current) {
      return;
    }

    if (sidebarOpen !== restoredSidebarOpen) {
      onSidebarOpenChange(restoredSidebarOpen);
      return;
    }

    sidebarHydratedRef.current = true;
  }, [onSidebarOpenChange, restoredSidebarOpen, sidebarOpen]);

  useLayoutEffect(() => {
    if (!sidebarHydratedRef.current) {
      return;
    }

    const sidebarPanel = sidebarPanelRef.current;

    if (!sidebarPanel) {
      return;
    }

    if (sidebarOpen) {
      sidebarPanel.expand();
    } else {
      if (
        sidebarHadFocusRef.current ||
        sidebarContentRef.current?.contains(globalThis.document.activeElement)
      ) {
        sidebarHadFocusRef.current = false;
        onSidebarCollapsedFocus();
      }

      sidebarPanel.collapse();
    }
  }, [onSidebarCollapsedFocus, sidebarOpen, sidebarPanelRef]);

  return (
    <div
      className={focusMode ? 'lm-app-shell lm-focus-mode' : 'lm-app-shell'}
      data-testid="app-shell"
    >
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
          onResize={onSidebarResize}
          panelRef={sidebarPanelRef}
        >
          <div
            aria-hidden={!sidebarOpen}
            className="lm-sidebar-content"
            data-testid="sidebar-content"
            inert={!sidebarOpen}
            onFocusCapture={() => {
              sidebarHadFocusRef.current = true;
            }}
            ref={sidebarContentRef}
          >
            {slots.sidebar}
          </div>
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

      {focusMode ? (
        <button
          aria-label={focusModeExitLabel}
          className="lm-focus-mode-exit"
          onClick={onExitFocusMode}
          title={focusModeExitLabel}
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      ) : null}

      {slots.dialogs}
    </div>
  );
}
