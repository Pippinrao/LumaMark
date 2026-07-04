import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import { Tree, type NodeRendererProps } from 'react-arborist';
import { useTranslation } from 'react-i18next';
import type { WorkspaceDirectory } from '../workspace/workspaceCommands';
import type { WorkspaceTreeNode } from '../workspace/workspaceStore';

type FileTreeProps = {
  loadingPaths: Record<string, boolean>;
  onLoadChildren: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenWorkspace: () => void;
  root: WorkspaceDirectory | null;
  selectedPath?: string;
  tree: WorkspaceTreeNode[];
};

export function FileTree({
  loadingPaths,
  onLoadChildren,
  onOpenFile,
  onOpenWorkspace,
  root,
  selectedPath,
  tree,
}: FileTreeProps) {
  const { t } = useTranslation();
  const [heightRef, height] = useElementHeight(320);
  const nodeByPath = useMemo(() => indexNodes(tree), [tree]);
  const pendingLoadPathsRef = useRef(new Set<string>());
  const requestLoadChildren = useCallback(
    (path: string) => {
      const node = nodeByPath.get(path);

      if (
        node?.kind !== 'directory' ||
        node.loaded ||
        loadingPaths[path] ||
        pendingLoadPathsRef.current.has(path)
      ) {
        return;
      }

      pendingLoadPathsRef.current.add(path);
      queueMicrotask(() => {
        pendingLoadPathsRef.current.delete(path);
      });
      onLoadChildren(path);
    },
    [loadingPaths, nodeByPath, onLoadChildren],
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

      {root ? (
        <div className="lm-workspace-root" title={root.path}>
          {root.name}
        </div>
      ) : (
        <div className="lm-sidebar-empty">{t('workspace.empty')}</div>
      )}

      <div className="lm-file-tree-body" ref={heightRef}>
        {root ? (
          <Tree<WorkspaceTreeNode>
            aria-label={t('workspace.fileTree')}
            childrenAccessor={(node) => node.children ?? null}
            data={tree}
            disableDrag
            disableEdit
            disableMultiSelection
            height={height}
            idAccessor={(node) => node.id}
            indent={16}
            onActivate={(node) => {
              if (node.data.kind === 'markdownFile') {
                onOpenFile(node.data.path);
              } else {
                node.toggle();
              }
            }}
            onToggle={(path) => {
              requestLoadChildren(path);
            }}
            overscanCount={8}
            rowHeight={28}
            selection={selectedPath}
            width="100%"
          >
            {(props) => (
              <FileTreeNode {...props} loading={Boolean(loadingPaths[props.node.data.path])} />
            )}
          </Tree>
        ) : null}
      </div>
    </section>
  );
}

function FileTreeNode({
  loading,
  node,
  style,
}: NodeRendererProps<WorkspaceTreeNode> & { loading: boolean }) {
  const { t } = useTranslation();
  const isDirectory = node.data.kind === 'directory';
  const Icon = isDirectory ? Folder : FileText;
  const Chevron = node.isOpen ? ChevronDown : ChevronRight;

  return (
    <div
      className={[
        'lm-file-tree-node',
        node.isSelected ? 'lm-file-tree-node-selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      title={node.data.path}
      onClick={(event) => {
        event.preventDefault();
        node.activate();
      }}
    >
      <span className="lm-file-tree-chevron">
        {isDirectory ? <Chevron size={14} aria-hidden="true" /> : null}
      </span>
      <Icon size={15} aria-hidden="true" />
      <span className="lm-file-tree-name">{node.data.name}</span>
      {loading ? <span className="lm-file-tree-loading">{t('workspace.loading')}</span> : null}
    </div>
  );
}

function indexNodes(nodes: readonly WorkspaceTreeNode[]) {
  const index = new Map<string, WorkspaceTreeNode>();
  const visit = (node: WorkspaceTreeNode) => {
    index.set(node.path, node);
    node.children?.forEach(visit);
  };

  nodes.forEach(visit);

  return index;
}

function useElementHeight(defaultHeight: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(defaultHeight);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const updateHeight = () => {
      setHeight(Math.max(180, Math.floor(element.clientHeight || defaultHeight)));
    };

    updateHeight();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [defaultHeight]);

  return [ref, height] as const;
}
