import type { CommandResult } from '../../services/tauri/invokeCommand';
import {
  restoreTrashDocument,
  type TrashDocument,
} from '../../services/trash/trashClient';

type RestoreTrashPorts = {
  loadUnsavedDocument: (text: string) => void;
  restore?: (id: string) => Promise<CommandResult<TrashDocument>>;
  writeOriginalPath?: (path: string, text: string) => Promise<unknown>;
};

export async function restoreTrashAsUnsavedSnapshot(
  id: string,
  ports: RestoreTrashPorts,
): Promise<
  | { ok: true; status: 'restoredUnsaved' }
  | { ok: false; error: CommandResult<never>['error'] }
> {
  const restore = ports.restore ?? restoreTrashDocument;
  const result = await restore(id);
  if (!result.ok) {
    return result;
  }

  ports.loadUnsavedDocument(result.data.text);
  return { ok: true, status: 'restoredUnsaved' };
}
