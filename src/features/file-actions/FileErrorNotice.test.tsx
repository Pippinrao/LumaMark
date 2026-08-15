import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
});
