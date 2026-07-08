import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function lineCount(source: string): number {
  return source.split(/\r?\n/).length;
}

function expectFileToAvoid(path: string, forbidden: readonly string[]): void {
  const source = readProjectFile(path);

  for (const pattern of forbidden) {
    expect(source, `${path} should not contain ${pattern}`).not.toContain(
      pattern,
    );
  }
}

describe('architecture boundaries', () => {
  it('keeps AppShell as a thin layout instead of a business orchestrator', () => {
    const source = readProjectFile('src/app/shell/AppShell.tsx');

    expect(lineCount(source)).toBeLessThanOrEqual(80);
    expect(source).not.toContain("features/file-actions/fileActions");
    expect(source).not.toContain("features/workspace/workspaceCommands");
    expect(source).not.toContain("editor/widgets/table/tableCommands");
    expect(source).not.toContain("services/files/fileCommandClient");
    expect(source).toContain("from '../controllers/useAppShellModel'");
    expect(source).toContain("from './AppShellView'");
  });

  it('keeps shell render components pure and free of feature behavior', () => {
    const renderFiles = [
      'src/app/shell/AppShellView.tsx',
      'src/app/shell/AppDialogs.tsx',
      'src/app/shell/EditorPane.tsx',
      'src/app/shell/StatusBar.tsx',
      'src/app/shell/TopChrome.tsx',
      'src/app/shell/WorkspaceSidebar.tsx',
    ];
    const forbidden = [
      'useTranslation',
      'useAppStore',
      'useWorkspaceStore',
      'useFileWorkflow',
      'useWorkspaceWorkflow',
      'windowControls',
      '../controllers/',
      '../../services/',
      '../../features/',
      '../../editor/commands/',
      '../../editor/widgets/table/',
    ];

    for (const file of renderFiles) {
      expect(existsSync(join(root, file)), `${file} should exist`).toBe(true);
      expectFileToAvoid(file, forbidden);
    }
  });

  it('splits app orchestration into focused controllers instead of one large hook', () => {
    const expectedControllers = [
      'src/app/controllers/useAppShellModel.ts',
      'src/app/controllers/useAppDocumentModel.ts',
      'src/app/controllers/useAppEditorCommands.ts',
      'src/app/controllers/useAppCommandModels.ts',
      'src/app/controllers/useSettingsModel.ts',
      'src/app/controllers/useWindowControlsModel.ts',
    ];

    for (const file of expectedControllers) {
      expect(existsSync(join(root, file)), `${file} should exist`).toBe(true);
      expect(lineCount(readProjectFile(file)), `${file} should stay focused`).toBeLessThanOrEqual(220);
    }

    expectFileToAvoid('src/app/controllers/useAppController.ts', [
      'lucide-react',
      'copyCurrentMarkdownTable',
      'deleteCurrentMarkdownTable',
      'applyMarkdownFormatCommand',
      'useFileWorkflow',
      'useWorkspaceWorkflow',
    ]);
  });

  it('uses commands feature models as the single menu and palette source', () => {
    const expectedCommandFiles = [
      'src/features/commands/commandTypes.ts',
      'src/features/commands/createCommandModels.ts',
    ];

    for (const file of expectedCommandFiles) {
      expect(existsSync(join(root, file)), `${file} should exist`).toBe(true);
    }

    expectFileToAvoid('src/app/controllers/useAppShellModel.ts', [
      'lucide-react',
      'createTopMenuGroups',
      'createEditorContextMenuItems',
    ]);
  });

  it('keeps Tauri workspace command wrappers in the service layer', () => {
    expect(existsSync(join(root, 'src/services/workspace/workspaceCommands.ts'))).toBe(
      true,
    );
    expect(existsSync(join(root, 'src/features/workspace/workspaceCommands.ts'))).toBe(
      false,
    );
  });

  it('splits Mermaid preview into focused modules behind the existing public entry', () => {
    const expectedModules = [
      'src/editor/widgets/mermaid/mermaidBlockDetection.ts',
      'src/editor/widgets/mermaid/mermaidPreviewExtension.ts',
      'src/editor/widgets/mermaid/MermaidBlockWidget.ts',
      'src/editor/widgets/mermaid/mermaidInlineEditor.ts',
      'src/editor/widgets/mermaid/mermaidWidgetDom.ts',
      'src/editor/widgets/mermaid/mermaidEditingState.ts',
      'src/editor/widgets/mermaid/mermaidRenderAdapter.ts',
    ];

    for (const modulePath of expectedModules) {
      expect(existsSync(join(root, modulePath)), modulePath).toBe(true);
    }

    const publicEntry = readProjectFile('src/editor/widgets/mermaid/MermaidWidget.ts');
    expect(lineCount(publicEntry)).toBeLessThanOrEqual(80);
    expect(publicEntry).toContain('mermaidPreviewExtension');

    const extension = readProjectFile(
      'src/editor/widgets/mermaid/mermaidPreviewExtension.ts',
    );
    expect(lineCount(extension)).toBeLessThanOrEqual(220);
    expect(extension).not.toContain('document.createElement');
    expect(extension).not.toContain('new EditorView');
    expect(extension).not.toContain('mermaid.render');
  });
});
