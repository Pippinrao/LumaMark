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
  getSize: vi.fn(() => ({ asPercentage: 32, inPixels: 250 })),
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
      getSize: panelMocks.getSize,
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

  it('adapts using outline chrome when the outline tab reports content width', async () => {
    renderShell({
      sidebarContentChromeWidth: 40,
      sidebarContentWidth: 240,
    });

    await waitFor(() => {
      expect(panelMocks.resize).toHaveBeenCalledWith(280);
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

  it('stops adapting a tab once the user has dragged the sidebar on that tab', async () => {
    const view = renderShell({ sidebarContentWidth: 100, sidebarTab: 'files' });
    await waitFor(() => expect(panelMocks.resize).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByTestId('manual-panel-resize'));
    view.rerender(createShell({ sidebarContentWidth: 900, sidebarTab: 'files' }));

    await waitFor(() => {
      expect(panelMocks.resize).toHaveBeenCalledWith(250);
    });
    expect(panelMocks.resize).not.toHaveBeenCalledWith(480);
  });

  it('re-applies auto-fit when switching to a tab the user has not dragged', async () => {
    const view = renderShell({ sidebarContentWidth: 100, sidebarTab: 'files' });
    await waitFor(() => expect(panelMocks.resize).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByTestId('manual-panel-resize'));
    view.rerender(
      createShell({
        sidebarContentChromeWidth: 40,
        sidebarContentWidth: 400,
        sidebarTab: 'outline',
      }),
    );

    await waitFor(() => {
      expect(panelMocks.resize).toHaveBeenCalledWith(440);
    });
  });

  it('restores the user-dragged width when switching back to that tab', async () => {
    const view = renderShell({ sidebarContentWidth: 100, sidebarTab: 'files' });
    await waitFor(() => expect(panelMocks.resize).toHaveBeenCalledWith(200));

    fireEvent.click(screen.getByTestId('manual-panel-resize'));
    view.rerender(
      createShell({
        sidebarContentChromeWidth: 40,
        sidebarContentWidth: 400,
        sidebarTab: 'outline',
      }),
    );
    await waitFor(() => expect(panelMocks.resize).toHaveBeenCalledWith(440));

    view.rerender(createShell({ sidebarContentWidth: 100, sidebarTab: 'files' }));
    await waitFor(() => {
      expect(panelMocks.resize).toHaveBeenCalledWith(250);
    });
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
  sidebarContentChromeWidth?: number;
  sidebarContentWidth?: number;
  sidebarOpen?: boolean;
  sidebarTab?: 'files' | 'outline';
};

function renderShell(options: ShellOptions) {
  return render(createShell(options));
}

function createShell({
  focusMode = false,
  sidebarContentChromeWidth,
  sidebarContentWidth = 0,
  sidebarOpen = true,
  sidebarTab = 'files',
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
      sidebarContentChromeWidth={sidebarContentChromeWidth}
      sidebarContentWidth={sidebarContentWidth}
      sidebarOpen={sidebarOpen}
      sidebarTab={sidebarTab}
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
