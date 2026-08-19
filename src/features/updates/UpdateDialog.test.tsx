import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { UpdateDialog } from './UpdateDialog';

afterEach(() => cleanup());

describe('UpdateDialog', () => {
  it('shows an available update with install and later actions', () => {
    const onInstall = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <I18nProvider>
        <UpdateDialog
          currentVersion="0.2.16"
          errorCode={null}
          errorMessage={null}
          notes="Fix table caret"
          onInstall={onInstall}
          onOpenChange={onOpenChange}
          onReturnFocus={vi.fn()}
          open
          progress={null}
          status="available"
          version="0.2.17"
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('dialog', { name: '检查更新' })).toBeVisible();
    expect(screen.getByText('0.2.16')).toBeVisible();
    expect(screen.getByText('0.2.17')).toBeVisible();
    expect(screen.getByText('Fix table caret')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '立即更新' }));
    expect(onInstall).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '稍后' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('lets the user hide a background download and still shows progress', () => {
    const onOpenChange = vi.fn();

    render(
      <I18nProvider>
        <UpdateDialog
          currentVersion="0.2.16"
          errorCode={null}
          errorMessage={null}
          notes={null}
          onInstall={vi.fn()}
          onOpenChange={onOpenChange}
          onReturnFocus={vi.fn()}
          open
          progress={{ contentLength: 100, downloaded: 40 }}
          status="downloading"
          version="0.2.17"
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getAllByText('正在下载更新…').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('关闭')).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '稍后' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('prompts to install after a background download finishes', () => {
    const onInstall = vi.fn();

    render(
      <I18nProvider>
        <UpdateDialog
          currentVersion="0.2.16"
          errorCode={null}
          errorMessage={null}
          notes={null}
          onInstall={onInstall}
          onOpenChange={vi.fn()}
          onReturnFocus={vi.fn()}
          open
          progress={{ contentLength: 100, downloaded: 100 }}
          status="readyToInstall"
          version="0.2.17"
        />
      </I18nProvider>,
    );

    expect(screen.getByText('新版本 0.2.17 已下载完成，可以安装。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '立即安装' }));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it('shows a localized error state', () => {
    render(
      <I18nProvider>
        <UpdateDialog
          currentVersion="0.2.16"
          errorCode="update.checkFailed"
          errorMessage={null}
          notes={null}
          onInstall={vi.fn()}
          onOpenChange={vi.fn()}
          onReturnFocus={vi.fn()}
          open
          progress={null}
          status="error"
          version={null}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('检查更新失败。请稍后重试。')).toBeVisible();
  });
});
