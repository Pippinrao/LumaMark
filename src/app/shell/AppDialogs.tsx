import { Suspense, type ReactNode } from 'react';

type AppDialogsProps = {
  aboutDialog: ReactNode;
  commandPalette: ReactNode;
  discardChangesDialog: ReactNode;
  externalFileConflictDialog: ReactNode;
  fileErrorNotice: ReactNode;
  recoveryDraftDialog: ReactNode;
  settingsDialog: ReactNode;
};

export function AppDialogs({
  aboutDialog,
  commandPalette,
  discardChangesDialog,
  externalFileConflictDialog,
  fileErrorNotice,
  recoveryDraftDialog,
  settingsDialog,
}: AppDialogsProps) {
  return (
    <Suspense fallback={null}>
      {aboutDialog}
      {commandPalette}
      {discardChangesDialog}
      {externalFileConflictDialog}
      {fileErrorNotice}
      {recoveryDraftDialog}
      {settingsDialog}
    </Suspense>
  );
}
