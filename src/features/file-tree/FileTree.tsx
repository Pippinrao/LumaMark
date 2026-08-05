import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import { Tree, type NodeRendererProps, type TreeApi } from 'react-arborist';
import { useTranslation } from 'react-i18next';
import type { WorkspaceDirectory } from '../../services/workspace/workspaceCommands';
import { RecentFilesList } from '../recent-files/RecentFilesList';
import type { RecentFile } from '../recent-files/recentFilesStore';
import type { WorkspaceTreeNode } from '../workspace/workspaceStore';

type FileTreeProps = {
  loadingPaths: Record<string, boolean>;
  onLoadChildren: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenWorkspace: () => void;
  recentFiles?: readonly RecentFile[];
  root: WorkspaceDirectory | null;
  selectedPath?: string;
  tree: WorkspaceTreeNode[];
};

export function FileTree({
  loadingPaths,
  onLoadChildren,
  onOpenFile,
  onOpenWorkspace,
  recentFiles = [],
  root,
  selectedPath,
  tree,
}: FileTreeProps) {
  const { t } = useTranslation();
  const [treeBodyRef, treeSize] = useElementSize();
  const treeRef = useRef<TreeApi<WorkspaceTreeNode> | undefined>(undefined);
  const pendingLoadPathsRef = useRef(new Set<string>());
  const singleFileName = selectedPath
    ?.split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
  const requestLoadChildren = useCallback(
    (node: WorkspaceTreeNode) => {
      if (
        node.kind !== 'directory' ||
        node.loaded ||
        loadingPaths[node.path] ||
        pendingLoadPathsRef.current.has(node.path)
      ) {
        return;
      }

      pendingLoadPathsRef.current.add(node.path);
      queueMicrotask(() => {
        pendingLoadPathsRef.current.delete(node.path);
      });
      onLoadChildren(node.path);
    },
    [loadingPaths, onLoadChildren],
  );

  return (
    <section className="lm-file-tree" aria-label={t('workspace.fileTree')}>
      <div className="lm-sidebar-section-header">
        <span>{t('workspace.title')}</span>
        <button type="button" onClick={onOpenWorkspace}>
          <FolderOpen size={15} aria-hidden="true" />
          {t('workspace.open')}
        </button>
      </div>

      {!root && singleFileName ? (
        <div
          className="lm-single-file-sidebar"
          data-testid="single-file-sidebar"
          title={selectedPath}
        >
          <FileText aria-hidden="true" size={15} />
          <span>{singleFileName}</span>
        </div>
      ) : (
        <RecentFilesList files={recentFiles} onOpenFile={onOpenFile} />
      )}

      {root ? (
        <div className="lm-workspace-root" title={root.path}>
          {root.name}
        </div>
      ) : singleFileName ? null : (
        <div className="lm-sidebar-empty">{t('workspace.empty')}</div>
      )}

      <div className="lm-file-tree-body" ref={treeBodyRef}>
        {root && treeSize.height > 0 ? (
          <Tree<WorkspaceTreeNode>
            aria-label={t('workspace.fileTree')}
            childrenAccessor={(node) => node.children ?? null}
            data={tree}
            disableDrag
            disableEdit
            disableMultiSelection
            height={treeSize.height}
            idAccessor={(node) => node.id}
            indent={16}
            ref={treeRef}
            onToggle={(path) => {
              const node = treeRef.current?.get(path);

              if (node?.isOpen) {
                requestLoadChildren(node.data);
              }
            }}
            openByDefault={false}
            overscanCount={8}
            rowHeight={32}
            selection={selectedPath}
            width={treeSize.width}
          >
            {(props) => (
              <FileTreeNode
                {...props}
                loading={Boolean(loadingPaths[props.node.data.path])}
                onLoadChildren={requestLoadChildren}
                onOpenFile={onOpenFile}
              />
            )}
          </Tree>
        ) : null}
      </div>
    </section>
  );
}

type FileTreeNodeProps = NodeRendererProps<WorkspaceTreeNode> & {
  loading: boolean;
  onLoadChildren: (node: WorkspaceTreeNode) => void;
  onOpenFile: (path: string) => void;
};

const FileTreeNode = memo(function FileTreeNode({
  loading,
  node,
  onLoadChildren,
  onOpenFile,
  style,
}: FileTreeNodeProps) {
  const { t } = useTranslation();
  const isDirectory = node.data.kind === 'directory';
  const Icon = isDirectory && node.isOpen ? FolderOpen : isDirectory ? Folder : FileText;
  const Chevron = node.isOpen ? ChevronDown : ChevronRight;
  const handleClick = () => {
    node.select();

    if (isDirectory) {
      const willOpen = !node.isOpen;

      node.toggle();

      if (willOpen) {
        onLoadChildren(node.data);
      }

      return;
    }

    onOpenFile(node.data.path);
  };

  return (
    <div
      data-testid={`file-tree-row-${node.data.path}`}
      className={[
        'lm-file-tree-node',
        isDirectory ? 'lm-file-tree-node-directory' : 'lm-file-tree-node-file',
        node.isSelected ? 'lm-file-tree-node-selected' : '',
        loading ? 'lm-file-tree-node-loading' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      title={node.data.path}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        handleClick();
      }}
    >
      <span
        className={[
          'lm-file-tree-chevron',
          isDirectory && node.isOpen ? 'lm-file-tree-chevron-open' : '',
          isDirectory && !node.isOpen ? 'lm-file-tree-chevron-closed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-testid={`file-tree-chevron-${node.data.path}`}
      >
        {isDirectory ? <Chevron size={14} aria-hidden="true" /> : null}
      </span>
      <Icon className="lm-file-tree-icon" size={15} aria-hidden="true" />
      <span className="lm-file-tree-name">{node.data.name}</span>
      {loading ? <span className="lm-file-tree-loading">{t('workspace.loading')}</span> : null}
    </div>
  );
});

function useElementSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({
    height: 0,
    width: 0,
  });

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const updateSize = () => {
      setSize({
        height: Math.floor(element.clientHeight),
        width: Math.floor(element.clientWidth),
      });
    };

    updateSize();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, size] as const;
}
