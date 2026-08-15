import { Suspense, type ReactNode } from 'react';

type AppDialogsProps = {
  aboutDialog: ReactNode;
  commandPalette: ReactNode;
  discardChangesDialog: ReactNode;
  externalFileConflictDialog: ReactNode;
  fileErrorNotice: ReactNode;
  fileTreeMutationDialog: ReactNode;
  mediaViewer: ReactNode;
  recoveryDraftDialog: ReactNode;
  settingsDialog: ReactNode;
  updateDialog: ReactNode;
};

export function AppDialogs({
  aboutDialog,
  commandPalette,
  discardChangesDialog,
  externalFileConflictDialog,
  fileErrorNotice,
  fileTreeMutationDialog,
  mediaViewer,
  recoveryDraftDialog,
  settingsDialog,
  updateDialog,
}: AppDialogsProps) {
  return (
    <Suspense fallback={null}>
      {aboutDialog}
      {commandPalette}
      {discardChangesDialog}
      {externalFileConflictDialog}
      {fileErrorNotice}
      {fileTreeMutationDialog}
      {mediaViewer}
      {recoveryDraftDialog}
      {settingsDialog}
      {updateDialog}
    </Suspense>
  );
}
