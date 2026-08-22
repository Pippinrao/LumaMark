import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  usePanelRef,
} from 'react-resizable-panels';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { persistSidebarOpen, readPersistedSidebarOpen } from './panelLayoutStorage';
import {
  FILE_TREE_CONTENT_CHROME_WIDTH,
  recordUserSidebarWidth,
  resolveSidebarWidthForTab,
  sidebarPanelConstraints,
  type SidebarTab,
  type SidebarUserSetWidths,
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
  readingMode: boolean;
  readOnlyFlashing: boolean;
  sidebarContentChromeWidth?: number;
  sidebarContentWidth: number;
  sidebarOpen: boolean;
  sidebarTab?: SidebarTab;
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
  readingMode,
  readOnlyFlashing,
  sidebarContentChromeWidth = FILE_TREE_CONTENT_CHROME_WIDTH,
  sidebarContentWidth,
  sidebarOpen,
  sidebarTab = 'files',
  slots,
  statusLabels,
  workspaceName,
}: AppShellViewProps) {
  const sidebarPanelRef = usePanelRef();
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const sidebarHadFocusRef = useRef(false);
  const userSetWidthsRef = useRef<SidebarUserSetWidths>({});
  const [restoredSidebarOpen] = useState(
    () => readPersistedSidebarOpen() ?? DEFAULT_LAYOUT.sidebar > 0,
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
    _nextLayout: unknown,
    meta: { isUserInteraction: boolean },
  ) => {
    if (!meta.isUserInteraction) {
      return;
    }

    const draggedWidth = sidebarPanelRef.current?.getSize().inPixels ?? 0;
    userSetWidthsRef.current = recordUserSidebarWidth(
      userSetWidthsRef.current,
      sidebarTab,
      draggedWidth,
    );
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
    if (!sidebarOpen) {
      return;
    }

    const nextWidth = resolveSidebarWidthForTab({
      chromeWidth: sidebarContentChromeWidth,
      contentWidth: sidebarContentWidth,
      tab: sidebarTab,
      userSetWidths: userSetWidthsRef.current,
    });

    const frame = globalThis.requestAnimationFrame(() => {
      if (sidebarOpen) {
        sidebarPanelRef.current?.resize(nextWidth);
      }
    });

    return () => {
      globalThis.cancelAnimationFrame(frame);
    };
  }, [
    sidebarContentChromeWidth,
    sidebarContentWidth,
    sidebarOpen,
    sidebarPanelRef,
    sidebarTab,
  ]);

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
            defaultLayout={DEFAULT_LAYOUT}
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
        readingMode={readingMode}
        readOnlyFlashing={readOnlyFlashing}
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
