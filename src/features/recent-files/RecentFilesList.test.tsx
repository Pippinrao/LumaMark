import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { RecentFilesList } from './RecentFilesList';

describe('RecentFilesList', () => {
  it('marks the selected path as the current file', () => {
    const onOpenFile = vi.fn();
    render(
      <I18nProvider>
        <RecentFilesList
          files={[
            { name: 'a.md', openedAt: 1, path: 'E:/notes/a.md' },
            { name: 'b.md', openedAt: 2, path: 'E:/notes/b.md' },
          ]}
          onOpenFile={onOpenFile}
          selectedPath="E:/notes/b.md"
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('button', { name: /b\.md/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /a\.md/ }));
    expect(onOpenFile).toHaveBeenCalledWith('E:/notes/a.md');
  });
});
