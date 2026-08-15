import '@testing-library/jest-dom/vitest';
import * as Tabs from '@radix-ui/react-tabs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../app/providers/I18nProvider';
import { useAppPreferencesStore } from '../../app/stores/appPreferencesStore';
import { TrashSettingsPage } from './TrashSettingsPage';

const entries = [
  {
    byteLength: 12,
    createdAtMs: 1_700_000_000_000,
    fingerprint: 'fp',
    id: 'entry-1',
    reason: 'close_discard' as const,
    sourcePath: 'E:/docs/note.md',
  },
];

function renderTrashPage(
  overrides: Partial<Parameters<typeof TrashSettingsPage>[0]> = {},
) {
  return render(
    <I18nProvider>
      <Tabs.Root defaultValue="trash">
        <TrashSettingsPage
          emptyBusy={false}
          entries={entries}
          loadError={null}
          onEmpty={vi.fn()}
          onPreview={vi.fn()}
          onRestore={vi.fn()}
          onRemove={vi.fn()}
          preview={null}
          previewBusy={false}
          restoreBusyId={null}
          {...overrides}
        />
      </Tabs.Root>
    </I18nProvider>,
  );
}

describe('TrashSettingsPage', () => {
  afterEach(() => {
    cleanup();
    useAppPreferencesStore.setState({ language: 'zh-CN' });
  });

  it('lists snapshots and restores them as a new unsaved document', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    const onRestore = vi.fn();
    const onPreview = vi.fn();
    renderTrashPage({ onPreview, onRestore });

    expect(screen.getByRole('tabpanel', { name: /trash/i })).toBeInTheDocument();
    expect(screen.getByText('E:/docs/note.md')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onPreview).toHaveBeenCalledWith('entry-1');
    fireEvent.click(screen.getByRole('button', { name: 'Restore as new unsaved document' }));
    expect(onRestore).toHaveBeenCalledWith('entry-1');
  });

  it('exposes permanent delete and empty actions with accessible names', () => {
    useAppPreferencesStore.setState({ language: 'zh-CN' });
    const onRemove = vi.fn();
    const onEmpty = vi.fn();
    renderTrashPage({
      onEmpty,
      onRemove,
      preview: { entry: entries[0], text: '# restored' },
    });

    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    expect(onRemove).toHaveBeenCalledWith('entry-1');
    fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(screen.getByText('# restored')).toBeInTheDocument();
  });
});
