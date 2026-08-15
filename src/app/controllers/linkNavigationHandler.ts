import type { OpenDocumentOutcome } from '../../features/file-actions/useFileWorkflow';
import { areFilePathsEqual } from '../../services/files/filePathIdentity';
import {
  navigateLink,
  type FragmentNavigationRequest,
  type LinkNavigationResult,
} from '../../features/link-navigation/linkNavigationCoordinator';
import type { OutlineSnapshotOutcome } from '../../features/outline/useDebouncedOutline';
import { createOutlineHeadingId } from '../../features/outline/outlineParser';
import { classifyLinkUrl } from '../../services/opener/linkUrlClassification';
import {
  openExternalUrl,
  type OpenExternalUrlResult,
} from '../../services/opener/openerCommands';
import { resolveRelativeLinkPath } from '../../services/opener/resolveRelativeLinkPath';
import type { CommandResult } from '../../services/tauri/invokeCommand';

export type LinkNavigationHandlerOptions = {
  awaitCurrentOutlineSnapshot: () => Promise<OutlineSnapshotOutcome>;
  classifyLinkUrl?: typeof classifyLinkUrl;
  getCurrentDocumentPath: () => string | null;
  isCurrentDocumentDirty: () => boolean;
  isOutlineCurrent: () => boolean;
  openDocumentPath: (path: string) => Promise<OpenDocumentOutcome>;
  openExternalUrl?: (
    href: string,
  ) => Promise<CommandResult<OpenExternalUrlResult>>;
  reportError: (code: string) => void;
  resolveRelativeLinkPath?: typeof resolveRelativeLinkPath;
  revealPosition: (position: number) => void;
  supersedePendingDocumentOpen: () => void;
};

export type LinkNavigationHandler = {
  (href: string): Promise<LinkNavigationResult>;
  invalidate: () => void;
};

export function createLinkNavigationHandler({
  awaitCurrentOutlineSnapshot,
  classifyLinkUrl: classify = classifyLinkUrl,
  getCurrentDocumentPath,
  isCurrentDocumentDirty,
  isOutlineCurrent,
  openDocumentPath,
  openExternalUrl: openExternal = openExternalUrl,
  reportError,
  resolveRelativeLinkPath: resolveRelative = resolveRelativeLinkPath,
  revealPosition,
  supersedePendingDocumentOpen,
}: LinkNavigationHandlerOptions): LinkNavigationHandler {
  let latestGeneration = 0;

  const navigate = async (href: string): Promise<LinkNavigationResult> => {
    let generation: number | undefined;
    const beginNavigation = () => {
      if (generation === undefined) {
        supersedePendingDocumentOpen();
        generation = ++latestGeneration;
      }
      return generation;
    };
    let classification: ReturnType<typeof classifyLinkUrl> | undefined;
    const result = await navigateLink(
      {
        currentDocumentPath: getCurrentDocumentPath(),
        href,
      },
      {
        classifyLinkUrl: (candidate) => {
          classification = classify(candidate);
          return classification;
        },
        navigateFragment: (request) =>
          navigateFragment(request, beginNavigation()),
        openDocumentPath: async (path) => {
          const currentDocumentPath = getCurrentDocumentPath();
          if (sameDocumentPath(currentDocumentPath, path)) {
            beginNavigation();
            return {
              file: { path: currentDocumentPath ?? path },
              status: 'opened' as const,
            };
          }
          if (isCurrentDocumentDirty()) {
            return {
              code: 'link.unsavedChanges',
              status: 'blocked' as const,
            };
          }
          beginNavigation();
          return openDocumentPath(path);
        },
        openExternalUrl: (candidate) => {
          beginNavigation();
          return openExternal(candidate);
        },
        resolveRelativeLinkPath: resolveRelative,
      },
    );

    if (generation !== undefined && generation !== latestGeneration) {
      return {
        reason: 'superseded',
        status: 'notNavigated',
        target: navigationTarget(classification, href),
      };
    }
    if (result.status === 'blocked' || result.status === 'failed') {
      reportError(result.code);
    }
    return result;
  };

  return Object.assign(navigate, {
    invalidate: () => {
      latestGeneration += 1;
      supersedePendingDocumentOpen();
    },
  });

  async function navigateFragment(
    request: FragmentNavigationRequest,
    generation: number,
  ) {
    if (
      generation !== latestGeneration ||
      !sameDocumentPath(
        getCurrentDocumentPath(),
        request.expectedDocumentPath,
      )
    ) {
      return { status: 'superseded' as const };
    }

    const snapshot = await awaitCurrentOutlineSnapshot();
    if (
      snapshot.status === 'superseded' ||
      generation !== latestGeneration ||
      !sameDocumentPath(
        getCurrentDocumentPath(),
        request.expectedDocumentPath,
      ) ||
      !isOutlineCurrent()
    ) {
      return { status: 'superseded' as const };
    }

    const fragment = request.fragment.trim();
    const heading = fragment
      ? snapshot.headings.find(
          (candidate) => candidate.id === createOutlineHeadingId(fragment),
        )
      : undefined;
    if (!heading) {
      return { status: 'missing' as const };
    }

    if (
      generation !== latestGeneration ||
      !sameDocumentPath(
        getCurrentDocumentPath(),
        request.expectedDocumentPath,
      ) ||
      !isOutlineCurrent()
    ) {
      return { status: 'superseded' as const };
    }
    revealPosition(heading.from);
    return { status: 'navigated' as const };
  }
}

function sameDocumentPath(left: string | null, right: string | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return areFilePathsEqual(left, right);
}

function navigationTarget(
  classification: ReturnType<typeof classifyLinkUrl> | undefined,
  href: string,
): 'document' | 'external' | 'fragment' {
  if (classification?.kind === 'absoluteAllowed') {
    return 'external';
  }
  return href.trim().startsWith('#') ? 'fragment' : 'document';
}
