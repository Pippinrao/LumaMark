import { useAppShellSlots } from '../containers/useAppShellSlots';
import { useAppShellModel } from '../controllers/useAppShellModel';
import { AppShellView } from './AppShellView';

export function AppShell() {
  const model = useAppShellModel();
  const slots = useAppShellSlots(model);

  return (
    <AppShellView
      currentFileName={model.currentFile?.name}
      dirty={model.dirty}
      slots={slots}
      statusLabels={model.labels.status}
      workspaceName={model.workspace.root?.name}
    />
  );
}
