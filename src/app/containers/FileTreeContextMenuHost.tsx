import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  cloneElement,
  useCallback,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { FileTreeContextTarget } from '../../features/commands/createCommandModels';
import { ContextMenuSurface } from '../shell/ContextMenuSurface';
import type {
  ShellMenuInvocation,
  ShellMenuNode,
} from '../shell/shellTypes';

type FileTreeContextMenuHostProps = {
  children: ReactElement<{
    onContextMenuTarget?: (target: FileTreeContextTarget | null) => void;
  }>;
  getContextMenuNodes: (target: FileTreeContextTarget) => ShellMenuNode[];
  onInvoke: (invocation: ShellMenuInvocation) => void;
};

export function FileTreeContextMenuHost({
  children,
  getContextMenuNodes,
  onInvoke,
}: FileTreeContextMenuHostProps) {
  const [contextMenuNodes, setContextMenuNodes] = useState<ShellMenuNode[]>([]);
  const [open, setOpen] = useState(false);
  const hasContextTargetRef = useRef(false);
  const handleContextMenuTarget = useCallback(
    (target: FileTreeContextTarget | null) => {
      hasContextTargetRef.current = target !== null;
      setContextMenuNodes(target ? getContextMenuNodes(target) : []);
      if (!target) {
        setOpen(false);
      }
    },
    [getContextMenuNodes],
  );

  return (
    <ContextMenu.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen && hasContextTargetRef.current);
      }}
      open={open}
    >
      <ContextMenu.Trigger asChild>
        <div className="lm-file-tree-context-host">
          <ContextTargetChild onContextMenuTarget={handleContextMenuTarget}>
            {children}
          </ContextTargetChild>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuSurface nodes={contextMenuNodes} onInvoke={onInvoke} />
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function ContextTargetChild({
  children,
  onContextMenuTarget,
}: {
  children: FileTreeContextMenuHostProps['children'];
  onContextMenuTarget: NonNullable<
    FileTreeContextMenuHostProps['children']['props']['onContextMenuTarget']
  >;
}) {
  return cloneElement(children, { onContextMenuTarget });
}
