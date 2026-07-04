import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createFileActions } from '../../features/file-actions/fileActions';
import { useRecentFilesStore } from '../../features/recent-files/recentFilesStore';
import { EditorViewHost } from '../../editor/core/EditorViewHost';
import type { EditorApi } from '../../editor/core/editorApi';
import { useAppStore } from '../stores/appStore';

export function AppShell() {
  const { t } = useTranslation();
  const editorRef = useRef<EditorApi | null>(null);
  const currentFile = useAppStore((state) => state.currentFile);
  const dirty = useAppStore((state) => state.dirty);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const statusKey = useAppStore((state) => state.statusKey);
  const setDirty = useAppStore((state) => state.setDirty);
  const setStatusKey = useAppStore((state) => state.setStatusKey);
  const toggleLanguage = useAppStore((state) => state.toggleLanguage);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const documentTitle = currentFile?.name ?? t('app.emptyTitle');
  const visibleDocumentTitle = dirty ? `${documentTitle} *` : documentTitle;
  const fileActionState = useMemo(
    () => ({
      getState: () => {
        const state = useAppStore.getState();

        return {
          currentFile: state.currentFile,
          dirty: state.dirty,
          dirtyRevision: state.dirtyRevision,
          lastFileError: state.lastFileError,
        };
      },
      setCurrentFile: useAppStore.getState().setCurrentFile,
      setDirty: useAppStore.getState().setDirty,
      setLastFileError: useAppStore.getState().setLastFileError,
    }),
    [],
  );
  const recentFiles = useMemo(
    () => ({
      addRecentFile: useRecentFilesStore.getState().addRecentFile,
    }),
    [],
  );
  const createActions = useCallback(() => {
    if (!editorRef.current) {
      return null;
    }

    return createFileActions({
      editor: editorRef.current,
      recentFiles,
      state: fileActionState,
    });
  }, [fileActionState, recentFiles]);

  const handleOpenFile = useCallback(async () => {
    const actions = createActions();

    if (!actions) {
      return;
    }

    const result = await actions.openFileFromDialog();

    if (result.ok && result.data) {
      setStatusKey('status.opened');
    }
  }, [createActions, setStatusKey]);

  const handleSave = useCallback(async () => {
    const actions = createActions();

    if (!actions) {
      return;
    }

    const result = useAppStore.getState().currentFile
      ? await actions.saveCurrentFile()
      : await actions.saveFileAs();

    if (result.ok && result.data && !useAppStore.getState().dirty) {
      setStatusKey('status.saved');
    }
  }, [createActions, setStatusKey]);

  const handleSaveAs = useCallback(async () => {
    const actions = createActions();

    if (!actions) {
      return;
    }

    const result = await actions.saveFileAs();

    if (result.ok && result.data && !useAppStore.getState().dirty) {
      setStatusKey('status.saved');
    }
  }, [createActions, setStatusKey]);

  return (
    <div className="lm-app-shell" data-testid="app-shell">
      <header className="lm-shell-header">
        <div className="lm-title-group">
          <h1>{t('app.name')}</h1>
          <span className="lm-document-title">{visibleDocumentTitle}</span>
        </div>

        <nav className="lm-command-bar" aria-label={t('app.toolbarLabel')}>
          <button type="button" onClick={handleOpenFile}>
            {t('command.openFile')}
          </button>
          <button type="button" onClick={handleSave}>
            {t('command.save')}
          </button>
          <button type="button" onClick={handleSaveAs}>
            {t('command.saveAs')}
          </button>
          <button type="button" onClick={toggleTheme}>
            {t('command.toggleTheme')}
          </button>
          <button type="button" onClick={toggleLanguage}>
            {t('command.toggleLanguage')}
          </button>
        </nav>
      </header>

      <div className="lm-shell-body">
        {sidebarOpen ? (
          <aside className="lm-sidebar" aria-label={t('app.sidebarLabel')}>
            <div className="lm-sidebar-item">{documentTitle}</div>
          </aside>
        ) : null}

        <main
          className="lm-editor-surface"
          data-testid="editor-host"
          aria-label={t('app.editorLabel')}
        >
          <EditorViewHost
            accessibleTitle={documentTitle}
            ariaLabel={t('app.editorLabel')}
            onDocumentChanged={() => {
              setDirty(true);
            }}
            onEditorReady={(editor) => {
              editorRef.current = editor;
            }}
          />
        </main>
      </div>

      <footer className="lm-status-bar">
        <span role="status">{t(statusKey)}</span>
      </footer>
    </div>
  );
}
