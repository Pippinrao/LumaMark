import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installResizeObserverStub } from '../../test/resizeObserverStub';
import { AppShellView } from './AppShellView';

describe('AppShellView real resizable panel integration', () => {
  beforeEach(() => {
    installResizeObserverStub();
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      function getTestWidth(this: HTMLElement) {
        if (this.dataset.testid === 'sidebar') {
          return 260;
        }
        if (this.dataset.testid === 'editor') {
          return 740;
        }
        return 1000;
      },
    );
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function getTestRect(this: Element) {
        const testId = (this as HTMLElement).dataset.testid;
        if (this.hasAttribute('data-separator')) {
          return {
            bottom: 700,
            height: 700,
            left: 260,
            right: 260,
            toJSON: () => ({}),
            top: 0,
            width: 0,
            x: 260,
            y: 0,
          };
        }
        const left = testId === 'editor' ? 260 : 0;
        const width = testId === 'sidebar' ? 260 : testId === 'editor' ? 740 : 1000;
        return {
          bottom: 700,
          height: 700,
          left,
          right: left + width,
          toJSON: () => ({}),
          top: 0,
          width,
          x: left,
          y: 0,
        };
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('applies the adaptive pixel width through the real panel API', async () => {
    render(createShell(1200));

    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toHaveStyle({
        flexGrow: '48',
      });
    });
  });

  it('lets a sparse file tree settle at the adaptive minimum', async () => {
    render(createShell(20));

    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toHaveStyle({
        flexGrow: '20',
      });
    });
  });
});

function createShell(sidebarContentWidth: number) {
  return (
    <AppShellView
      currentFileName="draft.md"
      dirty={false}
      focusMode={false}
      focusModeExitLabel="Exit"
      onExitFocusMode={vi.fn()}
      onSidebarCollapsedFocus={vi.fn()}
      onSidebarOpenChange={vi.fn()}
      readingMode={false}
      readOnlyFlashing={false}
      sidebarContentWidth={sidebarContentWidth}
      sidebarOpen
      slots={{
        dialogs: null,
        editor: <div>Editor</div>,
        sidebar: <div>Sidebar</div>,
        startScreen: null,
        topChrome: <div>Chrome</div>,
      }}
      statusLabels={{
        dirtyIndicator: 'Dirty',
        readOnly: 'Read-only',
        readOnlyFlash: 'Document is read-only',
        statistics: 'Statistics',
        status: 'Status',
      }}
    />
  );
}
