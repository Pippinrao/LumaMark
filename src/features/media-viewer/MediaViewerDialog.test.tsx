import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { MediaViewerDialog } from './MediaViewerDialog';

afterEach(() => cleanup());

describe('MediaViewerDialog', () => {
  it('shows an image in a full-viewport dialog with localized zoom controls', () => {
    const onOpenChange = vi.fn();

    render(
      <I18nProvider>
        <MediaViewerDialog
          onOpenChange={onOpenChange}
          onReturnFocus={vi.fn()}
          open
          request={{ alt: 'Architecture', kind: 'image', src: 'asset://diagram.png' }}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('dialog', { name: '图片查看器' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Architecture' })).toHaveAttribute(
      'src',
      'asset://diagram.png',
    );
    expect(screen.getByRole('button', { name: '放大' })).toBeVisible();
    expect(screen.getByRole('button', { name: '缩小' })).toBeVisible();
    expect(screen.getByRole('button', { name: '重置缩放' })).toBeVisible();
    expect(screen.getByRole('status', { name: '缩放比例' })).toHaveTextContent(
      '100%',
    );
    expect(screen.getByRole('button', { name: '放大' })).toHaveAttribute(
      'aria-keyshortcuts',
      '+',
    );
    expect(screen.getByRole('button', { name: '放大' })).toHaveAttribute(
      'title',
      '放大',
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reuses the rendered Mermaid SVG instead of creating an image element', () => {
    render(
      <I18nProvider>
        <MediaViewerDialog
          onOpenChange={vi.fn()}
          onReturnFocus={vi.fn()}
          open
          request={{
            kind: 'mermaid',
            svg: '<svg data-mermaid-id="diagram"><title>Flow</title></svg>',
          }}
        />
      </I18nProvider>,
    );

    expect(document.querySelector('svg[data-mermaid-id="diagram"]')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('returns focus through the caller-owned callback when the dialog closes', async () => {
    const onReturnFocus = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <MediaViewerDialog
          onOpenChange={setOpen}
          onReturnFocus={onReturnFocus}
          open={open}
          request={{ alt: '', kind: 'image', src: 'asset://diagram.png' }}
        />
      );
    }

    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(onReturnFocus).toHaveBeenCalledOnce();
    });
  });
});
