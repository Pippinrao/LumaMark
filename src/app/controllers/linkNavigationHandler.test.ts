import { describe, expect, it, vi } from 'vitest';
import type { OpenDocumentOutcome } from '../../features/file-actions/useFileWorkflow';
import type { OutlineSnapshotOutcome } from '../../features/outline/useDebouncedOutline';
import type { OpenExternalUrlResult } from '../../services/opener/openerCommands';
import type { CommandResult } from '../../services/tauri/invokeCommand';
import {
  createLinkNavigationHandler,
  type LinkNavigationHandlerOptions,
} from './linkNavigationHandler';

function createOptions() {
  let currentDocumentPath: string | null = 'C:/notes/current.md';
  let dirty = false;
  const options: LinkNavigationHandlerOptions = {
    awaitCurrentOutlineSnapshot: vi.fn<
      () => Promise<OutlineSnapshotOutcome>
    >(async () => ({
      headings: [
        {
          from: 42,
          id: 'editor-core',
          level: 2,
          line: 5,
          text: 'Editor Core',
          to: 56,
        },
      ],
      revision: 1,
      status: 'current',
    })),
    getCurrentDocumentPath: () => currentDocumentPath,
    isCurrentDocumentDirty: () => dirty,
    isOutlineCurrent: () => true,
    openDocumentPath: vi.fn(async (path: string) => {
      currentDocumentPath = path;
      return {
        file: { name: 'guide.md', path },
        status: 'opened' as const,
      };
    }),
    openExternalUrl: vi.fn(async () => ({
      data: { opened: true as const },
      ok: true as const,
    })),
    reportError: vi.fn(),
    revealPosition: vi.fn(),
    supersedePendingDocumentOpen: vi.fn(),
  };

  return {
    options,
    setCurrentDocumentPath(path: string | null) {
      currentDocumentPath = path;
    },
    setDirty(nextDirty: boolean) {
      dirty = nextDirty;
    },
  };
}

describe('createLinkNavigationHandler', () => {
  it('awaits the current outline before revealing a same-document fragment', async () => {
    let release: ((outcome: OutlineSnapshotOutcome) => void) | undefined;
    const { options } = createOptions();
    options.awaitCurrentOutlineSnapshot = vi.fn(
      () =>
        new Promise<OutlineSnapshotOutcome>((resolve) => {
          release = resolve;
        }),
    );
    const navigate = createLinkNavigationHandler(options);

    const pending = navigate('#Editor%20Core');
    expect(options.revealPosition).not.toHaveBeenCalled();
    release?.({
      headings: [
        {
          from: 42,
          id: 'editor-core',
          level: 2,
          line: 5,
          text: 'Editor Core',
          to: 56,
        },
      ],
      revision: 2,
      status: 'current',
    });

    await expect(pending).resolves.toEqual({
      status: 'navigated',
      target: 'fragment',
    });
    expect(options.revealPosition).toHaveBeenCalledWith(42);
  });

  it('uses the canonical opened document path before revealing its fragment', async () => {
    const { options } = createOptions();
    options.openDocumentPath = vi.fn(async () => ({
      file: { name: 'Guide.md', path: 'C:/Notes/Guide.md' },
      status: 'opened' as const,
    }));
    options.getCurrentDocumentPath = () => 'c:\\notes\\guide.md';
    const navigate = createLinkNavigationHandler(options);

    await expect(navigate('./guide.md#Editor%20Core')).resolves.toEqual({
      status: 'navigated',
      target: 'fragment',
    });
    expect(options.revealPosition).toHaveBeenCalledWith(42);
  });

  it('navigates a relative self-file fragment without reloading the document', async () => {
    const { options } = createOptions();
    options.getCurrentDocumentPath = () => 'c:\\Notes\\CURRENT.md';
    const navigate = createLinkNavigationHandler(options);

    await expect(
      navigate('./current.md#Editor%20Core'),
    ).resolves.toEqual({
      status: 'navigated',
      target: 'fragment',
    });
    expect(options.openDocumentPath).not.toHaveBeenCalled();
    expect(options.revealPosition).toHaveBeenCalledWith(42);
  });

  it('treats UNC casing variants as the same document identity', async () => {
    const { options, setCurrentDocumentPath } = createOptions();
    setCurrentDocumentPath('\\\\Server\\Share\\Notes\\current.md');
    options.resolveRelativeLinkPath = vi.fn(
      () => '\\\\server\\share\\notes\\CURRENT.md',
    );
    const navigate = createLinkNavigationHandler(options);

    await expect(navigate('./current.md#editor-core')).resolves.toEqual({
      status: 'navigated',
      target: 'fragment',
    });

    expect(options.openDocumentPath).not.toHaveBeenCalled();
    expect(options.revealPosition).toHaveBeenCalledWith(42);
  });

  it('accepts a canonical UNC casing change before cross-document fragment reveal', async () => {
    const { options, setCurrentDocumentPath } = createOptions();
    setCurrentDocumentPath('\\\\server\\share\\notes\\current.md');
    options.resolveRelativeLinkPath = vi.fn(
      () => '\\\\server\\share\\notes\\guide.md',
    );
    options.openDocumentPath = vi.fn(async () => {
      setCurrentDocumentPath('\\\\SERVER\\SHARE\\NOTES\\GUIDE.md');
      return {
        file: {
          name: 'Guide.md',
          path: '\\\\Server\\Share\\Notes\\Guide.md',
        },
        status: 'opened' as const,
      };
    });
    const navigate = createLinkNavigationHandler(options);

    await expect(navigate('./guide.md#editor-core')).resolves.toEqual({
      status: 'navigated',
      target: 'fragment',
    });

    expect(options.openDocumentPath).toHaveBeenCalledOnce();
    expect(options.revealPosition).toHaveBeenCalledWith(42);
  });

  it('blocks a cross-document link while the current document is dirty', async () => {
    const { options, setDirty } = createOptions();
    setDirty(true);
    const navigate = createLinkNavigationHandler(options);

    await expect(navigate('./guide.md#Editor%20Core')).resolves.toEqual({
      code: 'link.unsavedChanges',
      status: 'blocked',
    });
    expect(options.reportError).toHaveBeenCalledWith('link.unsavedChanges');
    expect(options.openDocumentPath).not.toHaveBeenCalled();
    expect(options.revealPosition).not.toHaveBeenCalled();
  });

  it('rejects an outline snapshot that became stale after the waiter resolved', async () => {
    const { options } = createOptions();
    options.isOutlineCurrent = () => false;
    const navigate = createLinkNavigationHandler(options);

    await expect(navigate('#editor-core')).resolves.toEqual({
      reason: 'superseded',
      status: 'notNavigated',
      target: 'fragment',
    });
    expect(options.revealPosition).not.toHaveBeenCalled();
  });

  it('supersedes a pending fragment when another link request wins', async () => {
    let release: ((outcome: OutlineSnapshotOutcome) => void) | undefined;
    const { options } = createOptions();
    options.awaitCurrentOutlineSnapshot = vi.fn(
      () =>
        new Promise<OutlineSnapshotOutcome>((resolve) => {
          release = resolve;
        }),
    );
    const navigate = createLinkNavigationHandler(options);
    const pendingFragment = navigate('#editor-core');

    await expect(navigate('https://example.com')).resolves.toEqual({
      status: 'navigated',
      target: 'external',
    });
    release?.({
      headings: [],
      revision: 2,
      status: 'current',
    });
    await expect(pendingFragment).resolves.toEqual({
      reason: 'superseded',
      status: 'notNavigated',
      target: 'fragment',
    });
    expect(options.revealPosition).not.toHaveBeenCalled();
  });

  it('does not reveal after the current document identity changes', async () => {
    let release: ((outcome: OutlineSnapshotOutcome) => void) | undefined;
    const { options, setCurrentDocumentPath } = createOptions();
    options.awaitCurrentOutlineSnapshot = vi.fn(
      () =>
        new Promise<OutlineSnapshotOutcome>((resolve) => {
          release = resolve;
        }),
    );
    const navigate = createLinkNavigationHandler(options);
    const pending = navigate('#editor-core');
    setCurrentDocumentPath('C:/notes/other.md');
    release?.({
      headings: [],
      revision: 2,
      status: 'current',
    });

    await expect(pending).resolves.toEqual({
      reason: 'superseded',
      status: 'notNavigated',
      target: 'fragment',
    });
    expect(options.revealPosition).not.toHaveBeenCalled();
  });

  it('reports blocked and missing-fragment errors without side effects', async () => {
    const { options } = createOptions();
    const navigate = createLinkNavigationHandler(options);

    await expect(navigate('javascript:alert(1)')).resolves.toMatchObject({
      code: 'link.protocol_javascript',
      status: 'blocked',
    });
    await expect(navigate('#missing')).resolves.toEqual({
      code: 'link.fragmentUnavailable',
      status: 'blocked',
    });
    expect(options.reportError).toHaveBeenNthCalledWith(
      1,
      'link.protocol_javascript',
    );
    expect(options.reportError).toHaveBeenNthCalledWith(
      2,
      'link.fragmentUnavailable',
    );
    expect(options.openDocumentPath).not.toHaveBeenCalled();
    expect(options.openExternalUrl).not.toHaveBeenCalled();
    expect(options.revealPosition).not.toHaveBeenCalled();
  });

  it('silently supersedes a late external-opener result', async () => {
    let release: (() => void) | undefined;
    const { options } = createOptions();
    options.openExternalUrl = vi.fn(
      () =>
        new Promise<CommandResult<OpenExternalUrlResult>>((resolve) => {
          release = () => {
            resolve({
              error: {
                code: 'link.open_failed',
                message: 'late failure',
                recoverable: true,
              },
              ok: false as const,
            });
          };
        }),
    );
    const navigate = createLinkNavigationHandler(options);
    const first = navigate('https://example.com/slow');
    await navigate('#missing');
    release?.();

    await expect(first).resolves.toEqual({
      reason: 'superseded',
      status: 'notNavigated',
      target: 'external',
    });
    expect(options.reportError).not.toHaveBeenCalledWith('link.open_failed');
  });

  it('silently supersedes a late external result after invalidation', async () => {
    let release: (() => void) | undefined;
    const { options } = createOptions();
    options.openExternalUrl = vi.fn(
      () =>
        new Promise<CommandResult<OpenExternalUrlResult>>((resolve) => {
          release = () => {
            resolve({
              error: {
                code: 'link.open_failed',
                message: 'late failure',
                recoverable: true,
              },
              ok: false as const,
            });
          };
        }),
    );
    const navigate = createLinkNavigationHandler(options);
    const pending = navigate('https://example.com/slow');

    const invalidatable = navigate as typeof navigate & {
      invalidate?: () => void;
    };
    invalidatable.invalidate?.();
    release?.();

    await expect(pending).resolves.toEqual({
      reason: 'superseded',
      status: 'notNavigated',
      target: 'external',
    });
    expect(invalidatable.invalidate).toBeTypeOf('function');
    expect(options.reportError).not.toHaveBeenCalled();
  });

  it('silently supersedes a late document-open result after invalidation', async () => {
    let release: (() => void) | undefined;
    const { options } = createOptions();
    options.openDocumentPath = vi.fn(
      (path: string) =>
        new Promise<OpenDocumentOutcome>((resolve) => {
          release = () => {
            resolve({
              file: { name: 'guide.md', path },
              status: 'opened' as const,
            });
          };
        }),
    );
    const navigate = createLinkNavigationHandler(options);
    const pending = navigate('./guide.md');

    const invalidatable = navigate as typeof navigate & {
      invalidate?: () => void;
    };
    invalidatable.invalidate?.();
    release?.();

    await expect(pending).resolves.toEqual({
      reason: 'superseded',
      status: 'notNavigated',
      target: 'document',
    });
    expect(invalidatable.invalidate).toBeTypeOf('function');
    expect(options.reportError).not.toHaveBeenCalled();
    expect(options.supersedePendingDocumentOpen).toHaveBeenCalledTimes(2);
  });

  it('does not reveal a late fragment result after invalidation', async () => {
    let release: ((outcome: OutlineSnapshotOutcome) => void) | undefined;
    const { options } = createOptions();
    options.awaitCurrentOutlineSnapshot = vi.fn(
      () =>
        new Promise<OutlineSnapshotOutcome>((resolve) => {
          release = resolve;
        }),
    );
    const navigate = createLinkNavigationHandler(options);
    const pending = navigate('#editor-core');

    const invalidatable = navigate as typeof navigate & {
      invalidate?: () => void;
    };
    invalidatable.invalidate?.();
    release?.({
      headings: [
        {
          from: 42,
          id: 'editor-core',
          level: 2,
          line: 5,
          text: 'Editor Core',
          to: 56,
        },
      ],
      revision: 2,
      status: 'current',
    });

    await expect(pending).resolves.toEqual({
      reason: 'superseded',
      status: 'notNavigated',
      target: 'fragment',
    });
    expect(invalidatable.invalidate).toBeTypeOf('function');
    expect(options.revealPosition).not.toHaveBeenCalled();
    expect(options.reportError).not.toHaveBeenCalled();
  });

  it('keeps an allowed document open alive when later links are blocked before navigation', async () => {
    let releaseOpen:
      | ((outcome: Awaited<ReturnType<LinkNavigationHandlerOptions['openDocumentPath']>>) => void)
      | undefined;
    const { options } = createOptions();
    options.openDocumentPath = vi.fn(
      () =>
        new Promise<OpenDocumentOutcome>((resolve) => {
          releaseOpen = resolve;
        }),
    );
    const navigate = createLinkNavigationHandler(options);

    const pendingOpen = navigate('./older.md');
    await expect(navigate('javascript:alert(1)')).resolves.toMatchObject({
      status: 'blocked',
    });
    await expect(navigate('data:text/plain,boom')).resolves.toMatchObject({
      status: 'blocked',
    });
    await expect(navigate('file:///C:/secret.md')).resolves.toMatchObject({
      status: 'blocked',
    });
    await expect(navigate('#bad%E0%A4%A')).resolves.toEqual({
      code: 'link.fragmentUnavailable',
      status: 'blocked',
    });

    expect(options.supersedePendingDocumentOpen).toHaveBeenCalledTimes(1);

    releaseOpen?.({
      file: { name: 'older.md', path: 'E:/notes/older.md' },
      status: 'opened',
    });
    await expect(pendingOpen).resolves.toEqual({
      status: 'navigated',
      target: 'document',
    });

    expect(options.openDocumentPath).toHaveBeenCalledTimes(1);
    expect(options.supersedePendingDocumentOpen).toHaveBeenCalledTimes(1);
  });
});
