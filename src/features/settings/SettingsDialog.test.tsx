import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { useAppStore } from '../../app/stores/appStore';
import { SettingsDialog } from './SettingsDialog';

describe('SettingsDialog', () => {
  afterEach(cleanup);

  it('changes the persisted startup behavior from a localized startup tab', () => {
    useAppStore.setState({ language: 'zh-CN' });
    const onStartupBehaviorChange = vi.fn();
    render(
      <I18nProvider>
        <SettingsDialog
          copyImagesToAssets={false}
          language="zh-CN"
          onCopyImagesToAssetsChange={vi.fn()}
          onLanguageChange={vi.fn()}
          onOpenChange={vi.fn()}
          onPageWidthChange={vi.fn()}
          onReturnFocus={vi.fn()}
          onStartupBehaviorChange={onStartupBehaviorChange}
          onThemeChange={vi.fn()}
          open
          pageWidth="standard"
          pageWidthPersistenceError={false}
          recentFilesPersistenceError={false}
          startupBehavior="home"
          startupPersistenceError={false}
          theme="light"
        />
      </I18nProvider>,
    );

    const startupTab = screen.getByRole('tab', { name: '启动' });
    startupTab.focus();
    fireEvent.keyDown(startupTab, { key: 'Enter' });
    const restore = screen.getByRole('button', { name: '恢复上次文件或工作区' });
    expect(restore).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(restore);
    expect(onStartupBehaviorChange).toHaveBeenCalledWith('restoreLastSession');
  });

  it('shows a localized alert when startup settings cannot be persisted', () => {
    useAppStore.setState({ language: 'zh-CN' });

    render(
      <I18nProvider>
        <SettingsDialog
          copyImagesToAssets={false}
          language="zh-CN"
          onCopyImagesToAssetsChange={vi.fn()}
          onLanguageChange={vi.fn()}
          onOpenChange={vi.fn()}
          onPageWidthChange={vi.fn()}
          onReturnFocus={vi.fn()}
          onStartupBehaviorChange={vi.fn()}
          onThemeChange={vi.fn()}
          open
          pageWidth="standard"
          pageWidthPersistenceError={false}
          recentFilesPersistenceError={false}
          startupBehavior="home"
          startupPersistenceError
          theme="light"
        />
      </I18nProvider>,
    );

    const startupTab = screen.getByRole('tab', { name: '启动' });
    startupTab.focus();
    fireEvent.keyDown(startupTab, { key: 'Enter' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      '无法读取或保存启动设置。当前选择可能仅在本次运行期间有效。',
    );
  });

  it('shows the startup persistence alert in English', () => {
    useAppStore.setState({ language: 'en' });

    render(
      <I18nProvider>
        <SettingsDialog
          copyImagesToAssets={false}
          language="en"
          onCopyImagesToAssetsChange={vi.fn()}
          onLanguageChange={vi.fn()}
          onOpenChange={vi.fn()}
          onPageWidthChange={vi.fn()}
          onReturnFocus={vi.fn()}
          onStartupBehaviorChange={vi.fn()}
          onThemeChange={vi.fn()}
          open
          pageWidth="standard"
          pageWidthPersistenceError={false}
          recentFilesPersistenceError={false}
          startupBehavior="home"
          startupPersistenceError
          theme="light"
        />
      </I18nProvider>,
    );

    const startupTab = screen.getByRole('tab', { name: 'Startup' });
    startupTab.focus();
    fireEvent.keyDown(startupTab, { key: 'Enter' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to read or save startup settings. Your current choices may only last for this run.',
    );
  });

  it.each([
    {
      language: 'zh-CN' as const,
      message: '无法读取或保存最近文件列表。当前列表可能仅在本次运行期间有效。',
      tab: '启动',
    },
    {
      language: 'en' as const,
      message:
        'Unable to read or save recent files. The current list may only last for this run.',
      tab: 'Startup',
    },
  ])('shows the recent-file persistence alert in $language', ({ language, message, tab }) => {
    useAppStore.setState({ language });

    render(
      <I18nProvider>
        <SettingsDialog
          copyImagesToAssets={false}
          language={language}
          onCopyImagesToAssetsChange={vi.fn()}
          onLanguageChange={vi.fn()}
          onOpenChange={vi.fn()}
          onPageWidthChange={vi.fn()}
          onReturnFocus={vi.fn()}
          onStartupBehaviorChange={vi.fn()}
          onThemeChange={vi.fn()}
          open
          pageWidth="standard"
          pageWidthPersistenceError={false}
          recentFilesPersistenceError
          startupBehavior="home"
          startupPersistenceError={false}
          theme="light"
        />
      </I18nProvider>,
    );

    const startupTab = screen.getByRole('tab', { name: tab });
    startupTab.focus();
    fireEvent.keyDown(startupTab, { key: 'Enter' });

    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });
});
