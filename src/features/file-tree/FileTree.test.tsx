import '@testing-library/jest-dom/vitest';
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { installResizeObserverStub } from '../../test/resizeObserverStub';
import { FileTree } from './FileTree';

describe('FileTree', () => {
  beforeEach(() => {
    installResizeObserverStub();
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(420);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(260);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads an unopened directory only once when activated', () => {
    const onLoadChildren = vi.fn();

    render(
      <I18nProvider>
        <FileTree
          loadingPaths={{}}
          onLoadChildren={onLoadChildren}
          onOpenFile={vi.fn()}
          onOpenWorkspace={vi.fn()}
          root={{ name: 'Notes', path: 'E:/docs/Notes' }}
          tree={[
            {
              children: [],
              id: 'E:/docs/Notes/Drafts',
              kind: 'directory',
              loaded: false,
              name: 'Drafts',
              path: 'E:/docs/Notes/Drafts',
            },
          ]}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('Drafts'));

    expect(onLoadChildren).toHaveBeenCalledTimes(1);
    expect(onLoadChildren).toHaveBeenCalledWith('E:/docs/Notes/Drafts');
  });

  it('toggles a loaded directory open and closed without loading children again', async () => {
    const onLoadChildren = vi.fn();

    renderFileTree({
      onLoadChildren,
      tree: [
        {
          children: [
            {
              id: 'E:/docs/Notes/Drafts/intro.md',
              kind: 'markdownFile',
              loaded: true,
              name: 'intro.md',
              path: 'E:/docs/Notes/Drafts/intro.md',
            },
          ],
          id: 'E:/docs/Notes/Drafts',
          kind: 'directory',
          loaded: true,
          name: 'Drafts',
          path: 'E:/docs/Notes/Drafts',
        },
      ],
    });

    fireEvent.click(screen.getByText('Drafts'));

    expect(await screen.findByText('intro.md')).toBeInTheDocument();
    expect(screen.getByTestId('file-tree-chevron-E:/docs/Notes/Drafts')).toHaveClass(
      'lm-file-tree-chevron-open',
    );
    expect(onLoadChildren).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Drafts'));

    await waitFor(() => {
      expect(screen.queryByText('intro.md')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('file-tree-chevron-E:/docs/Notes/Drafts')).toHaveClass(
      'lm-file-tree-chevron-closed',
    );
    expect(onLoadChildren).not.toHaveBeenCalled();
  });

  it('opens markdown files without toggling directory loading', () => {
    const onLoadChildren = vi.fn();
    const onOpenFile = vi.fn();

    renderFileTree({
      onLoadChildren,
      onOpenFile,
      tree: [
        {
          id: 'E:/docs/Notes/readme.md',
          kind: 'markdownFile',
          loaded: true,
          name: 'readme.md',
          path: 'E:/docs/Notes/readme.md',
        },
      ],
    });

    fireEvent.click(screen.getByText('readme.md'));

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith('E:/docs/Notes/readme.md');
    expect(onLoadChildren).not.toHaveBeenCalled();
  });

  it('opens a recent file from the files sidebar', () => {
    const onOpenFile = vi.fn();

    renderFileTree({
      onOpenFile,
      recentFiles: [
        {
          name: 'journal.md',
          openedAt: 1,
          path: 'E:/docs/journal.md',
        },
      ],
      tree: [],
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: '打开最近文件 journal.md（E:/docs/journal.md）',
      }),
    );

    expect(onOpenFile).toHaveBeenCalledWith('E:/docs/journal.md');
  });

  it('does not duplicate lazy loads when a closed directory is clicked repeatedly', () => {
    const onLoadChildren = vi.fn();

    renderFileTree({
      onLoadChildren,
      tree: [
        {
          children: [],
          id: 'E:/docs/Notes/Drafts',
          kind: 'directory',
          loaded: false,
          name: 'Drafts',
          path: 'E:/docs/Notes/Drafts',
        },
      ],
    });

    fireEvent.click(screen.getByText('Drafts'));
    fireEvent.click(screen.getByText('Drafts'));
    fireEvent.click(screen.getByText('Drafts'));

    expect(onLoadChildren).toHaveBeenCalledTimes(1);
  });

  it('renders modern row affordances for hover, selection, focus, and loading states', () => {
    renderFileTree({
      loadingPaths: { 'E:/docs/Notes/Drafts': true },
      selectedPath: 'E:/docs/Notes/readme.md',
      tree: [
        {
          children: [],
          id: 'E:/docs/Notes/Drafts',
          kind: 'directory',
          loaded: false,
          name: 'Drafts',
          path: 'E:/docs/Notes/Drafts',
        },
        {
          id: 'E:/docs/Notes/readme.md',
          kind: 'markdownFile',
          loaded: true,
          name: 'readme.md',
          path: 'E:/docs/Notes/readme.md',
        },
      ],
    });

    expect(screen.getByTestId('file-tree-row-E:/docs/Notes/Drafts')).toHaveClass(
      'lm-file-tree-node-loading',
    );
    expect(screen.getByTestId('file-tree-row-E:/docs/Notes/readme.md')).toHaveClass(
      'lm-file-tree-node-selected',
    );
    expect(screen.getByText('载入中')).toBeInTheDocument();
  });

  it('shows a compact current-file view when no workspace is open', () => {
    render(
      <I18nProvider>
        <FileTree
          loadingPaths={{}}
          onLoadChildren={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenWorkspace={vi.fn()}
          recentFiles={[]}
          root={null}
          selectedPath="E:/notes/standalone.md"
          tree={[]}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId('single-file-sidebar')).toHaveTextContent(
      'standalone.md',
    );
    expect(screen.queryByText('未打开工作区')).not.toBeInTheDocument();
    expect(screen.queryByText('最近文件')).not.toBeInTheDocument();
  });
});

type RenderFileTreeOptions = {
  loadingPaths?: Record<string, boolean>;
  onLoadChildren?: (path: string) => void;
  onOpenFile?: (path: string) => void;
  recentFiles?: ComponentProps<typeof FileTree>['recentFiles'];
  selectedPath?: string;
  tree: ComponentProps<typeof FileTree>['tree'];
};

function renderFileTree({
  loadingPaths = {},
  onLoadChildren = vi.fn(),
  onOpenFile = vi.fn(),
  recentFiles,
  selectedPath,
  tree,
}: RenderFileTreeOptions) {
  return render(
    <I18nProvider>
      <FileTree
        loadingPaths={loadingPaths}
        onLoadChildren={onLoadChildren}
        onOpenFile={onOpenFile}
        onOpenWorkspace={vi.fn()}
        recentFiles={recentFiles}
        root={{ name: 'Notes', path: 'E:/docs/Notes' }}
        selectedPath={selectedPath}
        tree={tree}
      />
    </I18nProvider>,
  );
}
