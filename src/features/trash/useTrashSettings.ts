import { useCallback, useEffect, useState } from 'react';

import type { CommandResult } from '../../services/tauri/invokeCommand';
import {
  emptyTrash,
  listTrashEntries,
  readTrashDocument,
  removeTrashEntry,
  type TrashDocument,
  type TrashEntry,
} from '../../services/trash/trashClient';
import { restoreTrashAsUnsavedSnapshot } from './restoreTrashAsUnsavedSnapshot';

type UseTrashSettingsOptions = {
  enabled?: boolean;
  loadUnsavedDocument: (text: string) => void;
  onRestored?: () => void;
};

export function useTrashSettings({
  enabled = true,
  loadUnsavedDocument,
  onRestored,
}: UseTrashSettingsOptions) {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TrashDocument | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
  const [emptyBusy, setEmptyBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await listTrashEntries();
    if (!result.ok) {
      setLoadError(result.error.code);
      setEntries([]);
      return;
    }
    setLoadError(null);
    setEntries(result.data);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    void listTrashEntries().then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setLoadError(result.error.code);
        setEntries([]);
        return;
      }
      setLoadError(null);
      setEntries(result.data);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const handleCommandError = (result: CommandResult<unknown>) => {
    if (!result.ok) {
      setLoadError(result.error.code);
    }
  };

  return {
    emptyBusy,
    entries,
    loadError,
    preview,
    previewBusy,
    restoreBusyId,
    onEmpty: async () => {
      setEmptyBusy(true);
      try {
        const result = await emptyTrash();
        handleCommandError(result);
        if (result.ok) {
          setPreview(null);
          await refresh();
        }
      } finally {
        setEmptyBusy(false);
      }
    },
    onPreview: async (id: string) => {
      setPreviewBusy(true);
      try {
        const result = await readTrashDocument(id);
        if (!result.ok) {
          setLoadError(result.error.code);
          return;
        }
        setPreview(result.data);
      } finally {
        setPreviewBusy(false);
      }
    },
    onRemove: async (id: string) => {
      const result = await removeTrashEntry(id);
      handleCommandError(result);
      if (result.ok) {
        if (preview?.entry.id === id) {
          setPreview(null);
        }
        await refresh();
      }
    },
    onRestore: async (id: string) => {
      setRestoreBusyId(id);
      try {
        const result = await restoreTrashAsUnsavedSnapshot(id, {
          loadUnsavedDocument,
        });
        if (!result.ok) {
          setLoadError(result.error.code);
          return;
        }
        await refresh();
        onRestored?.();
      } finally {
        setRestoreBusyId(null);
      }
    },
  };
}
