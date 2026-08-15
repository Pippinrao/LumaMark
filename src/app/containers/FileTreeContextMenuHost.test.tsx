import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FileTreeContextTarget } from '../../features/commands/createCommandModels';
import type { CommandMenuNode } from '../../features/commands/commandTypes';
import { FileTreeContextMenuHost } from './FileTreeContextMenuHost';

afterEach(() => cleanup());

function TargetFixture({
  onContextMenuTarget,
}: {
  onContextMenuTarget?: (target: FileTreeContextTarget | null) => void;
}) {
  return (
    <div>
      <button
        onContextMenuCapture={() => onContextMenuTarget?.(null)}
        type="button"
      >
        sidebar control
      </button>
      <button
        onContextMenuCapture={() =>
          onContextMenuTarget?.({
            kind: 'file',
            name: 'note.md',
            path: 'E:/notes/note.md',
          })
        }
        type="button"
      >
        file row
      </button>
    </div>
  );
}

const nodes: CommandMenuNode[] = [
  {
    id: 'copy-path',
    invocation: {
      action: 'fileTreeCopyPath',
      kind: 'payloadAction',
      payload: { path: 'E:/notes/note.md' },
    },
    label: 'Copy path',
    type: 'item',
  },
];

describe('FileTreeContextMenuHost', () => {
  it('does not open an empty root menu for non-tree targets', async () => {
    render(
      <FileTreeContextMenuHost
        getContextMenuNodes={() => nodes}
        onInvoke={vi.fn()}
      >
        <TargetFixture />
      </FileTreeContextMenuHost>,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'sidebar control' }));

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('opens the menu for an exact file-tree target', async () => {
    const getContextMenuNodes = vi.fn(() => nodes);
    render(
      <FileTreeContextMenuHost
        getContextMenuNodes={getContextMenuNodes}
        onInvoke={vi.fn()}
      >
        <TargetFixture />
      </FileTreeContextMenuHost>,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'file row' }));

    expect(
      await screen.findByRole('menuitem', { name: 'Copy path' }),
    ).toBeVisible();
    expect(getContextMenuNodes).toHaveBeenCalledWith({
      kind: 'file',
      name: 'note.md',
      path: 'E:/notes/note.md',
    });
  });
});
