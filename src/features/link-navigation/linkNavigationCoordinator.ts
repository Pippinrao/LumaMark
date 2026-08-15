import type { LinkUrlClassification } from '../../services/opener/linkUrlClassification';
import type { OpenExternalUrlResult } from '../../services/opener/openerCommands';
import type { CommandResult } from '../../services/tauri/invokeCommand';

export type FragmentNavigationRequest = {
  expectedDocumentPath: string | null;
  fragment: string;
};

export type FragmentNavigationOutcome = {
  status: 'missing' | 'navigated' | 'superseded';
};

export type LinkDocumentOpenOutcome =
  | { file: { path: string }; status: 'opened' }
  | { code: string; status: 'blocked' }
  | { status: 'cancelled' | 'failed' | 'superseded' };

export type LinkNavigationPorts = {
  classifyLinkUrl: (href: string) => LinkUrlClassification;
  navigateFragment: (
    request: FragmentNavigationRequest,
  ) => Promise<FragmentNavigationOutcome>;
  openDocumentPath: (path: string) => Promise<LinkDocumentOpenOutcome>;
  openExternalUrl: (
    href: string,
  ) => Promise<CommandResult<OpenExternalUrlResult>>;
  resolveRelativeLinkPath: (
    href: string,
    currentDocumentPath: string | null,
  ) => string | null;
};

export type LinkNavigationInput = {
  currentDocumentPath: string | null;
  href: string;
};

export type LinkNavigationResult =
  | {
      status: 'navigated';
      target: 'document' | 'external' | 'fragment';
    }
  | {
      reason: 'cancelled' | 'failed' | 'superseded';
      status: 'notNavigated';
      target: 'document' | 'external' | 'fragment';
    }
  | {
      code: string;
      status: 'blocked' | 'failed';
    };

export async function navigateLink(
  input: LinkNavigationInput,
  ports: LinkNavigationPorts,
): Promise<LinkNavigationResult> {
  const classification = ports.classifyLinkUrl(input.href);

  if (classification.kind === 'rejected') {
    return {
      code: classification.code,
      status: 'blocked',
    };
  }

  if (classification.kind === 'absoluteAllowed') {
    const result = await ports.openExternalUrl(classification.href);

    if (result.ok) {
      return {
        status: 'navigated',
        target: 'external',
      };
    }

    return {
      code: result.error.code,
      status: 'failed',
    };
  }

  const fragment = decodeLinkFragment(classification.href);

  if (fragment.status === 'invalid') {
    return {
      code: 'link.fragmentUnavailable',
      status: 'blocked',
    };
  }

  if (
    classification.kind === 'relative' &&
    classification.href.trim().startsWith('#')
  ) {
    if (fragment.status === 'decoded') {
      return navigateDecodedFragment(
        {
          expectedDocumentPath: input.currentDocumentPath,
          fragment: fragment.value,
        },
        ports,
        'blocked',
      );
    }

    return {
      code: 'link.fragmentUnavailable',
      status: 'blocked',
    };
  }

  if (classification.kind === 'relative') {
    const path = ports.resolveRelativeLinkPath(
      classification.href,
      input.currentDocumentPath,
    );

    if (!path) {
      return {
        code: 'link.relativeUnavailable',
        status: 'blocked',
      };
    }

    const outcome = await ports.openDocumentPath(path);

    if (outcome.status === 'blocked') {
      return {
        code: outcome.code,
        status: 'blocked',
      };
    }

    if (outcome.status === 'opened') {
      if (fragment.status === 'decoded') {
        return navigateDecodedFragment(
          {
            expectedDocumentPath: outcome.file.path,
            fragment: fragment.value,
          },
          ports,
          'failed',
        );
      }

      return {
        status: 'navigated',
        target: 'document',
      };
    }

    return {
      reason: outcome.status,
      status: 'notNavigated',
      target: 'document',
    };
  }

  return assertNever(classification);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported link classification: ${JSON.stringify(value)}`);
}

type DecodedLinkFragment =
  | { status: 'absent' }
  | { status: 'decoded'; value: string }
  | { status: 'invalid' };

function decodeLinkFragment(href: string): DecodedLinkFragment {
  const trimmed = href.trim();
  const fragmentMarker = trimmed.indexOf('#');

  if (fragmentMarker < 0) {
    return { status: 'absent' };
  }

  try {
    return {
      status: 'decoded',
      value: decodeURIComponent(trimmed.slice(fragmentMarker + 1)),
    };
  } catch {
    return { status: 'invalid' };
  }
}

async function navigateDecodedFragment(
  request: FragmentNavigationRequest,
  ports: LinkNavigationPorts,
  unavailableStatus: 'blocked' | 'failed',
): Promise<LinkNavigationResult> {
  const outcome = await ports.navigateFragment(request);

  if (outcome.status === 'navigated') {
    return {
      status: 'navigated',
      target: 'fragment',
    };
  }

  if (outcome.status === 'superseded') {
    return {
      reason: 'superseded',
      status: 'notNavigated',
      target: 'fragment',
    };
  }

  return {
    code: 'link.fragmentUnavailable',
    status: unavailableStatus,
  };
}
