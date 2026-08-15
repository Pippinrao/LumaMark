import {
  invokeCommand,
  type CommandResult,
  type InvokeCommandFunction,
} from '../tauri/invokeCommand';

export type TrashReason =
  | 'close_discard'
  | 'new_document_discard'
  | 'open_replace'
  | 'external_reload'
  | 'recovery_draft_discard'
  | 'delete';

export type TrashEntry = {
  byteLength: number;
  createdAtMs: number;
  fingerprint: string;
  id: string;
  reason: TrashReason;
  sourcePath: string | null;
};

export type TrashDocument = {
  entry: TrashEntry;
  text: string;
};

export type ArchiveTrashDocumentRequest = {
  reason: TrashReason;
  sourcePath: string | null;
  text: string;
};

export type TrashArchiveOutcome = {
  cleanupPending: boolean;
  entry: TrashEntry;
};

export type TrashRemoveOutcome = {
  cleanupPending: boolean;
  entry: TrashEntry;
};

export type TrashEmptyOutcome = {
  cleanupPending: boolean;
  removedCount: number;
};

type TrashCommandOptions = {
  invokeFn?: InvokeCommandFunction;
};

export function archiveTrashDocument(
  request: ArchiveTrashDocumentRequest,
  options: TrashCommandOptions = {},
): Promise<CommandResult<TrashArchiveOutcome>> {
  return invokeCommand<TrashArchiveOutcome>(
    'trash_archive',
    { request },
    options.invokeFn,
  );
}

export function listTrashEntries(
  options: TrashCommandOptions = {},
): Promise<CommandResult<TrashEntry[]>> {
  return invokeCommand<TrashEntry[]>('trash_list', undefined, options.invokeFn);
}

export function readTrashDocument(
  id: string,
  options: TrashCommandOptions = {},
): Promise<CommandResult<TrashDocument>> {
  return invokeCommand<TrashDocument>('trash_read', { id }, options.invokeFn);
}

export function restoreTrashDocument(
  id: string,
  options: TrashCommandOptions = {},
): Promise<CommandResult<TrashDocument>> {
  return invokeCommand<TrashDocument>('trash_restore', { id }, options.invokeFn);
}

export function removeTrashEntry(
  id: string,
  options: TrashCommandOptions = {},
): Promise<CommandResult<TrashRemoveOutcome>> {
  return invokeCommand<TrashRemoveOutcome>(
    'trash_remove',
    { id },
    options.invokeFn,
  );
}

export function emptyTrash(
  options: TrashCommandOptions = {},
): Promise<CommandResult<TrashEmptyOutcome>> {
  return invokeCommand<TrashEmptyOutcome>(
    'trash_empty',
    undefined,
    options.invokeFn,
  );
}
