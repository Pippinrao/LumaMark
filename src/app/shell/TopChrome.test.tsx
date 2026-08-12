import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopChrome } from './TopChrome';
import type { WindowControlsModel } from './shellTypes';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const windowChrome: WindowControlsModel = {
  maximized: false,
  onControl: vi.fn(),
};

describe('TopChrome', () => {
  it('keeps Tauri drag-region off the menu host so menu hits are not stolen', () => {
    render(
      <TopChrome
        groups={[
          {
            id: 'theme',
            label: '主题',
            items: [
              {
                type: 'item',
                id: 'about-proxy',
                invocation: { kind: 'action', action: 'openAbout' },
                label: '占位',
              },
            ],
          },
        ]}
        labels={{
          appName: 'LumaMark',
          close: '关闭',
          controls: '窗口',
          maximize: '最大化',
          minimize: '最小化',
          restore: '还原',
        }}
        onInvoke={vi.fn()}
        windowChrome={windowChrome}
      />,
    );

    const chrome = document.querySelector('.lm-top-chrome');
    expect(chrome).not.toBeNull();
    expect(chrome).not.toHaveAttribute('data-tauri-drag-region');

    const dragStrip = document.querySelector('.lm-titlebar-drag');
    expect(dragStrip).toHaveAttribute('data-tauri-drag-region');

    const menu = screen.getByRole('menubar');
    expect(menu).toHaveAttribute('data-lm-window-interactive', 'true');
    expect(menu.closest('[data-tauri-drag-region]')).toBeNull();
  });

  it('gives the blank strip exclusively to the native Tauri drag region', () => {
    const legacyManualDrag = vi.fn();
    const windowChromeWithLegacyHandler = {
      ...windowChrome,
      onChromeMouseDown: legacyManualDrag,
    };

    render(
      <TopChrome
        groups={[]}
        labels={{
          appName: 'LumaMark',
          close: '关闭',
          controls: '窗口',
          maximize: '最大化',
          minimize: '最小化',
          restore: '还原',
        }}
        onInvoke={vi.fn()}
        windowChrome={windowChromeWithLegacyHandler}
      />,
    );

    const dragStrip = document.querySelector('.lm-titlebar-drag');
    expect(dragStrip).not.toBeNull();

    fireEvent.mouseDown(dragStrip!, { button: 0, detail: 1 });
    fireEvent.mouseDown(dragStrip!, { button: 0, detail: 2 });

    expect(legacyManualDrag).not.toHaveBeenCalled();
  });

  it('keeps maximize clicks and portaled menu selections out of window dragging', async () => {
    const onInvoke = vi.fn();
    const legacyManualDrag = vi.fn();
    const windowChromeWithLegacyHandler = {
      ...windowChrome,
      onChromeMouseDown: legacyManualDrag,
    };

    render(
      <TopChrome
        groups={[
          {
            id: 'help',
            label: '帮助',
            items: [
              {
                type: 'item',
                id: 'about',
                invocation: { kind: 'action', action: 'openAbout' },
                label: '关于 LumaMark',
              },
            ],
          },
        ]}
        labels={{
          appName: 'LumaMark',
          close: '关闭',
          controls: '窗口',
          maximize: '最大化',
          minimize: '最小化',
          restore: '还原',
        }}
        onInvoke={onInvoke}
        windowChrome={windowChromeWithLegacyHandler}
      />,
    );

    const maximize = screen.getByRole('button', { name: '最大化' });
    fireEvent.mouseDown(maximize, { button: 0, detail: 1 });
    fireEvent.click(maximize);

    expect(legacyManualDrag).not.toHaveBeenCalled();
    expect(windowChrome.onControl).toHaveBeenCalledOnce();
    expect(windowChrome.onControl).toHaveBeenCalledWith('toggleMaximize');

    const help = screen.getByRole('menuitem', { name: '帮助' });
    help.focus();
    fireEvent.keyDown(help, { key: 'ArrowDown' });
    await waitFor(() => expect(help).toHaveAttribute('data-state', 'open'));

    const about = await screen.findByRole('menuitem', {
      name: '关于 LumaMark',
    });
    expect(document.querySelector('.lm-top-chrome')?.contains(about)).toBe(false);
    fireEvent.mouseDown(about, { button: 0, detail: 1 });
    fireEvent.click(about);

    expect(legacyManualDrag).not.toHaveBeenCalled();
    expect(onInvoke).toHaveBeenCalledOnce();
    expect(onInvoke).toHaveBeenCalledWith({
      kind: 'action',
      action: 'openAbout',
    });
  });
});
