import { lazy, useMemo } from 'react';
import { FileTree } from '../../features/file-tree/FileTree';
import { OutlinePanel } from '../../features/outline/OutlinePanel';
import type { useAppShellModel } from '../controllers/useAppShellModel';
import { AppDialogs } from '../shell/AppDialogs';
import { EditorPane } from '../shell/EditorPane';
import { TopChrome } from '../shell/TopChrome';
import { WorkspaceSidebar } from '../shell/WorkspaceSidebar';
import type { ShellSlots } from '../shell/shellTypes';

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

type AppShellModel = ReturnType<typeof useAppShellModel>;

export function useAppShellSlots(model: AppShellModel): ShellSlots {
  return useMemo(
    () => ({
      dialogs: (
        <AppDialogs
          commandPalette={
            model.commandPaletteOpen ? (
              <LazyCommandPalette
                commands={model.commands}
                onOpenChange={model.setCommandPaletteOpen}
                open={model.commandPaletteOpen}
              />
            ) : null
          }
          settingsDialog={
            model.settingsOpen ? (
              <LazySettingsDialog
                language={model.language}
                onLanguageChange={model.setLanguage}
                onOpenChange={model.setSettingsOpen}
                onThemeChange={model.setTheme}
                open={model.settingsOpen}
                theme={model.theme}
              />
            ) : null
          }
        />
      ),
      editor: (
        <EditorPane
          accessibleTitle={model.documentTitle}
          ariaLabel={model.labels.editor}
          contextMenuItems={model.editor.contextMenuItems}
          onAction={model.runAction}
          onDocumentChanged={() => {
            model.editor.markDocumentDirty();
            model.scheduleOutlineRefresh();
          }}
          onEditorReady={model.editor.onReady}
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
          onAction={model.runAction}
          windowChrome={model.windowControls}
        />
      ),
    }),
    [model],
  );
}
