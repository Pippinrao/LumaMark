import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FolderOpen, Save } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandMenuGroup } from '../../features/commands/commandTypes';
import { AppMenu } from './AppMenu';

afterEach(() => cleanup());

const groups: CommandMenuGroup[] = [
  {
    id: 'file',
    label: '文件',
    items: [
      {
        type: 'item',
        id: 'open',
        icon: FolderOpen,
        invocation: { kind: 'action', action: 'openFile' },
        label: '打开文件',
        shortcut: 'Ctrl O',
      },
      { type: 'separator', id: 'file-save-separator' },
      {
        type: 'item',
        id: 'save',
        icon: Save,
        invocation: { kind: 'action', action: 'save' },
        label: '保存',
        shortcut: 'Ctrl S',
      },
      {
        type: 'submenu',
        id: 'recent',
        label: '最近文件',
        items: [
          {
            type: 'item',
            id: 'recent-readme',
            invocation: { kind: 'callback', run: vi.fn() },
            label: 'README.md',
          },
        ],
      },
      {
        type: 'item',
        id: 'unavailable',
        invocation: { kind: 'action', action: 'openWorkspace' },
        disabled: true,
        label: '不可用',
      },
    ],
  },
  {
    id: 'view',
    label: '视图',
    items: [
      {
        type: 'checkbox',
        id: 'sidebar',
        invocation: { kind: 'action', action: 'toggleSidebar' },
        checked: true,
        label: '侧边栏',
        shortcut: 'Ctrl \\',
      },
      {
        type: 'radio',
        group: 'display-mode',
        id: 'live-preview',
        invocation: { kind: 'action', action: 'setLivePreviewMode' },
        checked: true,
        label: '实时预览',
      },
      {
        type: 'radio',
        group: 'display-mode',
        id: 'source',
        invocation: { kind: 'action', action: 'setSourceMode' },
        checked: false,
        label: '源码模式',
        shortcut: 'Ctrl /',
      },
    ],
  },
];

describe('AppMenu', () => {
  it('renders stable icon, label, shortcut, separator, and disabled slots', async () => {
    const onInvoke = vi.fn();
    render(<AppMenu groups={groups} onInvoke={onInvoke} />);

    await openMenu('文件');

    const openItem = await screen.findByRole('menuitem', {
      name: /^打开文件Ctrl O$/,
    });

    expect(openItem.querySelector('.lm-menu-icon')).toBeInTheDocument();
    expect(openItem.querySelector('.lm-menu-label')).toHaveTextContent('打开文件');
    expect(openItem.querySelector('.lm-menu-shortcut')).toHaveTextContent('Ctrl O');
    expect(screen.getByRole('separator')).toBeVisible();
    const unavailableItem = screen.getByRole('menuitem', { name: '不可用' });
    expect(unavailableItem).toHaveAttribute(
      'data-disabled',
    );
    expect(unavailableItem).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(unavailableItem);
    expect(onInvoke).not.toHaveBeenCalled();
  });

  it('dispatches a typed invocation exactly once', async () => {
    const onInvoke = vi.fn();
    render(<AppMenu groups={groups} onInvoke={onInvoke} />);

    await openMenu('文件');
    fireEvent.click(await screen.findByRole('menuitem', { name: /^保存/ }));

    expect(onInvoke).toHaveBeenCalledOnce();
    expect(onInvoke).toHaveBeenCalledWith({ kind: 'action', action: 'save' });
  });

  it('opens nested submenus with the keyboard', async () => {
    render(<AppMenu groups={groups} onInvoke={vi.fn()} />);

    await openMenu('文件');
    const recent = await screen.findByRole('menuitem', { name: '最近文件' });
    recent.focus();
    fireEvent.keyDown(recent, { key: 'ArrowRight' });

    expect(await screen.findByRole('menuitem', { name: 'README.md' })).toBeVisible();
    expect(recent.querySelector('.lm-menu-submenu-arrow')).toBeInTheDocument();
  });

  it('exposes checked checkbox and radio semantics', async () => {
    render(<AppMenu groups={groups} onInvoke={vi.fn()} />);

    await openMenu('视图');

    expect(
      await screen.findByRole('menuitemcheckbox', { name: /^侧边栏/ }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('menuitemradio', { name: '实时预览' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('menuitemradio', { name: /^源码模式/ }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('returns focus to the trigger after a state menu action', async () => {
    render(<AppMenu groups={groups} onInvoke={vi.fn()} />);

    await openMenu('视图');
    fireEvent.click(
      await screen.findByRole('menuitemcheckbox', { name: /^侧边栏/ }),
    );

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: '视图' })).toHaveFocus();
    });
  });
});

async function openMenu(label: string): Promise<void> {
  const trigger = screen.getByRole('menuitem', { name: label });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await waitFor(() => {
    expect(trigger).toHaveAttribute('data-state', 'open');
  });
}
