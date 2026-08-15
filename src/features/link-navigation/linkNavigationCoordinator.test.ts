import { describe, expect, it, vi } from 'vitest';
import {
  navigateLink,
  type LinkNavigationPorts,
} from './linkNavigationCoordinator';

const openedDocumentOutcome = {
  file: {
    name: 'guide.md',
    path: 'C:/notes/guide.md',
  },
  status: 'opened',
} as const;

const openedExternalOutcome = {
  data: { opened: true },
  ok: true,
} as const;

const fragmentMissing = async () => ({ status: 'missing' as const });
const fragmentNavigated = async () => ({ status: 'navigated' as const });

describe('navigateLink', () => {
  it('opens an allowed absolute link through the external opener only', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: 'https://example.com/docs',
        kind: 'absoluteAllowed' as const,
      })),
      navigateFragment: vi.fn(fragmentMissing),
      openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => null),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: 'https://example.com/docs',
        },
        ports,
      ),
    ).resolves.toEqual({
      status: 'navigated',
      target: 'external',
    });
    expect(ports.openExternalUrl).toHaveBeenCalledOnce();
    expect(ports.openExternalUrl).toHaveBeenCalledWith(
      'https://example.com/docs',
    );
    expect(ports.openDocumentPath).not.toHaveBeenCalled();
    expect(ports.navigateFragment).not.toHaveBeenCalled();
  });

  it('returns the external opener error without falling through to another target', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: 'https://example.com/docs',
        kind: 'absoluteAllowed' as const,
      })),
      navigateFragment: vi.fn(fragmentMissing),
      openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
      openExternalUrl: vi.fn(async () => ({
        error: {
          code: 'opener.unavailable',
          message: 'The external opener is unavailable.',
          recoverable: true,
        },
        ok: false as const,
      })),
      resolveRelativeLinkPath: vi.fn(() => null),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: 'https://example.com/docs',
        },
        ports,
      ),
    ).resolves.toEqual({
      code: 'opener.unavailable',
      status: 'failed',
    });
    expect(ports.openDocumentPath).not.toHaveBeenCalled();
    expect(ports.navigateFragment).not.toHaveBeenCalled();
  });

  it('blocks a rejected link without invoking any navigation side effect', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        code: 'link.protocol_javascript' as const,
        href: 'javascript:alert(1)',
        kind: 'rejected' as const,
      })),
      navigateFragment: vi.fn(fragmentMissing),
      openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => null),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: 'javascript:alert(1)',
        },
        ports,
      ),
    ).resolves.toEqual({
      code: 'link.protocol_javascript' as const,
      status: 'blocked',
    });
    expect(ports.openExternalUrl).not.toHaveBeenCalled();
    expect(ports.openDocumentPath).not.toHaveBeenCalled();
    expect(ports.navigateFragment).not.toHaveBeenCalled();
  });

  it('navigates a same-document fragment without opening a path', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: '#editor-core',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(fragmentNavigated),
      openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => null),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: '#editor-core',
        },
        ports,
      ),
    ).resolves.toEqual({
      status: 'navigated',
      target: 'fragment',
    });
    expect(ports.navigateFragment).toHaveBeenCalledOnce();
    expect(ports.navigateFragment).toHaveBeenCalledWith({
      expectedDocumentPath: 'C:/notes/current.md',
      fragment: 'editor-core',
    });
    expect(ports.resolveRelativeLinkPath).not.toHaveBeenCalled();
    expect(ports.openDocumentPath).not.toHaveBeenCalled();
    expect(ports.openExternalUrl).not.toHaveBeenCalled();
  });

  it('decodes a same-document fragment before requesting navigation', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: '#Editor%20Core',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(async ({ fragment }) => ({
        status: fragment === 'Editor Core' ? 'navigated' : 'missing',
      } as const)),
      openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => null),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: '#Editor%20Core',
        },
        ports,
      ),
    ).resolves.toEqual({
      status: 'navigated',
      target: 'fragment',
    });
    expect(ports.navigateFragment).toHaveBeenCalledWith({
      expectedDocumentPath: 'C:/notes/current.md',
      fragment: 'Editor Core',
    });
  });

  it('blocks a malformed encoded fragment without throwing or navigating', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: '#bad%E0%A4%A',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(fragmentNavigated),
      openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => null),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: '#bad%E0%A4%A',
        },
        ports,
      ),
    ).resolves.toEqual({
      code: 'link.fragmentUnavailable',
      status: 'blocked',
    });
    expect(ports.navigateFragment).not.toHaveBeenCalled();
    expect(ports.resolveRelativeLinkPath).not.toHaveBeenCalled();
  });

  it('reports a missing same-document fragment without treating it as a file path', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: '#missing-section',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(fragmentMissing),
      openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => 'C:/notes/current.md'),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: '#missing-section',
        },
        ports,
      ),
    ).resolves.toEqual({
      code: 'link.fragmentUnavailable',
      status: 'blocked',
    });
    expect(ports.resolveRelativeLinkPath).not.toHaveBeenCalled();
    expect(ports.openDocumentPath).not.toHaveBeenCalled();
    expect(ports.openExternalUrl).not.toHaveBeenCalled();
  });

  it('resolves and opens a relative document link through the file workflow', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: './guide.md',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(fragmentMissing),
      openDocumentPath: vi.fn(async () => openedDocumentOutcome),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => 'C:/notes/guide.md'),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: './guide.md',
        },
        ports,
      ),
    ).resolves.toEqual({
      status: 'navigated',
      target: 'document',
    });
    expect(ports.resolveRelativeLinkPath).toHaveBeenCalledOnce();
    expect(ports.resolveRelativeLinkPath).toHaveBeenCalledWith(
      './guide.md',
      'C:/notes/current.md',
    );
    expect(ports.openDocumentPath).toHaveBeenCalledOnce();
    expect(ports.openDocumentPath).toHaveBeenCalledWith('C:/notes/guide.md');
    expect(ports.navigateFragment).not.toHaveBeenCalled();
    expect(ports.openExternalUrl).not.toHaveBeenCalled();
  });

  it('treats focusing an existing document window as successful navigation', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: './guide.md',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(fragmentMissing),
      openDocumentPath: vi.fn(async () => ({
        status: 'focused' as const,
        windowLabel: 'document-2',
      })),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => 'C:/notes/guide.md'),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: './guide.md',
        },
        ports,
      ),
    ).resolves.toEqual({
      status: 'navigated',
      target: 'document',
    });
    expect(ports.navigateFragment).not.toHaveBeenCalled();
  });

  it('opens a relative document before navigating its decoded fragment', async () => {
    const callOrder: string[] = [];
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: './guide.md#Install%20Steps',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(async ({ fragment }) => {
        callOrder.push(`fragment:${fragment}`);
        return { status: 'navigated' as const };
      }),
      openDocumentPath: vi.fn(async () => {
        callOrder.push('document');
        return openedDocumentOutcome;
      }),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => 'C:/notes/guide.md'),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: './guide.md#Install%20Steps',
        },
        ports,
      ),
    ).resolves.toEqual({
      status: 'navigated',
      target: 'fragment',
    });
    expect(ports.resolveRelativeLinkPath).toHaveBeenCalledWith(
      './guide.md#Install%20Steps',
      'C:/notes/current.md',
    );
    expect(ports.openDocumentPath).toHaveBeenCalledWith('C:/notes/guide.md');
    expect(ports.navigateFragment).toHaveBeenCalledWith({
      expectedDocumentPath: 'C:/notes/guide.md',
      fragment: 'Install Steps',
    });
    expect(callOrder).toEqual(['document', 'fragment:Install Steps']);
  });

  it('reports an unavailable fragment after the relative document opened', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: './guide.md#missing',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(fragmentMissing),
      openDocumentPath: vi.fn(async () => openedDocumentOutcome),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => 'C:/notes/guide.md'),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: './guide.md#missing',
        },
        ports,
      ),
    ).resolves.toEqual({
      code: 'link.fragmentUnavailable',
      status: 'failed',
    });
    expect(ports.openDocumentPath).toHaveBeenCalledOnce();
    expect(ports.navigateFragment).toHaveBeenCalledWith({
      expectedDocumentPath: 'C:/notes/guide.md',
      fragment: 'missing',
    });
  });

  it('awaits fragment navigation and checks the canonical opened document path', async () => {
    const ports = {
      classifyLinkUrl: vi.fn(() => ({
        href: './guide.md#missing',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(async () => ({ status: 'missing' as const })),
      openDocumentPath: vi.fn(async () => ({
        file: {
          name: 'Guide.md',
          path: 'C:/Notes/Guide.md',
        },
        status: 'opened' as const,
      })),
      openExternalUrl: vi.fn(async () => ({
        data: { opened: true as const },
        ok: true as const,
      })),
      resolveRelativeLinkPath: vi.fn(() => 'C:/notes/guide.md'),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: './guide.md#missing',
        },
        ports,
      ),
    ).resolves.toEqual({
      code: 'link.fragmentUnavailable',
      status: 'failed',
    });
    expect(ports.navigateFragment).toHaveBeenCalledWith({
      expectedDocumentPath: 'C:/Notes/Guide.md',
      fragment: 'missing',
    });
  });

  it('reports a superseded fragment wait without claiming navigation', async () => {
    const ports = {
      classifyLinkUrl: vi.fn(() => ({
        href: './guide.md#install',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(async () => ({ status: 'superseded' as const })),
      openDocumentPath: vi.fn(async () => ({
        file: {
          name: 'guide.md',
          path: 'C:/notes/guide.md',
        },
        status: 'opened' as const,
      })),
      openExternalUrl: vi.fn(async () => ({
        data: { opened: true as const },
        ok: true as const,
      })),
      resolveRelativeLinkPath: vi.fn(() => 'C:/notes/guide.md'),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: './guide.md#install',
        },
        ports,
      ),
    ).resolves.toEqual({
      reason: 'superseded',
      status: 'notNavigated',
      target: 'fragment',
    });
  });

  it('blocks a malformed cross-document fragment before opening the document', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: './guide.md#bad%E0%A4%A',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(fragmentNavigated),
      openDocumentPath: vi.fn(async () => openedDocumentOutcome),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => 'C:/notes/guide.md'),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: 'C:/notes/current.md',
          href: './guide.md#bad%E0%A4%A',
        },
        ports,
      ),
    ).resolves.toEqual({
      code: 'link.fragmentUnavailable',
      status: 'blocked',
    });
    expect(ports.resolveRelativeLinkPath).not.toHaveBeenCalled();
    expect(ports.openDocumentPath).not.toHaveBeenCalled();
    expect(ports.navigateFragment).not.toHaveBeenCalled();
  });

  it('blocks a relative link when no filesystem path can be resolved', async () => {
    const ports: LinkNavigationPorts = {
      classifyLinkUrl: vi.fn(() => ({
        href: './guide.md',
        kind: 'relative' as const,
      })),
      navigateFragment: vi.fn(fragmentMissing),
      openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
      openExternalUrl: vi.fn(async () => openedExternalOutcome),
      resolveRelativeLinkPath: vi.fn(() => null),
    };

    await expect(
      navigateLink(
        {
          currentDocumentPath: null,
          href: './guide.md',
        },
        ports,
      ),
    ).resolves.toEqual({
      code: 'link.relativeUnavailable',
      status: 'blocked',
    });
    expect(ports.resolveRelativeLinkPath).toHaveBeenCalledWith(
      './guide.md',
      null,
    );
    expect(ports.openDocumentPath).not.toHaveBeenCalled();
    expect(ports.navigateFragment).not.toHaveBeenCalled();
    expect(ports.openExternalUrl).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'failed', 'superseded'] as const)(
    'preserves a %s file-workflow outcome without reporting navigation',
    async (reason) => {
      const ports: LinkNavigationPorts = {
        classifyLinkUrl: vi.fn(() => ({
          href: './guide.md',
          kind: 'relative' as const,
        })),
        navigateFragment: vi.fn(fragmentMissing),
        openDocumentPath: vi.fn(async () => ({ status: reason })),
        openExternalUrl: vi.fn(async () => openedExternalOutcome),
        resolveRelativeLinkPath: vi.fn(() => 'C:/notes/guide.md'),
      };

      await expect(
        navigateLink(
          {
            currentDocumentPath: 'C:/notes/current.md',
            href: './guide.md',
          },
          ports,
        ),
      ).resolves.toEqual({
        reason,
        status: 'notNavigated',
        target: 'document',
      });
      expect(ports.navigateFragment).not.toHaveBeenCalled();
      expect(ports.openExternalUrl).not.toHaveBeenCalled();
    },
  );

  it.each(['cancelled', 'failed', 'superseded'] as const)(
    'does not navigate a cross-document fragment after a %s file outcome',
    async (reason) => {
      const ports: LinkNavigationPorts = {
        classifyLinkUrl: vi.fn(() => ({
          href: './guide.md#install',
          kind: 'relative' as const,
        })),
        navigateFragment: vi.fn(fragmentNavigated),
        openDocumentPath: vi.fn(async () => ({ status: reason })),
        openExternalUrl: vi.fn(async () => openedExternalOutcome),
        resolveRelativeLinkPath: vi.fn(() => 'C:/notes/guide.md'),
      };

      await expect(
        navigateLink(
          {
            currentDocumentPath: 'C:/notes/current.md',
            href: './guide.md#install',
          },
          ports,
        ),
      ).resolves.toEqual({
        reason,
        status: 'notNavigated',
        target: 'document',
      });
      expect(ports.navigateFragment).not.toHaveBeenCalled();
      expect(ports.openExternalUrl).not.toHaveBeenCalled();
    },
  );
});
