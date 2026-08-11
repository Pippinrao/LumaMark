import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShellView } from './AppShellView';
import {
  SIDEBAR_ADAPTIVE_MAX_WIDTH,
  SIDEBAR_ADAPTIVE_MIN_WIDTH,
} from './panelConstraints';
import {
  persistSidebarOpen,
  readPersistedSidebarOpen,
} from './panelLayoutStorage';

const panelMocks = vi.hoisted(() => ({
  expand: vi.fn(),
  resize: vi.fn(),
}));

vi.mock('react-resizable-panels', () => ({
  Group: ({ children, onLayoutChanged }: {
    children: React.ReactNode;
    onLayoutChanged: (
      layout: Record<string, number>,
      meta: { isUserInteraction: boolean },
    ) => void;
  }) => (
    <div data-testid="panel-group">
      {children}
      <button
        data-testid="manual-panel-resize"
        onClick={() =>
          onLayoutChanged(
            { editor: 68, sidebar: 32 },
            { isUserInteraction: true },
          )
        }
        type="button"
      />
    </div>
  ),
  Panel: ({ children, id }: { children: React.ReactNode; id: string }) => (
    <div data-testid={id}>{children}</div>
  ),
  Separator: () => <div role="separator" />,
  usePanelRef: () => ({
    current: {
      collapse: vi.fn(),
      expand: panelMocks.expand,
      resize: panelMocks.resize,
    },
  }),
}));

describe('AppShellView sidebar sizing', () => {
  beforeEach(() => {
    panelMocks.expand.mockReset();
    panelMocks.resize.mockReset();
  });
  afterEach(cleanup);

  it('adapts the shell sidebar to the reported file tree content width', async () => {
    renderShell({ sidebarContentWidth: 260 });

    await waitFor(() => {
      expect(panelMocks.resize).toHaveBeenCalledWith(332);
    });
  });

  it('keeps a sparse file tree at the adaptive minimum', async () => {
    renderShell({ sidebarContentWidth: 40 });

    await waitFor(() => {
      expect(panelMocks.resize).toHaveBeenCalledWith(SIDEBAR_ADAPTIVE_MIN_WIDTH);
    });
  });

  it('caps a deeply nested file tree at the adaptive maximum', async () => {
    renderShell({ sidebarContentWidth: 1200 });

    await waitFor(() => {
      expect(panelMocks.resize).toHaveBeenCalledWith(SIDEBAR_ADAPTIVE_MAX_WIDTH);
    });
  });

  it('stops adapting once the user has dragged the sidebar in this session', async () => {
    const view = renderShell({ sidebarContentWidth: 100 });
    await waitFor(() => expect(panelMocks.resize).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByTestId('manual-panel-resize'));
    view.rerender(createShell({ sidebarContentWidth: 900 }));

    await new Promise((resolve) => setTimeout(resolve, 32));
    expect(panelMocks.resize).toHaveBeenCalledOnce();
  });

  it('does not persist the temporary focus-mode sidebar collapse', async () => {
    persistSidebarOpen(true);
    const view = render(createShell({}));
    await waitFor(() => expect(readPersistedSidebarOpen()).toBe(true));

    view.rerender(createShell({ focusMode: true, sidebarOpen: false }));

    await waitFor(() => expect(readPersistedSidebarOpen()).toBe(true));
  });
});

type ShellOptions = {
  focusMode?: boolean;
  sidebarContentWidth?: number;
  sidebarOpen?: boolean;
};

function renderShell(options: ShellOptions) {
  return render(createShell(options));
}

function createShell({
  focusMode = false,
  sidebarContentWidth = 0,
  sidebarOpen = true,
}: ShellOptions) {
  return (
    <AppShellView
      currentFileName="draft.md"
      dirty={false}
      focusMode={focusMode}
      focusModeExitLabel="Exit focus mode"
      onExitFocusMode={vi.fn()}
      onSidebarCollapsedFocus={vi.fn()}
      onSidebarOpenChange={vi.fn()}
      readingMode={false}
      readOnlyFlashing={false}
      sidebarContentWidth={sidebarContentWidth}
      sidebarOpen={sidebarOpen}
      slots={{
        dialogs: null,
        editor: <div>Editor</div>,
        sidebar: <div>Sidebar</div>,
        startScreen: null,
        topChrome: <div>Chrome</div>,
      }}
      statusLabels={{
        dirtyIndicator: 'Unsaved',
        readOnly: 'Read-only',
        readOnlyFlash: 'Document is read-only',
        statistics: 'Statistics',
        status: 'Status',
      }}
    />
  );
}
