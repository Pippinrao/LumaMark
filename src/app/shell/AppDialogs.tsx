import { Suspense, type ReactNode } from 'react';

type AppDialogsProps = {
  commandPalette: ReactNode;
  discardChangesDialog: ReactNode;
  externalFileConflictDialog: ReactNode;
  fileErrorNotice: ReactNode;
  recoveryDraftDialog: ReactNode;
  settingsDialog: ReactNode;
};

export function AppDialogs({
  commandPalette,
  discardChangesDialog,
  externalFileConflictDialog,
  fileErrorNotice,
  recoveryDraftDialog,
  settingsDialog,
}: AppDialogsProps) {
  return (
    <Suspense fallback={null}>
      {commandPalette}
      {discardChangesDialog}
      {externalFileConflictDialog}
      {fileErrorNotice}
      {recoveryDraftDialog}
      {settingsDialog}
    </Suspense>
  );
}
