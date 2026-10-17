import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import type { PackageCommandClient } from '../../services/packages/packageCommandClient';
import type { OpenDocumentOutcome } from '../file-actions/useFileWorkflow';
import { usePackageWorkflow } from './usePackageWorkflow';

const session = {
  entryName: 'note.md',
  entryPath: 'E:/cache/pkg/note.md',
  sessionDir: 'E:/cache/pkg',
  zipName: 'bundle.zip',
  zipPath: 'E:/notes/bundle.zip',
};

function createCommands(overrides: Partial<PackageCommandClient> = {}) {
  return {
    extract: vi.fn(async () => ({
      data: {
        entryPath: 'E:/out/bundle/note.md',
        outputDirectory: 'E:/out/bundle',
      },
      ok: true as const,
    })),
    open: vi.fn(),
    showExtractDialog: vi.fn(async () => ({ data: 'E:/out', ok: true as const })),
    ...overrides,
  } satisfies PackageCommandClient;
}

function renderWorkflow({
  commands = createCommands(),
  currentSession = session as typeof session | null,
  openPath = vi.fn(async () => ({
    file: { name: 'note.md', path: 'E:/out/bundle/note.md' },
    status: 'opened' as const,
  })),
}: {
  commands?: PackageCommandClient;
  currentSession?: typeof session | null;
  openPath?: (path: string, allowDirty?: boolean) => Promise<OpenDocumentOutcome>;
} = {}) {
  const editor = { setDisplayMode: vi.fn() } as unknown as EditorDocumentPort;
  const documentPortRef = {
    current: editor,
  } as RefObject<EditorDocumentPort | null>;
  const setLastFileError = vi.fn();
  const setStatusKey = vi.fn();
  const { result } = renderHook(() =>
    usePackageWorkflow({
      commandClient: commands,
      defaultDisplayMode: 'livePreview',
      documentPortRef,
      openPath,
      session: currentSession,
      setLastFileError,
      setStatusKey,
    }),
  );

  return {
    commands,
    editor,
    openPath,
    result,
    setLastFileError,
    setStatusKey,
  };
}

describe('usePackageWorkflow', () => {
  it('does nothing without a package session', async () => {
    const context = renderWorkflow({ currentSession: null });

    await act(async () => {
      await context.result.current.unpackPackage();
    });

    expect(context.commands.showExtractDialog).not.toHaveBeenCalled();
    expect(context.openPath).not.toHaveBeenCalled();
  });

  it('stops when the folder dialog is cancelled', async () => {
    const commands = createCommands({
      showExtractDialog: vi.fn(async () => ({ data: null, ok: true as const })),
    });
    const context = renderWorkflow({ commands });

    await act(async () => {
      await context.result.current.unpackPackage();
    });

    expect(context.commands.extract).not.toHaveBeenCalled();
    expect(context.openPath).not.toHaveBeenCalled();
  });

  it('unpacks and opens the extracted entry as a normal document', async () => {
    const context = renderWorkflow();

    await act(async () => {
      await context.result.current.unpackPackage();
    });

    expect(context.commands.extract).toHaveBeenCalledWith(
      'E:/notes/bundle.zip',
      'E:/out',
    );
    expect(context.editor.setDisplayMode).toHaveBeenCalledWith('livePreview');
    expect(context.openPath).toHaveBeenCalledWith(
      'E:/out/bundle/note.md',
      true,
    );
    expect(context.setStatusKey).toHaveBeenLastCalledWith(
      'status.packageExtracted',
    );
  });

  it('reports extraction failures without opening a document', async () => {
    const commands = createCommands({
      extract: vi.fn(async () => ({
        error: {
          code: 'package.target_not_empty',
          message: 'exists',
          recoverable: true,
        },
        ok: false as const,
      })),
    });
    const context = renderWorkflow({ commands });

    await act(async () => {
      await context.result.current.unpackPackage();
    });

    expect(context.setLastFileError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'package.target_not_empty' }),
    );
    expect(context.openPath).not.toHaveBeenCalled();
  });
});
