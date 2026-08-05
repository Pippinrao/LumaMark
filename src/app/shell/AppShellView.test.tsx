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
  persistSidebarOpen,
  readPersistedSidebarOpen,
} from './panelLayoutStorage';

const panelMocks = vi.hoisted(() => ({
  expand: vi.fn(),
  resize: vi.fn(),
  saveLayout: vi.fn(),
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
  useDefaultLayout: () => ({
    defaultLayout: undefined,
    onLayoutChanged: panelMocks.saveLayout,
  }),
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
    panelMocks.saveLayout.mockReset();
  });
  afterEach(cleanup);

  it('resizes the actual shell sidebar from the current file name', async () => {
    renderShell('a-very-long-standalone-markdown-file-name-that-needs-room.md');

    await waitFor(() => {
      expect(panelMocks.resize).toHaveBeenCalledWith(360);
    });
  });

  it('preserves a manual panel width when the current file name changes', async () => {
    const view = renderShell('short.md');
    await waitFor(() => expect(panelMocks.resize).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByTestId('manual-panel-resize'));
    view.rerender(createShell('a-very-long-file-name-that-would-auto-resize.md'));

    await new Promise((resolve) => setTimeout(resolve, 32));
    expect(panelMocks.resize).toHaveBeenCalledOnce();
    expect(panelMocks.saveLayout).toHaveBeenCalledWith(
      { editor: 68, sidebar: 32 },
      { isUserInteraction: true },
    );
  });

  it('does not persist the temporary focus-mode sidebar collapse', async () => {
    persistSidebarOpen(true);
    const view = render(createShell('draft.md'));
    await waitFor(() => expect(readPersistedSidebarOpen()).toBe(true));

    view.rerender(
      createShell('draft.md', { focusMode: true, sidebarOpen: false }),
    );

    await waitFor(() => expect(readPersistedSidebarOpen()).toBe(true));
  });
});

function renderShell(fileName: string) {
  return render(createShell(fileName));
}

function createShell(
  fileName: string,
  {
    focusMode = false,
    sidebarOpen = true,
  }: { focusMode?: boolean; sidebarOpen?: boolean } = {},
) {
  return (
    <AppShellView
      currentFileName={fileName}
      dirty={false}
      focusMode={focusMode}
      focusModeExitLabel="Exit focus mode"
      onExitFocusMode={vi.fn()}
      onSidebarCollapsedFocus={vi.fn()}
      onSidebarOpenChange={vi.fn()}
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
        statistics: 'Statistics',
        status: 'Status',
      }}
    />
  );
}
