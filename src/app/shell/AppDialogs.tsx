import { Suspense, type ReactNode } from 'react';

type AppDialogsProps = {
  commandPalette: ReactNode;
  settingsDialog: ReactNode;
};

export function AppDialogs({
  commandPalette,
  settingsDialog,
}: AppDialogsProps) {
  return (
    <Suspense fallback={null}>
      {commandPalette}
      {settingsDialog}
    </Suspense>
  );
}
