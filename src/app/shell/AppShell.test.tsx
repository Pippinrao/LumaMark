import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../providers/I18nProvider';
import { ThemeProvider } from '../providers/ThemeProvider';
import { useAppStore } from '../stores/appStore';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders the localized Typora-like shell structure without hardcoded English UI', async () => {
    useAppStore.setState({
      language: 'zh-CN',
      sidebarOpen: true,
      statusKey: 'status.ready',
      theme: 'light',
    });

    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(
      screen.getByRole('heading', { name: 'LumaMark' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toBeInTheDocument();

    const editor = screen.getByRole('main');
    expect(
      within(editor).getByRole('heading', { name: '未命名' }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: '打开文件' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('就绪');

    expect(screen.queryByRole('button', { name: 'Open File' })).not
      .toBeInTheDocument();
    expect(screen.queryByText('Untitled')).not.toBeInTheDocument();
  });
});
