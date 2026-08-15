import { useCallback, useEffect, useRef } from 'react';
import type { FileWorkflow } from '../../features/file-actions/useFileWorkflow';
import type { RecoveryDraftWorkflow } from '../../features/recovery-drafts/useRecoveryDraft';
import { useStartupStore } from '../../features/startup/startupStore';
import type { WorkspaceWorkflow } from '../../features/workspace/useWorkspaceWorkflow';

type UseStartupExperienceOptions = {
  currentFilePath: string | null;
  desktopOpenRequests?: {
    blocksSessionRestore: boolean;
    bootstrapComplete: boolean;
  };
  dirty: boolean;
  editorReady: boolean;
  fileWorkflow: Pick<FileWorkflow, 'createNewDocument' | 'openFromDialog' | 'openPath'>;
  recoveryDraft: Pick<RecoveryDraftWorkflow, 'pendingRecoveryDraft' | 'recoveryChecked'>;
  workspace: Pick<WorkspaceWorkflow, 'openPath' | 'openWorkspace' | 'root'>;
};

export function useStartupExperience({
  currentFilePath,
  desktopOpenRequests = {
    blocksSessionRestore: false,
    bootstrapComplete: true,
  },
  dirty,
  editorReady,
  fileWorkflow,
  recoveryDraft,
  workspace,
}: UseStartupExperienceOptions) {
  const restoreAttemptedRef = useRef(false);
  const lastSession = useStartupStore((state) => state.lastSession);
  const recentWorkspaces = useStartupStore((state) => state.recentWorkspaces);
  const startupBehavior = useStartupStore((state) => state.startupBehavior);
  const visible = useStartupStore((state) => state.startScreenOpen);
  const addRecentWorkspace = useStartupStore((state) => state.addRecentWorkspace);
  const setLastSession = useStartupStore((state) => state.setLastSession);
  const setVisible = useStartupStore((state) => state.setStartScreenOpen);
  const initialStartupRef = useRef({ lastSession, startupBehavior });

  const rememberWorkspace = useCallback((openedWorkspace: { name: string; path: string }) => {
    addRecentWorkspace(openedWorkspace);
    setLastSession({ kind: 'workspace', path: openedWorkspace.path });
  }, [addRecentWorkspace, setLastSession]);

  const newDocument = useCallback(async () => {
    const created = await fileWorkflow.createNewDocument();
    if (!created) {
      return false;
    }
    setLastSession(null);
    setVisible(false);
    return true;
  }, [fileWorkflow, setLastSession, setVisible]);

  const openFile = useCallback(async () => {
    const outcome = await fileWorkflow.openFromDialog();
    if (outcome.status === 'opened') {
      setLastSession({ kind: 'file', path: outcome.file.path });
      setVisible(false);
    }
    return outcome;
  }, [fileWorkflow, setLastSession, setVisible]);

  const openRecentFile = useCallback(async (path: string) => {
    const outcome = await fileWorkflow.openPath(path);
    if (outcome.status === 'opened') {
      setLastSession({ kind: 'file', path: outcome.file.path });
      setVisible(false);
    }
    return outcome;
  }, [fileWorkflow, setLastSession, setVisible]);

  const openWorkspace = useCallback(async () => {
    const outcome = await workspace.openWorkspace();
    if (outcome.status === 'opened') {
      rememberWorkspace(outcome.workspace);
      setVisible(false);
    }
    return outcome;
  }, [rememberWorkspace, setVisible, workspace]);

  const openRecentWorkspace = useCallback(async (path: string) => {
    const outcome = await workspace.openPath(path);
    if (outcome.status === 'opened') {
      rememberWorkspace(outcome.workspace);
      setVisible(false);
    }
    return outcome;
  }, [rememberWorkspace, setVisible, workspace]);

  useEffect(() => {
    if (
      restoreAttemptedRef.current ||
      !desktopOpenRequests.bootstrapComplete ||
      !editorReady ||
      !recoveryDraft.recoveryChecked ||
      recoveryDraft.pendingRecoveryDraft
    ) {
      return;
    }

    if (desktopOpenRequests.blocksSessionRestore) {
      restoreAttemptedRef.current = true;
      return;
    }

    if (dirty) {
      restoreAttemptedRef.current = true;
      setVisible(false);
      return;
    }

    const initialStartup = initialStartupRef.current;
    const { lastSession } = initialStartup;
    if (
      initialStartup.startupBehavior !== 'restoreLastSession' ||
      !lastSession
    ) {
      return;
    }

    restoreAttemptedRef.current = true;
    void (async () => {
      if (lastSession.kind === 'file') {
        const outcome = await fileWorkflow.openPath(lastSession.path);
        if (outcome.status === 'opened') {
          setVisible(false);
        }
        return;
      }

      const outcome = await workspace.openPath(lastSession.path);
      if (outcome.status !== 'opened') {
        return;
      }

      rememberWorkspace(outcome.workspace);
      setVisible(false);
      if (lastSession.documentPath) {
        await fileWorkflow.openPath(lastSession.documentPath);
      }
    })();
  }, [
    dirty,
    desktopOpenRequests.blocksSessionRestore,
    desktopOpenRequests.bootstrapComplete,
    editorReady,
    fileWorkflow,
    recoveryDraft.pendingRecoveryDraft,
    recoveryDraft.recoveryChecked,
    rememberWorkspace,
    setVisible,
    workspace,
  ]);

  useEffect(() => {
    if (!editorReady || visible) {
      return;
    }

    if (workspace.root) {
      setLastSession({
        documentPath: currentFilePath ?? undefined,
        kind: 'workspace',
        path: workspace.root.path,
      });
    } else if (currentFilePath) {
      setLastSession({ kind: 'file', path: currentFilePath });
    }
  }, [currentFilePath, editorReady, setLastSession, visible, workspace.root]);

  return {
    newDocument,
    openFile,
    openRecentFile,
    openRecentWorkspace,
    openWorkspace,
    recentWorkspaces,
    visible,
  };
}
