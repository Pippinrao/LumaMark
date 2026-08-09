import * as Menubar from '@radix-ui/react-menubar';
import { Check, ChevronRight } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import type {
  CommandMenuGroup,
  CommandMenuInvocation,
  CommandMenuNode,
} from '../../features/commands/commandTypes';
import { logMenuInteraction } from '../../shared/debug/menuInteractionLog';

type AppMenuProps = {
  groups: CommandMenuGroup[];
  onInvoke: (invocation: CommandMenuInvocation) => void;
};

export function AppMenu({ groups, onInvoke }: AppMenuProps) {
  const invoke = (invocation: CommandMenuInvocation) => {
    logMenuInteraction(
      `AppMenu.invoke kind=${invocation.kind} action=${
        invocation.kind === 'action' ? invocation.action : 'callback'
      }`,
    );
    for (const content of globalThis.document.querySelectorAll<HTMLElement>(
      '.lm-menu-content[data-state="open"]',
    )) {
      content.dataset.lmFocusManagement =
        invocation.focusManagement === 'action' ? 'action' : 'menu';
    }
    onInvoke(invocation);
  };

  return (
    <Menubar.Root className="lm-menu-bar" data-lm-window-interactive="true">
      {groups.map((group) => (
        <Menubar.Menu key={group.id}>
          <Menubar.Trigger className="lm-menu-trigger">
            {group.label}
          </Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content
              align="start"
              className="lm-menu-content"
              onCloseAutoFocus={(event) => {
                const content = event.currentTarget as HTMLElement | null;

                if (content?.dataset.lmFocusManagement === 'action') {
                  event.preventDefault();
                }
              }}
              sideOffset={9}
            >
              {renderNodes(group.items, invoke)}
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
      ))}
    </Menubar.Root>
  );
}

function renderNodes(
  nodes: CommandMenuNode[],
  onInvoke: AppMenuProps['onInvoke'],
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
        <Menubar.RadioGroup
          key={`radio-group-${node.group}`}
          value={radioNodes.find((item) => item.checked)?.id}
        >
          {radioNodes.map((item) => (
            <Menubar.RadioItem
              className="lm-menu-item"
              disabled={item.disabled}
              key={item.id}
              onSelect={() => {
                logMenuInteraction(
                  `RadioItem.onSelect id=${item.id} label=${item.label}`,
                );
                onInvoke(item.invocation);
              }}
              value={item.id}
            >
              <MenuItemContent node={item} stateful />
            </Menubar.RadioItem>
          ))}
        </Menubar.RadioGroup>,
      );
      continue;
    }

    rendered.push(renderNode(node, onInvoke));
  }

  return rendered;
}

function renderNode(
  node: Exclude<CommandMenuNode, { type: 'radio' }>,
  onInvoke: AppMenuProps['onInvoke'],
): ReactNode {
  switch (node.type) {
    case 'separator':
      return <Menubar.Separator className="lm-menu-separator" key={node.id} />;
    case 'submenu':
      return (
        <Menubar.Sub key={node.id}>
          <Menubar.SubTrigger
            className="lm-menu-item lm-menu-submenu-trigger"
            disabled={node.disabled}
          >
            <MenuItemContent node={node} submenu />
          </Menubar.SubTrigger>
          <Menubar.Portal>
            <Menubar.SubContent
              className="lm-menu-content lm-menu-submenu-content"
              sideOffset={6}
            >
              {renderNodes(node.items, onInvoke)}
            </Menubar.SubContent>
          </Menubar.Portal>
        </Menubar.Sub>
      );
    case 'checkbox':
      return (
        <Menubar.CheckboxItem
          checked={node.checked}
          className="lm-menu-item"
          disabled={node.disabled}
          key={node.id}
          onSelect={() => {
            logMenuInteraction(
              `CheckboxItem.onSelect id=${node.id} label=${node.label}`,
            );
            onInvoke(node.invocation);
          }}
        >
          <MenuItemContent node={node} stateful />
        </Menubar.CheckboxItem>
      );
    case 'item':
      return (
        <Menubar.Item
          className="lm-menu-item"
          disabled={node.disabled}
          key={node.id}
          onSelect={() => {
            logMenuInteraction(
              `Item.onSelect id=${node.id} label=${node.label}`,
            );
            onInvoke(node.invocation);
          }}
        >
          <MenuItemContent node={node} />
        </Menubar.Item>
      );
  }
}

function MenuItemContent({
  node,
  stateful = false,
  submenu = false,
}: {
  node: Exclude<CommandMenuNode, { type: 'separator' }>;
  stateful?: boolean;
  submenu?: boolean;
}) {
  const Icon = node.icon;

  return (
    <Fragment>
      <span className="lm-menu-indicator" aria-hidden="true">
        {stateful ? (
          <Menubar.ItemIndicator>
            <Check size={14} strokeWidth={2.4} />
          </Menubar.ItemIndicator>
        ) : null}
      </span>
      <span className="lm-menu-icon" aria-hidden="true">
        {Icon ? <Icon size={15} strokeWidth={1.9} /> : null}
      </span>
      <span className="lm-menu-label">{node.label}</span>
      <kbd className="lm-menu-shortcut">{'shortcut' in node ? node.shortcut : null}</kbd>
      <span className="lm-menu-submenu-arrow" aria-hidden="true">
        {submenu ? <ChevronRight size={14} strokeWidth={2} /> : null}
      </span>
    </Fragment>
  );
}
