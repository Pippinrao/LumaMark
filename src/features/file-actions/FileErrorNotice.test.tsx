import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { FileErrorNotice } from './FileErrorNotice';

describe('FileErrorNotice', () => {
  afterEach(cleanup);

  it.each([
    ['file.not_found', '找不到该文件'],
    ['file.permission_denied', '无法访问该文件'],
    ['workspace.not_directory', '工作区路径不是文件夹'],
    ['desktop.open_request_drain_failed', '桌面文件打开功能暂不可用'],
    ['desktop.open_request_recover_failed', '桌面文件打开功能暂不可用'],
    ['desktop.open_request_path_not_utf8', '该桌面文件路径无法安全打开'],
    ['link.protocol_javascript', '不允许打开 javascript: 链接'],
    ['link.protocol_data', '不允许打开 data: 链接'],
    ['link.protocol_file', '不允许打开 file: 链接'],
    ['link.fragmentUnavailable', '当前文档中找不到链接指向的标题'],
  ])('shows a localized visible error for %s', (code, message) => {
    render(
      <I18nProvider>
        <FileErrorNotice
          error={{ code, message: 'backend detail', recoverable: true }}
          onDismiss={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('offers a localized retry action when recovery can be attempted again', () => {
    const onRetry = vi.fn();
    render(
      <I18nProvider>
        <FileErrorNotice
          error={{
            code: 'desktop.open_request_queue_unavailable',
            message: 'backend detail',
            recoverable: true,
          }}
          onDismiss={vi.fn()}
          onRetry={onRetry}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each([
    {
      error: {
        code: 'desktop.open_request_claim_failed',
        message: 'private E:/notes/secret.md request-41 token-73',
        recoverable: false,
      },
      onRetry: vi.fn(),
    },
    {
      error: {
        code: 'desktop.open_request_claim_failed',
        message: 'private E:/notes/secret.md request-41 token-73',
        recoverable: true,
      },
      onRetry: undefined,
    },
  ])(
    'does not expose retry or backend details without a recoverable retry action',
    ({ error, onRetry }) => {
      render(
        <I18nProvider>
          <FileErrorNotice
            error={error}
            onDismiss={vi.fn()}
            onRetry={onRetry}
          />
        </I18nProvider>,
      );

      expect(
        screen.queryByRole('button', { name: '重试' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).not.toHaveTextContent(
        'E:/notes/secret.md',
      );
      expect(screen.getByRole('alert')).not.toHaveTextContent(
        'request-41',
      );
      expect(screen.getByRole('alert')).not.toHaveTextContent('token-73');
    },
  );

  it('uses neutral localized safety copy without claiming that no state changed', () => {
    render(
      <I18nProvider>
        <FileErrorNotice
          error={{
            code: 'desktop.open_request_ack_failed',
            message: 'private backend detail',
            recoverable: true,
          }}
          onDismiss={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      '继续前请确认当前文档状态。',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      '当前文档内容未被更改。',
    );
  });
});
