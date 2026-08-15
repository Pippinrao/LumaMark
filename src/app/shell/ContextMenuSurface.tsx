import * as ContextMenu from '@radix-ui/react-context-menu';
import { Check, ChevronRight } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import type {
  ShellMenuInvocation,
  ShellMenuNode,
} from './shellTypes';

type ContextMenuSurfaceProps = {
  nodes: ShellMenuNode[];
  onActionFocusReturn?: () => void;
  onInvoke: (invocation: ShellMenuInvocation) => void;
};

export function ContextMenuSurface({
  nodes,
  onActionFocusReturn,
  onInvoke,
}: ContextMenuSurfaceProps) {
  const invoke = (invocation: ShellMenuInvocation) => {
    for (const content of globalThis.document.querySelectorAll<HTMLElement>(
      '.lm-context-menu-content[data-state="open"]',
    )) {
      content.dataset.lmFocusManagement =
        invocation.focusManagement === 'action' ? 'action' : 'menu';
    }
    onInvoke(invocation);
  };
  const preserveActionFocus = (event: Event) => {
    const content = event.currentTarget as HTMLElement | null;
    if (content?.dataset.lmFocusManagement !== 'action') {
      return;
    }

    event.preventDefault();
    globalThis.setTimeout(() => onActionFocusReturn?.(), 0);
  };

  return (
    <ContextMenu.Content
      className="lm-menu-content lm-context-menu-content"
      data-lm-window-interactive="true"
      onCloseAutoFocus={preserveActionFocus}
    >
      {renderNodes(nodes, invoke)}
    </ContextMenu.Content>
  );
}

function renderNodes(
  nodes: ShellMenuNode[],
  onInvoke: ContextMenuSurfaceProps['onInvoke'],
): ReactNode[] {
  const rendered: ReactNode[] = [];

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];

    if (node.type === 'radio') {
      const radioNodes = [node];

      while (true) {
        const nextNode = nodes[index + 1];

        if (nextNode?.type !== 'radio' || nextNode.group !== node.group) {
          break;
        }

        radioNodes.push(nextNode);
        index += 1;
      }

      rendered.push(
        <ContextMenu.RadioGroup
          key={`radio-group-${node.group}`}
          value={radioNodes.find((item) => item.checked)?.id}
        >
          {radioNodes.map((item) => (
            <ContextMenu.RadioItem
              className="lm-menu-item lm-context-menu-item"
              disabled={item.disabled}
              key={item.id}
              onSelect={() => {
                onInvoke(item.invocation);
              }}
              value={item.id}
            >
              <MenuItemContent node={item} stateful />
            </ContextMenu.RadioItem>
          ))}
        </ContextMenu.RadioGroup>,
      );
      continue;
    }

    rendered.push(renderNode(node, onInvoke));
  }

  return rendered;
}

function renderNode(
  node: Exclude<ShellMenuNode, { type: 'radio' }>,
  onInvoke: ContextMenuSurfaceProps['onInvoke'],
): ReactNode {
  switch (node.type) {
    case 'separator':
      return (
        <ContextMenu.Separator
          className="lm-menu-separator"
          key={node.id}
        />
      );
    case 'label':
      return (
        <ContextMenu.Item
          className="lm-menu-item lm-context-menu-item"
          disabled
          key={node.id}
        >
          <MenuItemContent node={node} />
        </ContextMenu.Item>
      );
    case 'submenu':
      return (
        <ContextMenu.Sub key={node.id}>
          <ContextMenu.SubTrigger
            className="lm-menu-item lm-context-menu-item lm-menu-submenu-trigger"
            disabled={node.disabled}
          >
            <MenuItemContent node={node} submenu />
          </ContextMenu.SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent
              className="lm-menu-content lm-menu-submenu-content lm-context-menu-content"
              data-lm-window-interactive="true"
              sideOffset={6}
            >
              {renderNodes(node.items, onInvoke)}
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
      );
    case 'checkbox':
      return (
        <ContextMenu.CheckboxItem
          checked={node.checked}
          className="lm-menu-item lm-context-menu-item"
          disabled={node.disabled}
          key={node.id}
          onSelect={() => {
            onInvoke(node.invocation);
          }}
        >
          <MenuItemContent node={node} stateful />
        </ContextMenu.CheckboxItem>
      );
    case 'item':
      return (
        <ContextMenu.Item
          className="lm-menu-item lm-context-menu-item"
          disabled={node.disabled}
          key={node.id}
          onSelect={() => {
            onInvoke(node.invocation);
          }}
        >
          <MenuItemContent node={node} />
        </ContextMenu.Item>
      );
    default: {
      const unhandledNode: never = node;
      throw new Error(
        `Unsupported context menu node: ${JSON.stringify(unhandledNode)}`,
      );
    }
  }
}

function MenuItemContent({
  node,
  stateful = false,
  submenu = false,
}: {
  node: Exclude<ShellMenuNode, { type: 'separator' }>;
  stateful?: boolean;
  submenu?: boolean;
}) {
  const Icon = node.icon;

  return (
    <Fragment>
      <span className="lm-menu-indicator" aria-hidden="true">
        {stateful ? (
          <ContextMenu.ItemIndicator>
            <Check size={14} strokeWidth={2.4} />
          </ContextMenu.ItemIndicator>
        ) : null}
      </span>
      <span className="lm-menu-icon" aria-hidden="true">
        {Icon ? <Icon size={15} strokeWidth={1.9} /> : null}
      </span>
      <span className="lm-menu-label">{node.label}</span>
      <kbd className="lm-menu-shortcut">
        {'shortcut' in node ? node.shortcut : null}
      </kbd>
      <span className="lm-menu-submenu-arrow" aria-hidden="true">
        {submenu ? <ChevronRight size={14} strokeWidth={2} /> : null}
      </span>
    </Fragment>
  );
}
