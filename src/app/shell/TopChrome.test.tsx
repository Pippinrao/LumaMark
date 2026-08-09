import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopChrome } from './TopChrome';
import type { WindowControlsModel } from './shellTypes';

afterEach(() => cleanup());

const windowChrome: WindowControlsModel = {
  maximized: false,
  onChromeMouseDown: vi.fn(),
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
});
