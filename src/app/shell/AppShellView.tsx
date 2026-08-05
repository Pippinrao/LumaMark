import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  useDefaultLayout,
  usePanelRef,
} from 'react-resizable-panels';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  panelLayoutStorage,
  persistSidebarOpen,
  readPersistedSidebarOpen,
} from './panelLayoutStorage';
import {
  sidebarPanelConstraints,
  sidebarWidthForMeasuredFileName,
} from './panelConstraints';
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
    onlySaveAfterUserInteractions: true,
    panelIds: ['sidebar', 'editor'],
    storage: panelLayoutStorage,
  });
  const sidebarPanelRef = usePanelRef();
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const sidebarHadFocusRef = useRef(false);
  const sidebarWidthWasUserSetRef = useRef(Boolean(layout.defaultLayout));
  const [restoredSidebarOpen] = useState(
    () =>
      readPersistedSidebarOpen() ??
      (layout.defaultLayout?.sidebar ?? DEFAULT_LAYOUT.sidebar) > 0,
  );
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
  const onLayoutChanged = (
    nextLayout: Parameters<typeof layout.onLayoutChanged>[0],
    meta: Parameters<typeof layout.onLayoutChanged>[1],
  ) => {
    if (meta.isUserInteraction) {
      sidebarWidthWasUserSetRef.current = true;
    }
    layout.onLayoutChanged(nextLayout, meta);
  };

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

  useLayoutEffect(() => {
    if (sidebarHydratedRef.current && !focusMode) {
      persistSidebarOpen(sidebarOpen);
    }
  }, [focusMode, sidebarOpen]);

  useLayoutEffect(() => {
    if (
      !sidebarOpen ||
      !currentFileName ||
      sidebarWidthWasUserSetRef.current
    ) {
      return;
    }

    const frame = globalThis.requestAnimationFrame(() => {
      if (!sidebarWidthWasUserSetRef.current && sidebarOpen) {
        sidebarPanelRef.current?.resize(
          sidebarWidthForMeasuredFileName(measureFileName(currentFileName)),
        );
      }
    });

    return () => {
      globalThis.cancelAnimationFrame(frame);
    };
  }, [currentFileName, sidebarOpen, sidebarPanelRef]);

  return (
    <div
      className={focusMode ? 'lm-app-shell lm-focus-mode' : 'lm-app-shell'}
      data-testid="app-shell"
    >
      {slots.topChrome}

      <div className="lm-workspace-stage">
        <div
          aria-hidden={Boolean(slots.startScreen)}
          className="lm-workspace-content"
          data-testid="workspace-content"
          inert={Boolean(slots.startScreen)}
        >
          <PanelGroup
            className="lm-workspace-shell"
            defaultLayout={layout.defaultLayout ?? DEFAULT_LAYOUT}
            id="lumamark-v1-main-panels"
            onLayoutChanged={onLayoutChanged}
            orientation="horizontal"
          >
            <Panel
              className="lm-sidebar-panel"
              collapsible
              collapsedSize="0%"
              defaultSize={sidebarPanelConstraints.defaultSize}
              groupResizeBehavior="preserve-pixel-size"
              id="sidebar"
              maxSize={sidebarPanelConstraints.maxSize}
              minSize={sidebarPanelConstraints.minSize}
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
        </div>
        {slots.startScreen ? (
          <div className="lm-start-screen-layer">{slots.startScreen}</div>
        ) : null}
      </div>

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

function measureFileName(fileName: string): number {
  if (globalThis.navigator?.userAgent.toLowerCase().includes('jsdom')) {
    return fileName.length * 8;
  }

  try {
    const context = globalThis.document
      ?.createElement('canvas')
      .getContext('2d');
    if (context) {
      context.font = '13px system-ui, sans-serif';
      return context.measureText(fileName).width;
    }
  } catch {
    // The character-width estimate keeps desktop startup resilient if canvas is unavailable.
  }

  return fileName.length * 8;
}
