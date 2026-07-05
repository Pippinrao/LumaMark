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
  openFile: (path: string) => Promise<CommandResult<ReadTextFileResult>>;
  openFileFromDialog: () => Promise<CommandResult<ReadTextFileResult | null>>;
  saveCurrentFile: (
    pathOverride?: string,
  ) => Promise<CommandResult<WriteTextFileResult>>;
  saveFileAs: () => Promise<CommandResult<WriteTextFileResult | null>>;
};

type CreateFileActionsOptions = {
  commands?: FileCommandClient;
  editor: Pick<EditorApi, 'focus' | 'getDocumentText' | 'loadDocument'> &
    Partial<Pick<EditorApi, 'setDocumentContext'>>;
  recentFiles: RecentFilesAdapter;
  state: FileActionStateAdapter;
};

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
): CommandResult<never> {
  return {
    ok: false,
    error: {
      code,
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
  state,
}: CreateFileActionsOptions): FileActions {
  const openFile = async (
    path: string,
  ): Promise<CommandResult<ReadTextFileResult>> => {
    const result = await commands.readText(path);

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

  const saveCurrentFile = async (
    pathOverride?: string,
  ): Promise<CommandResult<WriteTextFileResult>> => {
    const saveStartedAtRevision = state.getState().dirtyRevision;
    const targetPath = pathOverride ?? state.getState().currentFile?.path;

    if (!targetPath) {
      return commandError(
        'file.path_required',
        'A target path is required before saving.',
      );
    }

    const text = editor.getDocumentText();
    const result = await commands.writeText(targetPath, text);

    if (!result.ok) {
      state.setLastFileError(result.error);
      return result;
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
  };

  return {
    openFile,

    async openFileFromDialog() {
      const dialogResult = await commands.showOpenDialog();

      if (!dialogResult.ok) {
        state.setLastFileError(dialogResult.error);
        return dialogResult;
      }

      if (!dialogResult.data) {
        return { ok: true, data: null };
      }

      return openFile(dialogResult.data);
    },

    saveCurrentFile,

    async saveFileAs() {
      const dialogResult = await commands.showSaveDialog();

      if (!dialogResult.ok) {
        state.setLastFileError(dialogResult.error);
        return dialogResult;
      }

      if (!dialogResult.data) {
        return { ok: true, data: null };
      }

      return saveCurrentFile(dialogResult.data);
    },
  };
}
