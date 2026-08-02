import { lazy, useMemo } from 'react';
import { FileTree } from '../../features/file-tree/FileTree';
import { DiscardChangesDialog } from '../../features/file-actions/DiscardChangesDialog';
import { FileErrorNotice } from '../../features/file-actions/FileErrorNotice';
import { ExternalFileConflictDialog } from '../../features/file-actions/ExternalFileConflictDialog';
import { RecoveryDraftDialog } from '../../features/recovery-drafts/RecoveryDraftDialog';
import { OutlinePanel } from '../../features/outline/OutlinePanel';
import type { useAppShellModel } from '../controllers/useAppShellModel';
import { AppDialogs } from '../shell/AppDialogs';
import { EditorPane } from '../shell/EditorPane';
import { TopChrome } from '../shell/TopChrome';
import { WorkspaceSidebar } from '../shell/WorkspaceSidebar';
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

type AppShellModel = ReturnType<typeof useAppShellModel>;

export function useAppShellSlots(model: AppShellModel): ShellSlots {
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
            model.newDocumentConfirmOpen ? (
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
          fileErrorNotice={
            model.lastFileError ? (
              <FileErrorNotice
                error={model.lastFileError}
                onDismiss={model.dismissFileError}
              />
            ) : null
          }
          settingsDialog={
            model.settingsOpen ? (
              <LazySettingsDialog
                copyImagesToAssets={model.copyImagesToAssets}
                language={model.language}
                onCopyImagesToAssetsChange={model.setCopyImagesToAssets}
                onLanguageChange={model.setLanguage}
                onOpenChange={model.setSettingsOpen}
                onReturnFocus={model.restoreDialogFocus}
                onThemeChange={model.setTheme}
                open={model.settingsOpen}
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
          ariaLabel={model.labels.editor}
          getContextMenuItems={(target) =>
            model.editor.getContextMenuItems(
              target instanceof Element && Boolean(target.closest('.tbl-table-widget')),
            )
          }
          onAction={model.runAction}
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
            <FileTree
              loadingPaths={model.workspace.loadingPaths}
              onLoadChildren={model.workspace.loadChildren}
              onOpenFile={model.workspace.openFile}
              onOpenWorkspace={model.workspace.openWorkspace}
              recentFiles={model.recentFiles}
              root={model.workspace.root}
              selectedPath={model.currentFile?.path}
              tree={model.workspace.tree}
            />
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
      topChrome: (
        <TopChrome
          groups={model.topMenuGroups}
          labels={model.labels.topChrome}
          onInvoke={model.runMenuInvocation}
          windowChrome={model.windowControls}
        />
      ),
    }),
    [model],
  );
}
