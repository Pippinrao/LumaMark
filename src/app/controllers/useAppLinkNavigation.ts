import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpenDocumentOutcome } from '../../features/file-actions/useFileWorkflow';
import type { OutlineSnapshotOutcome } from '../../features/outline/useDebouncedOutline';
import { useAppStore } from '../stores/appStore';
import { createLinkNavigationHandler } from './linkNavigationHandler';

type UseAppLinkNavigationOptions = {
  awaitCurrentOutlineSnapshot: () => Promise<OutlineSnapshotOutcome>;
  isOutlineCurrent: () => boolean;
  openDocumentPath: (path: string) => Promise<OpenDocumentOutcome>;
  revealPosition: (position: number) => void;
  supersedePendingDocumentOpen: () => void;
};

export function useAppLinkNavigation(
  options: UseAppLinkNavigationOptions,
) {
  const { t } = useTranslation();
  const optionsRef = useRef(options);
  const translateRef = useRef<(key: string) => string>((key) => t(key));
  const lastReportedErrorRef = useRef<{
    code: string;
    message: string;
    recoverable: true;
  } | null>(null);
  const handlerRef = useRef<ReturnType<
    typeof createLinkNavigationHandler
  > | null>(null);

  useEffect(() => {
    optionsRef.current = options;
    translateRef.current = (key) => t(key);
  }, [options, t]);

  useEffect(
    () => () => {
      handlerRef.current?.invalidate();
      handlerRef.current = null;
      lastReportedErrorRef.current = null;
    },
    [],
  );

  const navigateLinkHref = useCallback(async (href: string) => {
    if (!handlerRef.current) {
      handlerRef.current = createLinkNavigationHandler({
        awaitCurrentOutlineSnapshot: () =>
          optionsRef.current.awaitCurrentOutlineSnapshot(),
        getCurrentDocumentPath: () =>
          useAppStore.getState().currentFile?.path ?? null,
        isCurrentDocumentDirty: () => useAppStore.getState().dirty,
        isOutlineCurrent: () => optionsRef.current.isOutlineCurrent(),
        openDocumentPath: (path) => optionsRef.current.openDocumentPath(path),
        reportError: (code) => {
          const error = {
            code,
            message: linkErrorMessage(code, translateRef.current),
            recoverable: true as const,
          };
          lastReportedErrorRef.current = error;
          useAppStore.getState().setLastFileError(error);
        },
        revealPosition: (position) =>
          optionsRef.current.revealPosition(position),
        supersedePendingDocumentOpen: () =>
          optionsRef.current.supersedePendingDocumentOpen(),
      });
    }

    const result = await handlerRef.current(href);
    if (result.status === 'navigated') {
      const lastReportedError = lastReportedErrorRef.current;
      if (
        lastReportedError &&
        useAppStore.getState().lastFileError === lastReportedError
      ) {
        useAppStore.getState().setLastFileError(null);
      }
      lastReportedErrorRef.current = null;
    }
    return result;
  }, []);

  return navigateLinkHref;
}

function linkErrorMessage(
  code: string,
  translate: (key: string) => string,
): string {
  switch (code) {
    case 'link.empty':
      return translate('linkError.empty');
    case 'link.protocol_javascript':
      return translate('linkError.protocolJavascript');
    case 'link.protocol_data':
      return translate('linkError.protocolData');
    case 'link.protocol_file':
      return translate('linkError.protocolFile');
    case 'link.open_failed':
      return translate('linkError.openFailed');
    case 'link.unsavedChanges':
      return translate('linkError.unsavedChanges');
    case 'link.relativeUnavailable':
      return translate('linkError.relativeUnavailable');
    case 'link.fragmentUnavailable':
      return translate('linkError.fragmentUnavailable');
    default:
      return translate('linkError.protocolRejected');
  }
}
