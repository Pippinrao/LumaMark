import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { AboutDialog } from './AboutDialog';

afterEach(() => cleanup());

describe('AboutDialog', () => {
  it('presents product identity and version in an independent dialog', () => {
    render(
      <I18nProvider>
        <AboutDialog
          onOpenChange={vi.fn()}
          onReturnFocus={vi.fn()}
          open
          version="0.2.0"
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('dialog', { name: '关于 LumaMark' })).toBeVisible();
    expect(screen.getByText('0.2.0')).toBeVisible();
    expect(screen.getByText('高性能 Typora-like Markdown 编辑器')).toBeVisible();
    expect(screen.queryByText('调整 LumaMark 的基础体验选项。')).not.toBeInTheDocument();
  });
});
