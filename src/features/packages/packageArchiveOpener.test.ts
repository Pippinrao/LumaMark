import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import type { PackageCommandClient } from '../../services/packages/packageCommandClient';
import type { FileActionStateAdapter } from '../file-actions/fileActions';
import type { OpenDocumentOutcome } from '../file-actions/useFileWorkflow';
import { createPackageArchiveOpener } from './packageArchiveOpener';

function createState(dirty = false) {
  let packageSession: unknown = null;
  const adapter = {
    getState: () => ({
      currentFile: null,
      dirty,
      dirtyRevision: 0,
      lastFileError: null,
      readOnlyDocument: false,
    }),
    setCurrentFile: vi.fn(),
    setDirty: vi.fn(),
    setLastFileError: vi.fn(),
    setPackageSession: vi.fn((session) => {
      packageSession = session;
    }),
  } satisfies FileActionStateAdapter;
  return {
    adapter,
    getPackageSession: () => packageSession,
  };
}

function createEditor() {
  return {
    setDisplayMode: vi.fn(),
    setDocumentReadOnly: vi.fn(),
  } as unknown as EditorDocumentPort;
}

function createCommands(overrides: Partial<PackageCommandClient> = {}) {
  return {
    extract: vi.fn(),
    open: vi.fn(async () => ({
      data: {
        entryName: 'note.md',
        entryPath: 'E:/cache/pkg/note.md',
        resourceCount: 1,
        reusedSession: false,
        sessionDir: 'E:/cache/pkg',
        zipPath: 'E:/notes/bundle.zip',
      },
      ok: true as const,
    })),
    showExtractDialog: vi.fn(),
    ...overrides,
  } satisfies PackageCommandClient;
}

function createOpener({
  commands = createCommands(),
  dirty = false,
  openPath = vi.fn(async () => ({
    file: { name: 'note.md', path: 'E:/cache/pkg/note.md' },
    status: 'opened' as const,
  })),
}: {
  commands?: PackageCommandClient;
  dirty?: boolean;
  openPath?: (
    path: string,
    allowDirty?: boolean,
    options?: unknown,
  ) => Promise<OpenDocumentOutcome>;
} = {}) {
  const editor = createEditor();
  const { adapter, getPackageSession } = createState(dirty);
  const status = { setStatusKey: vi.fn() };
  const setFileOpening = vi.fn();
  const opener = createPackageArchiveOpener({
    commandClient: commands,
    editorRef: {
      current: editor,
    } as RefObject<EditorDocumentPort | null>,
    openPath,
    recentFiles: { addRecentFile: vi.fn() },
    setFileOpening,
    state: adapter,
    status,
  });

  return {
    commands,
    editor,
    getPackageSession,
    openPath,
    opener,
    setFileOpening,
    state: adapter,
    status,
  };
}

describe('createPackageArchiveOpener', () => {
  it('opens the extracted entry read-only and records the package session', async () => {
    const context = createOpener();

    const outcome = await context.opener('E:/notes/bundle.zip');

    expect(outcome).toMatchObject({
      sessionPath: 'E:/notes/bundle.zip',
      status: 'opened',
    });
    expect(context.openPath).toHaveBeenCalledWith(
      'E:/cache/pkg/note.md',
      true,
      {
        recentFile: {
          name: 'bundle.zip',
          path: 'E:/notes/bundle.zip',
        },
      },
    );
    expect(context.editor.setDocumentReadOnly).toHaveBeenCalledWith(true);
    expect(context.editor.setDisplayMode).toHaveBeenCalledWith('reading');
    expect(context.getPackageSession()).toMatchObject({
      entryPath: 'E:/cache/pkg/note.md',
      zipName: 'bundle.zip',
      zipPath: 'E:/notes/bundle.zip',
    });
    expect(context.setFileOpening).toHaveBeenLastCalledWith(false);
  });

  it('does not open anything while the document is dirty', async () => {
    const context = createOpener({ dirty: true });

    await expect(
      context.opener('E:/notes/bundle.zip'),
    ).resolves.toEqual({ status: 'superseded' });
    expect(context.commands.open).not.toHaveBeenCalled();
    expect(context.openPath).not.toHaveBeenCalled();
  });

  it('reports package failures without changing the current document', async () => {
    const commands = createCommands({
      open: vi.fn(async () => ({
        error: {
          code: 'package.invalid_zip',
          message: 'bad zip',
          recoverable: false,
        },
        ok: false as const,
      })),
    });
    const context = createOpener({ commands });

    await expect(
      context.opener('E:/notes/bundle.zip'),
    ).resolves.toEqual({ status: 'failed' });
    expect(context.openPath).not.toHaveBeenCalled();
    expect(context.state.setLastFileError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'package.invalid_zip' }),
    );
    expect(context.getPackageSession()).toBeNull();
  });
});
