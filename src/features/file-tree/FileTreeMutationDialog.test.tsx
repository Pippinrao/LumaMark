import '@testing-library/jest-dom/vitest';
import { useState, type ComponentProps } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../app/providers/I18nProvider';
import { FileTreeMutationDialog } from './FileTreeMutationDialog';

afterEach(() => cleanup());

describe('FileTreeMutationDialog', () => {
  it('submits a trimmed file name and exposes a localized accessible dialog', async () => {
    const onConfirm = vi.fn();
    renderDialog({
      onConfirm,
      request: {
        defaultValue: 'untitled.md',
        mode: 'createFile',
        parentPath: 'E:/notes',
      },
    });

    const dialog = screen.getByRole('dialog', { name: '新建文件' });
    expect(dialog).toHaveAttribute('data-lm-window-interactive', 'true');
    const input = screen.getByRole('textbox', { name: '文件名' });
    expect(input).toHaveValue('untitled.md');

    fireEvent.change(input, { target: { value: '  journal.md  ' } });
    fireEvent.submit(input.closest('form')!);

    expect(onConfirm).toHaveBeenCalledWith('journal.md');
  });

  it('disables confirmation for an empty name and while a mutation is pending', () => {
    const { rerender } = renderDialog({
      request: {
        defaultValue: '',
        mode: 'createDirectory',
        parentPath: 'E:/notes',
      },
    });

    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();

    rerender(
      <I18nProvider>
        <FileTreeMutationDialog
          busy
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
          onReturnFocus={vi.fn()}
          request={{
            defaultValue: 'drafts',
            mode: 'createDirectory',
            parentPath: 'E:/notes',
          }}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('textbox', { name: '文件夹名称' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在处理' })).toBeDisabled();
  });

  it('confirms a recycle-bin delete without asking for a name', () => {
    const onConfirm = vi.fn();
    renderDialog({
      onConfirm,
      request: {
        entryKind: 'file',
        mode: 'delete',
        name: 'old.md',
        path: 'E:/notes/old.md',
      },
    });

    expect(
      screen.getByText('“old.md”将被移到系统回收站。'),
    ).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移到回收站' }));

    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('uses a folder-name label when renaming a directory', () => {
    renderDialog({
      request: {
        defaultValue: 'Drafts',
        entryKind: 'directory',
        mode: 'rename',
        path: 'E:/notes/Drafts',
      },
    });

    expect(
      screen.getByRole('textbox', { name: '文件夹名称' }),
    ).toHaveValue('Drafts');
  });

  it('cancels with Escape and returns focus through the owning controller', async () => {
    const onCancel = vi.fn();
    const onReturnFocus = vi.fn();
    render(
      <DialogLifecycleHarness
        onCancel={onCancel}
        onReturnFocus={onReturnFocus}
      />,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    await waitFor(() => expect(onReturnFocus).toHaveBeenCalled());
  });
});

function DialogLifecycleHarness({
  onCancel,
  onReturnFocus,
}: Pick<DialogProps, 'onCancel' | 'onReturnFocus'>) {
  const [open, setOpen] = useState(true);

  return (
    <I18nProvider>
      {open ? (
        <FileTreeMutationDialog
          busy={false}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
          onConfirm={vi.fn()}
          onReturnFocus={onReturnFocus}
          request={{
            defaultValue: 'old.md',
            entryKind: 'file',
            mode: 'rename',
            path: 'E:/notes/old.md',
          }}
        />
      ) : null}
    </I18nProvider>
  );
}

type DialogProps = ComponentProps<typeof FileTreeMutationDialog>;

function renderDialog(
  overrides: Partial<DialogProps> = {},
) {
  const props: DialogProps = {
    busy: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    onReturnFocus: vi.fn(),
    request: {
      defaultValue: 'old.md',
      entryKind: 'file',
      mode: 'rename',
      path: 'E:/notes/old.md',
    },
    ...overrides,
  };

  return render(
    <I18nProvider>
      <FileTreeMutationDialog {...props} />
    </I18nProvider>,
  );
}
