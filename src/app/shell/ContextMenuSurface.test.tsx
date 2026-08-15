import '@testing-library/jest-dom/vitest';
import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ExternalLink, Table2 } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandMenuNode } from '../../features/commands/commandTypes';
import { ContextMenuSurface } from './ContextMenuSurface';

afterEach(() => cleanup());

const nodes: CommandMenuNode[] = [
  {
    type: 'item',
    id: 'open-link',
    icon: ExternalLink,
    invocation: {
      action: 'openLink',
      kind: 'payloadAction',
      payload: { href: 'https://example.com' },
    },
    label: '打开链接',
  },
  { type: 'separator', id: 'sep' },
  {
    disabled: true,
    id: 'empty-label',
    label: '没有可用命令',
    type: 'label',
  },
  {
    type: 'item',
    id: 'table',
    icon: Table2,
    invocation: { kind: 'action', action: 'table' },
    label: '表格',
    shortcut: 'Ctrl+T',
  },
];

describe('ContextMenuSurface', () => {
  it('renders recursive command nodes and dispatches invocations', async () => {
    const onInvoke = vi.fn();
    render(
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <button type="button">trigger</button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuSurface nodes={nodes} onInvoke={onInvoke} />
        </ContextMenu.Portal>
      </ContextMenu.Root>,
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }), {
      clientX: 10,
      clientY: 10,
    });

    expect(await screen.findByRole('menuitem', { name: /打开链接/ })).toBeVisible();
    expect(screen.getByRole('menu')).toHaveAttribute(
      'data-lm-window-interactive',
      'true',
    );
    expect(screen.getByRole('separator')).toBeVisible();
    const emptyLabel = screen.getByRole('menuitem', { name: '没有可用命令' });
    expect(emptyLabel).toBeVisible();
    expect(emptyLabel).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(emptyLabel);
    expect(onInvoke).not.toHaveBeenCalled();
    const tableItem = screen.getByRole('menuitem', { name: /^表格/ });
    expect(tableItem.querySelector('.lm-menu-shortcut')).toHaveTextContent(
      'Ctrl+T',
    );
    expect(
      Array.from(tableItem.children).map((element) => element.className),
    ).toEqual([
      'lm-menu-indicator',
      'lm-menu-icon',
      'lm-menu-label',
      'lm-menu-shortcut',
      'lm-menu-submenu-arrow',
    ]);

    fireEvent.click(tableItem);
    expect(onInvoke).toHaveBeenCalledWith({ kind: 'action', action: 'table' });
  });

  it('exposes disabled state through ARIA and refuses pointer invocation', async () => {
    const onInvoke = vi.fn();
    render(
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <button type="button">disabled trigger</button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuSurface
            nodes={[
              {
                disabled: true,
                id: 'cut',
                invocation: { action: 'cut', kind: 'action' },
                label: '剪切',
                type: 'item',
              },
            ]}
            onInvoke={onInvoke}
          />
        </ContextMenu.Portal>
      </ContextMenu.Root>,
    );
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'disabled trigger' }),
      { clientX: 10, clientY: 10 },
    );

    const item = await screen.findByRole('menuitem', { name: '剪切' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);
    expect(onInvoke).not.toHaveBeenCalled();
  });

  it('exposes dangerous editor actions through the shared danger style hook', async () => {
    render(
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <button type="button">danger trigger</button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuSurface
            nodes={[
              {
                danger: true,
                id: 'delete-selection',
                invocation: { action: 'deleteSelection', kind: 'action' },
                label: '删除所选内容',
                type: 'item',
              },
            ]}
            onInvoke={vi.fn()}
          />
        </ContextMenu.Portal>
      </ContextMenu.Root>,
    );
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'danger trigger' }),
      { clientX: 10, clientY: 10 },
    );

    expect(
      await screen.findByRole('menuitem', { name: '删除所选内容' }),
    ).toHaveClass('lm-menu-item-danger');
  });

  it('supports keyboard navigation and requests active-editor focus on Escape', async () => {
    const editor = document.createElement('textarea');
    editor.setAttribute('aria-label', 'active editor');
    document.body.appendChild(editor);
    const onClose = vi.fn((restoreFocus: boolean) => {
      if (restoreFocus) {
        editor.focus();
      }
    });
    render(
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <button type="button">editor</button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuSurface
            nodes={nodes}
            onClose={onClose}
            onInvoke={vi.fn()}
          />
        </ContextMenu.Portal>
      </ContextMenu.Root>,
    );

    const trigger = screen.getByRole('button', { name: 'editor' });
    trigger.focus();
    fireEvent.contextMenu(trigger, { clientX: 10, clientY: 10 });

    const menu = await screen.findByRole('menu');
    const firstItem = await screen.findByRole('menuitem', { name: /打开链接/ });
    await waitFor(() => expect(menu).toHaveFocus());
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    await waitFor(() => expect(firstItem).toHaveFocus());
    fireEvent.keyDown(firstItem, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: /^表格/ })).toHaveFocus(),
    );
    fireEvent.keyDown(document.activeElement ?? firstItem, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(editor).toHaveFocus();
    expect(trigger).not.toHaveFocus();
    editor.remove();
  });

  it('preserves Radix default focus restoration when no close handler owns focus', async () => {
    render(
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <button type="button">workspace entry</button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuSurface nodes={nodes} onInvoke={vi.fn()} />
        </ContextMenu.Portal>
      </ContextMenu.Root>,
    );

    const trigger = screen.getByRole('button', { name: 'workspace entry' });
    trigger.focus();
    fireEvent.contextMenu(trigger, { clientX: 10, clientY: 10 });

    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(menu).toHaveFocus());
    fireEvent.keyDown(menu, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('preserves action-managed focus and closes without restoring the editor', async () => {
    const search = document.createElement('input');
    search.setAttribute('aria-label', 'search');
    document.body.appendChild(search);
    const onClose = vi.fn();
    render(
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <button type="button">editor surface</button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuSurface
            nodes={[
              {
                id: 'select-all',
                invocation: {
                  action: 'selectAll',
                  focusManagement: 'action',
                  kind: 'action',
                },
                label: '全选',
                type: 'item',
              },
            ]}
            onClose={onClose}
            onInvoke={() => search.focus()}
          />
        </ContextMenu.Portal>
      </ContextMenu.Root>,
    );

    const trigger = screen.getByRole('button', { name: 'editor surface' });
    fireEvent.contextMenu(trigger, { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByRole('menuitem', { name: '全选' }));

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(false));
    expect(search).toHaveFocus();
    search.remove();
  });
});
