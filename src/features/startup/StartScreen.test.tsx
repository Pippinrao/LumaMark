import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { useAppStore } from '../../app/stores/appStore';
import { StartScreen } from './StartScreen';

describe('StartScreen', () => {
  afterEach(cleanup);

  it('offers localized primary actions and recent items', () => {
    useAppStore.setState({ language: 'zh-CN' });
    const onNewDocument = vi.fn();
    const onOpenFile = vi.fn();
    const onOpenRecentFile = vi.fn();
    const onOpenRecentWorkspace = vi.fn();
    const onOpenWorkspace = vi.fn();

    render(
      <I18nProvider>
        <StartScreen
          onNewDocument={onNewDocument}
          onOpenFile={onOpenFile}
          onOpenRecentFile={onOpenRecentFile}
          onOpenRecentWorkspace={onOpenRecentWorkspace}
          onOpenWorkspace={onOpenWorkspace}
          recentFiles={[{ name: '今天.md', openedAt: 2, path: 'E:/notes/today.md' }]}
          recentWorkspaces={[{ name: '笔记', openedAt: 1, path: 'E:/notes' }]}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('main', { name: '开始' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新建文档' }));
    fireEvent.click(screen.getByRole('button', { name: '打开 Markdown 文件' }));
    fireEvent.click(screen.getByRole('button', { name: '打开工作区' }));
    fireEvent.click(screen.getByRole('button', { name: /今天\.md/ }));
    fireEvent.click(screen.getByRole('button', { name: /笔记/ }));

    expect(onNewDocument).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onOpenWorkspace).toHaveBeenCalledOnce();
    expect(onOpenRecentFile).toHaveBeenCalledWith('E:/notes/today.md');
    expect(onOpenRecentWorkspace).toHaveBeenCalledWith('E:/notes');
  });
});
