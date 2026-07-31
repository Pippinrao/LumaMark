import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import type { EditorDocumentSnapshot } from '../../editor/core/editorApi';
import type {
  FileWatchChangeEvent,
  FileWatchClient,
} from '../../services/file-watch/fileWatchClient';
import type { FileActionState } from './fileActions';
import {
  areWatchedPathsEqual,
  useExternalFileWatch,
} from './useExternalFileWatch';

type TestEditorDocumentPort = Omit<
  EditorDocumentPort,
  'captureSnapshot' | 'isSnapshotCurrent' | 'serializeText'
> &
  Partial<
    Pick<
      EditorDocumentPort,
      'captureSnapshot' | 'isSnapshotCurrent' | 'serializeText'
    >
  >;

function withSnapshotMethods(
  editor: TestEditorDocumentPort,
): EditorDocumentPort {
  return {
    ...editor,
    captureSnapshot:
      editor.captureSnapshot ??
      (() => ({ serializedText: editor.getText() })),
    isSnapshotCurrent:
      editor.isSnapshotCurrent ??
      ((snapshot: EditorDocumentSnapshot) =>
        snapshot.serializedText === editor.getText()),
    serializeText: editor.serializeText ?? editor.getText,
  };
}

describe('useExternalFileWatch', () => {
  afterEach(() => {
    delete window.__LUMAMARK_E2E_FILE_COMMANDS__;
  });

  it('compares Windows drive paths case-insensitively without changing Unix semantics', () => {
    expect(
      areWatchedPathsEqual(
        'E:\\Notes\\Draft.md',
        'e:/notes/draft.md',
      ),
    ).toBe(true);
    expect(
      areWatchedPathsEqual('/notes/Readme.md', '/notes/readme.md'),
    ).toBe(false);
  });

  it('turns a rejected event subscription into a stable recoverable file error', async () => {
    const state = createState();
    const fileWatch = createFileWatchClient({
      listen: vi.fn().mockRejectedValue(new Error('Event bridge unavailable.')),
    });

    render(
      <ExternalFileWatchHarness
        fileWatch={fileWatch}
        state={state}
      />,
    );

    await waitFor(() => {
      expect(state.getState().lastFileError).toMatchObject({
        code: 'file.watch_error',
        recoverable: true,
      });
    });
  });

  it('rechecks disk content after installing the watcher to close the open-watch race', async () => {
    const path = 'E:/notes/race.md';
    const loadText = vi.fn();
    const state = createState();
    let model: ReturnType<typeof useExternalFileWatch> | undefined;
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 22,
          path,
          text: '# Changed during watch',
        },
      }),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    };

    render(
      <ExternalFileWatchHarness
        editor={{
          focus: vi.fn(),
          getText: vi.fn(() => '# Initially opened'),
          loadText,
          markSaved: vi.fn(),
          markUnsaved: vi.fn(),
          setContext: vi.fn(),
        }}
        fileWatch={createFileWatchClient({
          watchDocument: vi.fn().mockResolvedValue({
            ok: true,
            data: { fingerprint: 'sha256:after-watch' },
          }),
        })}
        onModel={(value) => {
          model = value;
        }}
        state={state}
      />,
    );

    await act(async () => {
      await model?.replaceWatchedDocument(path, 'sha256:opened');
    });

    expect(loadText).toHaveBeenCalledWith('# Changed during watch', {
      preserveView: true,
    });
  });

  it('compares watcher reads with exact serialized source instead of normalized editor text', async () => {
    const path = 'E:/notes/crlf.md';
    const loadText = vi.fn();
    let model: ReturnType<typeof useExternalFileWatch> | undefined;
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 15,
          path,
          text: '# First\r\nSecond',
        },
      }),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    };

    render(
      <ExternalFileWatchHarness
        editor={{
          focus: vi.fn(),
          getText: vi.fn(() => '# First\nSecond'),
          loadText,
          markSaved: vi.fn(),
          markUnsaved: vi.fn(),
          serializeText: vi.fn(() => '# First\r\nSecond'),
          setContext: vi.fn(),
        }}
        fileWatch={createFileWatchClient({
          watchDocument: vi.fn().mockResolvedValue({
            ok: true,
            data: { fingerprint: 'sha256:after-watch' },
          }),
        })}
        onModel={(value) => {
          model = value;
        }}
        state={createState()}
      />,
    );

    await act(async () => {
      await model?.replaceWatchedDocument(path, 'sha256:opened');
    });

    expect(loadText).not.toHaveBeenCalled();
  });

  it('does not reread the document when the open and watch fingerprints match', async () => {
    const path = 'E:/notes/stable.md';
    const readText = vi.fn();
    let model: ReturnType<typeof useExternalFileWatch> | undefined;
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText,
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    };

    render(
      <ExternalFileWatchHarness
        fileWatch={createFileWatchClient({
          watchDocument: vi.fn().mockResolvedValue({
            ok: true,
            data: { fingerprint: 'sha256:stable' },
          }),
        })}
        onModel={(value) => {
          model = value;
        }}
        state={createState()}
      />,
    );

    await act(async () => {
      await model?.replaceWatchedDocument(path, 'sha256:stable');
    });

    expect(readText).not.toHaveBeenCalled();
  });

  it('accepts a new document event emitted before the watch command resolves', async () => {
    const path = 'E:/notes/watch-window.md';
    const loadText = vi.fn();
    let listener: ((event: FileWatchChangeEvent) => void) | undefined;
    let model: ReturnType<typeof useExternalFileWatch> | undefined;
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (nextListener) => {
        listener = nextListener;
        return () => undefined;
      }),
      watchDocument: vi.fn(async () => {
        listener?.({
          fingerprint: 'sha256:changed-after-baseline',
          kind: 'document',
          path,
          revision: 1,
        });
        return {
          ok: true as const,
          data: { fingerprint: 'sha256:opened' },
        };
      }),
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 21,
          path,
          text: '# Changed after baseline',
        },
      }),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    };

    render(
      <ExternalFileWatchHarness
        editor={{
          focus: vi.fn(),
          getText: vi.fn(() => '# Initially opened'),
          loadText,
          markSaved: vi.fn(),
          markUnsaved: vi.fn(),
          setContext: vi.fn(),
        }}
        fileWatch={fileWatch}
        onModel={(value) => {
          model = value;
        }}
        state={createState()}
      />,
    );
    await waitFor(() => expect(listener).toBeTypeOf('function'));

    await act(async () => {
      await model?.replaceWatchedDocument(path, 'sha256:opened');
    });

    await waitFor(() => {
      expect(loadText).toHaveBeenCalledWith('# Changed after baseline', {
        preserveView: true,
      });
    });
  });

  it('ignores an older watcher revision delivered after a newer change', async () => {
    const path = 'E:/notes/reordered.md';
    let listener: ((event: FileWatchChangeEvent) => void) | undefined;
    let editorText = '# Initially opened';
    let model: ReturnType<typeof useExternalFileWatch> | undefined;
    const state = createState();
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 8,
          path,
          text: '# Newest',
        },
      }),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    };

    render(
      <ExternalFileWatchHarness
        editor={{
          focus: vi.fn(),
          getText: () => editorText,
          loadText: (text) => {
            editorText = text;
          },
          markSaved: vi.fn(),
          markUnsaved: vi.fn(),
          setContext: vi.fn(),
        }}
        fileWatch={createFileWatchClient({
          listen: vi.fn(async (nextListener) => {
            listener = nextListener;
            return () => undefined;
          }),
        })}
        onModel={(value) => {
          model = value;
        }}
        state={state}
      />,
    );
    await waitFor(() => expect(listener).toBeTypeOf('function'));
    await act(async () => {
      await model?.replaceWatchedDocument(path);
    });
    act(() => {
      listener?.({
        fingerprint: 'sha256:newest',
        kind: 'document',
        path,
        revision: 2,
      });
    });
    await waitFor(() => expect(editorText).toBe('# Newest'));

    act(() => {
      listener?.({
        fingerprint: null,
        kind: 'removed',
        path,
        revision: 1,
      });
    });

    expect(state.getState().lastFileError).toBeNull();
    expect(state.getState().dirty).toBe(false);
  });
});

function ExternalFileWatchHarness({
  editor,
  fileWatch,
  onModel,
  state,
}: {
  editor?: TestEditorDocumentPort;
  fileWatch: FileWatchClient;
  onModel?: (model: ReturnType<typeof useExternalFileWatch>) => void;
  state: ReturnType<typeof createState>;
}) {
  const model = useExternalFileWatch({
    editorRef: {
      current: withSnapshotMethods(
        editor ?? {
          focus: vi.fn(),
          getText: vi.fn(),
          loadText: vi.fn(),
          markSaved: vi.fn(),
          markUnsaved: vi.fn(),
          setContext: vi.fn(),
        },
      ),
    },
    fileWatch,
    onDocumentBecameSafe: vi.fn(),
    onLocalImageChanged: vi.fn(),
    state,
    status: { setStatusKey: vi.fn() },
  });
  onModel?.(model);

  return null;
}

function createFileWatchClient(
  overrides: Partial<FileWatchClient> = {},
): FileWatchClient {
  return {
    listen: vi.fn().mockResolvedValue(() => undefined),
    replaceLocalImageTargets: vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    }),
    unwatchDocument: vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    }),
    watchDocument: vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    }),
    ...overrides,
  };
}

function createState() {
  let current: FileActionState = {
    currentFile: null,
    dirty: false,
    dirtyRevision: 0,
    lastFileError: null,
  };

  return {
    getState: () => current,
    setCurrentFile: vi.fn((currentFile: FileActionState['currentFile']) => {
      current = { ...current, currentFile };
    }),
    setDirty: vi.fn((dirty: boolean) => {
      current = { ...current, dirty };
    }),
    setLastFileError: vi.fn((lastFileError: FileActionState['lastFileError']) => {
      current = { ...current, lastFileError };
    }),
  };
}
