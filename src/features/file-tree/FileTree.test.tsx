import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { installResizeObserverStub } from '../../test/resizeObserverStub';
import { FileTree } from './FileTree';

describe('FileTree', () => {
  beforeEach(() => {
    installResizeObserverStub();
  });

  it('loads an unopened directory only once when activated', () => {
    const onLoadChildren = vi.fn();

    render(
      <I18nProvider>
        <FileTree
          loadingPaths={{}}
          onLoadChildren={onLoadChildren}
          onOpenFile={vi.fn()}
          onOpenWorkspace={vi.fn()}
          root={{ name: 'Notes', path: 'E:/docs/Notes' }}
          tree={[
            {
              children: [],
              id: 'E:/docs/Notes/Drafts',
              kind: 'directory',
              loaded: false,
              name: 'Drafts',
              path: 'E:/docs/Notes/Drafts',
            },
          ]}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByText('Drafts'));

    expect(onLoadChildren).toHaveBeenCalledTimes(1);
    expect(onLoadChildren).toHaveBeenCalledWith('E:/docs/Notes/Drafts');
  });
});
