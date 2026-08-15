import type { EditorApi } from '../../editor/core/editorApi';
import {
  readTextFile,
  showOpenFileDialog,
  showSaveFileDialog,
  writeTextFile,
  type ReadTextFileResult,
  type WriteTextFileResult,
} from '../../services/files/fileCommands';
import type { FileCommandClient } from '../../services/files/fileCommandClient';
import type { FileMetadata } from '../../services/files/fileTypes';
import type { CommandError, CommandResult } from '../../services/tauri/invokeCommand';
import type { RecentFileInput } from '../recent-files/recentFilesStore';

export type CurrentFile = FileMetadata;

export type FileActionState = {
  currentFile: CurrentFile | null;
  dirty: boolean;
  dirtyRevision: number;
  lastFileError: CommandError | null;
};

export type FileActionStateAdapter = {
  getState: () => FileActionState;
  setCurrentFile: (currentFile: CurrentFile | null) => void;
  setDirty: (dirty: boolean) => void;
  setLastFileError: (error: CommandError | null) => void;
};

type RecentFilesAdapter = {
  addRecentFile: (file: RecentFileInput) => void;
};

export type FileActions = {
  applyOpenResult: (
    result: CommandResult<ReadTextFileResult>,
  ) => CommandResult<ReadTextFileResult>;
  createNewDocument: () => void;
  openFile: (path: string) => Promise<CommandResult<ReadTextFileResult>>;
  openFileFromDialog: () => Promise<CommandResult<ReadTextFileResult | null>>;
  prepareCurrentFileSave: (
    pathOverride?: string,
  ) => Promise<CommandResult<PreparedFileSave>>;
  readFile: (path: string) => Promise<CommandResult<ReadTextFileResult>>;
  selectOpenFilePath: () => Promise<CommandResult<string | null>>;
  saveCurrentFile: (
    pathOverride?: string,
  ) => Promise<CommandResult<WriteTextFileResult>>;
  saveFileAs: () => Promise<CommandResult<WriteTextFileResult | null>>;
  selectSaveFilePath: () => Promise<CommandResult<string | null>>;
};

export type PreparedFileSave = {
  apply: (
    result: CommandResult<WriteTextFileResult>,
  ) => CommandResult<WriteTextFileResult>;
  targetPath: string;
  write: () => Promise<CommandResult<WriteTextFileResult>>;
};

type CreateFileActionsOptions = {
  commands?: FileCommandClient;
  editor: Pick<
    EditorApi,
    | 'captureDocumentSnapshot'
    | 'focus'
    | 'isDocumentSnapshotCurrent'
    | 'loadDocument'
    | 'markDocumentSaved'
    | 'markDocumentUnsaved'
  > &
    Partial<Pick<EditorApi, 'setDocumentContext'>>;
  recentFiles: RecentFilesAdapter;
  prepareTextForSave?: (path: string, text: string) => Promise<string>;
  shouldApplyOpenResult?: () => boolean;
  shouldApplySaveResult?: () => boolean;
  state: FileActionStateAdapter;
};

type CommandFailure = Extract<CommandResult<never>, { ok: false }>;

const defaultCommands: FileCommandClient = {
  readText: readTextFile,
  showOpenDialog: showOpenFileDialog,
  showSaveDialog: showSaveFileDialog,
  writeText: writeTextFile,
};

function commandError(
  code: string,
  message: string,
  recoverable = true,
  details?: unknown,
): CommandFailure {
  return {
    ok: false,
    error: {
      code,
      ...(details === undefined ? {} : { details }),
      message,
      recoverable,
    },
  };
}

function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);

  return parts.at(-1)?.trim() || path;
}

function fileMetadataFromPath(path: string): CurrentFile {
  return {
    name: fileNameFromPath(path),
    path,
  };
}

export function createFileActions({
  commands = defaultCommands,
  editor,
  recentFiles,
  prepareTextForSave = async (_path, text) => text,
  shouldApplyOpenResult = () => true,
  shouldApplySaveResult = () => true,
  state,
}: CreateFileActionsOptions): FileActions {
  const applyOpenResult = (
    result: CommandResult<ReadTextFileResult>,
  ): CommandResult<ReadTextFileResult> => {
    if (!shouldApplyOpenResult()) {
      return result;
    }

    if (!result.ok) {
      state.setLastFileError(result.error);
      return result;
    }

    const currentFile = fileMetadataFromPath(result.data.path);
    editor.loadDocument(result.data.text);
    editor.setDocumentContext?.({ path: currentFile.path });
    state.setCurrentFile(currentFile);
    state.setDirty(false);
    state.setLastFileError(null);
    recentFiles.addRecentFile(currentFile);
    editor.focus();

    return result;
  };

  const readFile = (path: string) => commands.readText(path);

  const openFile = async (
    path: string,
  ): Promise<CommandResult<ReadTextFileResult>> =>
    applyOpenResult(await readFile(path));

  const prepareCurrentFileSave = async (
    pathOverride?: string,
  ): Promise<CommandResult<PreparedFileSave>> => {
    const saveStartedAtRevision = state.getState().dirtyRevision;
    const targetPath = pathOverride ?? state.getState().currentFile?.path;

    if (!targetPath) {
      return commandError(
        'file.path_required',
        'A target path is required before saving.',
      );
    }

    const originalSnapshot = editor.captureDocumentSnapshot();
    const originalText = originalSnapshot.serializedText;
    let text: string;

    try {
      text = await prepareTextForSave(targetPath, originalText);
    } catch (error) {
      const result = commandError(
        'file.prepare_failed',
        error instanceof Error
          ? error.message
          : 'The document could not be prepared for saving.',
        true,
        error,
      );
      if (shouldApplySaveResult()) {
        state.setLastFileError(result.error);
      }
      return result;
    }

    return {
      data: {
        apply(result) {
          if (!shouldApplySaveResult()) {
            return result;
          }

          if (!result.ok) {
            state.setLastFileError(result.error);
            return result;
          }

          const documentUnchanged =
            state.getState().dirtyRevision === saveStartedAtRevision &&
            editor.isDocumentSnapshotCurrent(originalSnapshot);

          if (text !== originalText && documentUnchanged) {
            editor.loadDocument(text, {
              preserveView: true,
              resetHistory: false,
            });
            editor.markDocumentSaved(editor.captureDocumentSnapshot());
          } else if (text === originalText) {
            editor.markDocumentSaved(originalSnapshot);
          } else {
            editor.markDocumentUnsaved();
          }

          const currentFile = fileMetadataFromPath(result.data.path);
          editor.setDocumentContext?.({ path: currentFile.path });
          state.setCurrentFile(currentFile);
          if (state.getState().dirtyRevision === saveStartedAtRevision) {
            state.setDirty(false);
          }
          state.setLastFileError(null);
          recentFiles.addRecentFile(currentFile);

          return result;
        },
        targetPath,
        write: () => commands.writeText(targetPath, text),
      },
      ok: true,
    };
  };

  const saveCurrentFile = async (
    pathOverride?: string,
  ): Promise<CommandResult<WriteTextFileResult>> => {
    const prepared = await prepareCurrentFileSave(pathOverride);
    if (!prepared.ok) {
      return prepared;
    }

    return prepared.data.apply(await prepared.data.write());
  };

  const selectOpenFilePath = async (): Promise<
    CommandResult<string | null>
  > => {
    const dialogResult = await commands.showOpenDialog();

    if (!shouldApplyOpenResult()) {
      return dialogResult.ok
        ? { ok: true, data: null }
        : dialogResult;
    }

    if (!dialogResult.ok) {
      state.setLastFileError(dialogResult.error);
    }

    return dialogResult;
  };

  const selectSaveFilePath = async (): Promise<
    CommandResult<string | null>
  > => {
    const dialogResult = await commands.showSaveDialog();

    if (!shouldApplySaveResult()) {
      return dialogResult.ok ? { ok: true, data: null } : dialogResult;
    }

    if (!dialogResult.ok) {
      state.setLastFileError(dialogResult.error);
    }

    return dialogResult;
  };

  return {
    applyOpenResult,
    createNewDocument() {
      editor.loadDocument('');
      editor.setDocumentContext?.({ path: null });
      state.setCurrentFile(null);
      state.setDirty(false);
      state.setLastFileError(null);
      editor.focus();
    },
    openFile,

    async openFileFromDialog() {
      const selection = await selectOpenFilePath();

      if (!selection.ok) {
        return selection;
      }
      if (!selection.data) {
        return { ok: true, data: null };
      }

      return openFile(selection.data);
    },

    selectOpenFilePath,

    prepareCurrentFileSave,

    readFile,

    saveCurrentFile,

    async saveFileAs() {
      const selection = await selectSaveFilePath();

      if (!selection.ok) {
        return selection;
      }

      if (!selection.data) {
        return { ok: true, data: null };
      }

      return saveCurrentFile(selection.data);
    },

    selectSaveFilePath,
  };
}
