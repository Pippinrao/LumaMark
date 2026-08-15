import { lazy, useMemo } from 'react';
import { FileTree } from '../../features/file-tree/FileTree';
import { FileTreeMutationDialog } from '../../features/file-tree/FileTreeMutationDialog';
import { DiscardChangesDialog } from '../../features/file-actions/DiscardChangesDialog';
import { FileErrorNotice } from '../../features/file-actions/FileErrorNotice';
import { ExternalFileConflictDialog } from '../../features/file-actions/ExternalFileConflictDialog';
import { RecoveryDraftDialog } from '../../features/recovery-drafts/RecoveryDraftDialog';
import { OutlinePanel } from '../../features/outline/OutlinePanel';
import type { useAppShellModel } from '../controllers/useAppShellModel';
import { FileTreeContextMenuHost } from './FileTreeContextMenuHost';
import { AppDialogs } from '../shell/AppDialogs';
import { EditorPane } from '../shell/EditorPane';
import { TopChrome } from '../shell/TopChrome';
import { WorkspaceSidebar } from '../shell/WorkspaceSidebar';
import { StartScreen } from '../../features/startup/StartScreen';
import type { ShellSlots } from '../shell/shellTypes';
import packageMetadata from '../../../package.json';

const LazyCommandPalette = lazy(() =>
  import('../../features/command-palette/CommandPalette').then((module) => ({
    default: module.CommandPalette,
  })),
);
const LazySettingsDialog = lazy(() =>
  import('../../features/settings/SettingsDialog').then((module) => ({
    default: module.SettingsDialog,
  })),
);
const LazyAboutDialog = lazy(() =>
  import('../../features/about/AboutDialog').then((module) => ({
    default: module.AboutDialog,
  })),
);
const LazyUpdateDialog = lazy(() =>
  import('../../features/updates/UpdateDialog').then((module) => ({
    default: module.UpdateDialog,
  })),
);
const LazyMediaViewerDialog = lazy(() =>
  import('../../features/media-viewer/MediaViewerDialog').then((module) => ({
    default: module.MediaViewerDialog,
  })),
);

type AppShellModel = ReturnType<typeof useAppShellModel>;

type AppShellSlotHandlers = {
  onReadOnlyEditAttempt: () => void;
  onSidebarContentWidthChange: (contentWidth: number) => void;
};

export function useAppShellSlots(
  model: AppShellModel,
  handlers: AppShellSlotHandlers,
): ShellSlots {
  const { onReadOnlyEditAttempt, onSidebarContentWidthChange } = handlers;

  return useMemo(
    () => ({
      dialogs: (
        <AppDialogs
          aboutDialog={
            model.aboutOpen ? (
              <LazyAboutDialog
                onOpenChange={model.setAboutOpen}
                onReturnFocus={model.restoreDialogFocus}
                open={model.aboutOpen}
                version={packageMetadata.version}
              />
            ) : null
          }
          updateDialog={
            model.updateDialog.dialogOpen ? (
              <LazyUpdateDialog
                currentVersion={model.updateDialog.currentVersion}
                errorCode={model.updateDialog.errorCode}
                errorMessage={model.updateDialog.errorMessage}
                notes={model.updateDialog.notes}
                onInstall={model.updateDialog.installAvailableUpdate}
                onOpenChange={model.updateDialog.setDialogOpen}
                onReturnFocus={model.restoreDialogFocus}
                open={model.updateDialog.dialogOpen}
                progress={model.updateDialog.progress}
                status={model.updateDialog.status}
                version={model.updateDialog.version}
              />
            ) : null
          }
          commandPalette={
            model.commandPaletteOpen ? (
              <LazyCommandPalette
                commands={model.commands}
                onCommandSelect={model.runCommandAfterPaletteClose}
                onOpenChange={model.setCommandPaletteOpen}
                open={model.commandPaletteOpen}
              />
            ) : null
          }
          discardChangesDialog={
            model.documentClose.open ? (
              <DiscardChangesDialog
                descriptionKey="closeDocument.description"
                onConfirm={model.documentClose.chooseDiscard}
                onOpenChange={model.documentClose.setOpen}
                onReturnFocus={model.editor.focusEditor}
                onSave={model.documentClose.chooseSave}
                open
                saveKey="closeDocument.save"
                titleKey="closeDocument.title"
              />
            ) : model.desktopOpenRequests.pendingRequest ? (
              <DiscardChangesDialog
                onConfirm={model.desktopOpenRequests.confirmDiscard}
                onOpenChange={(open) => {
                  if (!open) {
                    model.desktopOpenRequests.cancelDiscard();
                  }
                }}
                onReturnFocus={model.editor.focusEditor}
                open
              />
            ) : model.newDocumentConfirmOpen ? (
              <DiscardChangesDialog
                onConfirm={model.confirmNewDocument}
                onOpenChange={model.setNewDocumentConfirmOpen}
                onReturnFocus={model.restoreNewDocumentFocus}
                open={model.newDocumentConfirmOpen}
              />
            ) : null
          }
          externalFileConflictDialog={
            model.externalFileConflict.conflict ? (
              <ExternalFileConflictDialog
                onKeepCurrentContent={
                  model.externalFileConflict.keepCurrentContent
                }
                onReloadFromDisk={() => {
                  void model.externalFileConflict.reloadFromDisk();
                }}
                open
              />
            ) : null
          }
          fileTreeMutationDialog={
            model.fileTree.mutationDialog.request ? (
              <FileTreeMutationDialog
                busy={model.fileTree.mutationDialog.busy}
                onCancel={model.fileTree.mutationDialog.cancel}
                onConfirm={(name) => {
                  void model.fileTree.mutationDialog.confirm(name);
                }}
                onReturnFocus={model.fileTree.mutationDialog.returnFocus}
                request={model.fileTree.mutationDialog.request}
              />
            ) : null
          }
          fileErrorNotice={
            model.workspace.error ? (
              <FileErrorNotice
                error={model.workspace.error}
                onDismiss={model.workspace.dismissError}
              />
            ) : model.desktopOpenRequests.error ? (
              <FileErrorNotice
                error={model.desktopOpenRequests.error}
                onDismiss={model.desktopOpenRequests.dismissError}
                onRetry={
                  model.desktopOpenRequests.retrySynchronization
                }
              />
            ) : model.lastFileError ? (
              <FileErrorNotice
                error={model.lastFileError}
                onDismiss={model.dismissFileError}
              />
            ) : null
          }
          mediaViewer={
            model.mediaViewer.request ? (
              <LazyMediaViewerDialog
                onOpenChange={model.mediaViewer.setOpen}
                onReturnFocus={model.mediaViewer.returnFocus}
                open={model.mediaViewer.open}
                request={model.mediaViewer.request}
                sessionId={model.mediaViewer.sessionId}
              />
            ) : null
          }
          settingsDialog={
            model.settingsOpen ? (
              <LazySettingsDialog
                autoCheckUpdates={model.updateDialog.autoCheckOnStartup}
                autosaveEnabled={model.autosaveEnabled}
                closeErrorCode={model.windowControls.closeErrorCode}
                copyImagesToAssets={model.copyImagesToAssets}
                defaultDisplayMode={model.defaultDisplayMode}
                focusModeOnStartup={model.focusModeOnStartup}
                fontZoomPercent={model.fontZoomPercent}
                language={model.language}
                loadUnsavedDocument={model.loadUnsavedSnapshot}
                onAutoCheckUpdatesChange={model.updateDialog.setAutoCheckOnStartup}
                onAutosaveEnabledChange={model.setAutosaveEnabled}
                onClearRecentFiles={model.clearRecentFiles}
                onCopyImagesToAssetsChange={model.setCopyImagesToAssets}
                onDefaultDisplayModeChange={model.setDefaultDisplayMode}
                onFocusModeOnStartupChange={model.setFocusModeOnStartup}
                onFontZoomPercentChange={model.setFontZoomPercent}
                onLanguageChange={model.setLanguage}
                onOpenChange={model.setSettingsOpen}
                onPageWidthChange={model.setPageWidth}
                onRetrySettingsWrite={model.retrySettingsWrite}
                onReturnFocus={model.restoreDialogFocus}
                onSidebarOpenOnStartupChange={model.setSidebarOpenOnStartup}
                onStartupBehaviorChange={model.setStartupBehavior}
                onThemeChange={model.setTheme}
                open={model.settingsOpen}
                pageWidth={model.pageWidth}
                pageWidthPersistenceError={model.pageWidthPersistenceError}
                recentFilesPersistenceError={model.recentFilesPersistenceError}
                settingsLoadState={model.settingsLoadState}
                settingsRecoveryState={model.settingsRecoveryState}
                settingsWriteState={model.settingsWriteState}
                sidebarOpenOnStartup={model.sidebarOpenOnStartup}
                startupBehavior={model.startupBehavior}
                startupPersistenceError={model.startupPersistenceError}
                theme={model.theme}
              />
            ) : null
          }
          recoveryDraftDialog={
            model.recoveryDraft.pendingRecoveryDraft ? (
              <RecoveryDraftDialog
                draft={model.recoveryDraft.pendingRecoveryDraft}
                onDiscard={model.recoveryDraft.discardRecoveryDraft}
                onRestore={model.recoveryDraft.restoreRecoveryDraft}
              />
            ) : null
          }
        />
      ),
      editor: (
        <EditorPane
          accessibleTitle={model.documentTitle}
          appearance={model.editor.appearance}
          ariaLabel={model.labels.editor}
          closeContextMenu={model.editor.closeContextMenu}
          getContextMenuNodes={model.editor.getContextMenuNodes}
          onInvoke={model.runMenuInvocation}
          onDocumentChanged={(event) => {
            model.editor.markDocumentDirty(event.dirty);
            if (event.dirty) {
              model.recoveryDraft.scheduleRecoveryDraft();
            } else {
              model.recoveryDraft.clearRecoveryDraft();
            }
            if (event.documentChanged) {
              model.documentStatistics.scheduleRefresh();
              model.scheduleOutlineRefresh();
            }
          }}
          onEditorReady={model.editor.onReady}
          onLinkNavigationRequest={model.editor.onLinkNavigationRequest}
          onZoomRequested={model.editor.onZoomRequested}
          onMediaPreviewRequest={model.mediaViewer.openMedia}
          onReadOnlyEditAttempt={onReadOnlyEditAttempt}
          prepareContextMenu={model.editor.prepareContextMenu}
          imageAssetResolver={model.editor.imageAssetResolver}
          imageImportErrorHandler={model.editor.imageImportErrorHandler}
          imageImportHandler={model.editor.imageImportHandler}
          language={model.language}
          visibleDocumentTitle={model.visibleDocumentTitle}
        />
      ),
      sidebar: (
        <WorkspaceSidebar
          fileTree={
            <FileTreeContextMenuHost
              getContextMenuNodes={model.fileTree.getContextMenuNodes}
              onInvoke={model.runMenuInvocation}
            >
              <FileTree
                loadingPaths={model.workspace.loadingPaths}
                onContentWidthChange={onSidebarContentWidthChange}
                onLoadChildren={model.workspace.loadChildren}
                onOpenFile={model.workspace.openFile}
                onOpenWorkspace={model.workspace.openWorkspace}
                recentFiles={model.recentFiles}
                root={model.workspace.root}
                selectedPath={model.currentFile?.path}
                tree={model.workspace.tree}
              />
            </FileTreeContextMenuHost>
          }
          labels={model.labels.sidebar}
          outline={
            <OutlinePanel
              headings={model.headings}
              onSelectHeading={model.editor.selectHeading}
            />
          }
        />
      ),
      startScreen: model.startup.visible ? (
        <StartScreen
          onNewDocument={model.startup.newDocument}
          onOpenFile={() => { void model.startup.openFile(); }}
          onOpenRecentFile={(path) => { void model.startup.openRecentFile(path); }}
          onOpenRecentWorkspace={(path) => { void model.startup.openRecentWorkspace(path); }}
          onOpenWorkspace={() => { void model.startup.openWorkspace(); }}
          recentFiles={model.recentFiles}
          recentFilesPersistenceError={model.recentFilesPersistenceError}
          recentWorkspaces={model.startup.recentWorkspaces}
          startupPersistenceError={model.startupPersistenceError}
        />
      ) : null,
      topChrome: (
        <TopChrome
          groups={model.topMenuGroups}
          labels={model.labels.topChrome}
          onInvoke={model.runMenuInvocation}
          onMenuOpen={model.refreshEditorEditState}
          windowChrome={model.windowControls}
        />
      ),
    }),
    [model, onReadOnlyEditAttempt, onSidebarContentWidthChange],
  );
}
