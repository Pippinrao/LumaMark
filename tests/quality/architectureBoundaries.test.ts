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
      '../../editor/widgets/',
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

  it('keeps editor core and commands behind capability public entries', () => {
    expectFileToAvoid('src/editor/core/editorDisplayMode.ts', [
      '../widgets/',
      '../wysiwyg/',
      '../capabilities/mermaid/',
      '../capabilities/table/',
      '../capabilities/code-block/',
      '../capabilities/image/',
    ]);
    expectFileToAvoid('src/editor/core/createEditorState.ts', [
      '../widgets/',
      '../capabilities/table/tableCommands',
    ]);
    expectFileToAvoid('src/editor/commands/markdownFormatCommands.ts', [
      '../widgets/',
      '../capabilities/table/',
      '../capabilities/code-block/',
    ]);
    expectFileToAvoid('src/editor/commands/editorCommandPort.ts', [
      '../widgets/',
      '../capabilities/table/',
      '../capabilities/mermaid/',
      '../capabilities/code-block/',
      '../capabilities/image/',
    ]);
  });

  it('defines editor capabilities as independent public entry modules', () => {
    const expectedCapabilities = [
      {
        entry: 'src/editor/capabilities/mermaid/createMermaidCapability.ts',
        id: 'mermaid',
      },
      {
        entry: 'src/editor/capabilities/table/createTableCapability.ts',
        id: 'table',
      },
      {
        entry: 'src/editor/capabilities/code-block/createCodeBlockCapability.ts',
        id: 'codeBlock',
      },
      {
        entry: 'src/editor/capabilities/image/createImageCapability.ts',
        id: 'image',
      },
    ];

    expect(existsSync(join(root, 'src/editor/capabilities/editorCapability.ts'))).toBe(true);
    expect(existsSync(join(root, 'src/editor/capabilities/index.ts'))).toBe(true);

    for (const capability of expectedCapabilities) {
      expect(existsSync(join(root, capability.entry)), capability.entry).toBe(true);
      const source = readProjectFile(capability.entry);
      expect(lineCount(source), `${capability.entry} should stay a thin public entry`).toBeLessThanOrEqual(120);
      expect(source).toContain(`id: '${capability.id}'`);
    }
  });

  it('splits Mermaid preview into focused modules behind the existing public entry', () => {
    const expectedModules = [
      'src/editor/capabilities/mermaid/mermaidBlockDetection.ts',
      'src/editor/capabilities/mermaid/mermaidPreviewExtension.ts',
      'src/editor/capabilities/mermaid/MermaidBlockWidget.ts',
      'src/editor/capabilities/mermaid/mermaidInlineEditor.ts',
      'src/editor/capabilities/mermaid/mermaidWidgetDom.ts',
      'src/editor/capabilities/mermaid/mermaidEditingState.ts',
      'src/editor/capabilities/mermaid/mermaidRenderAdapter.ts',
    ];

    for (const modulePath of expectedModules) {
      expect(existsSync(join(root, modulePath)), modulePath).toBe(true);
    }

    const publicEntry = readProjectFile('src/editor/widgets/mermaid/MermaidWidget.ts');
    expect(lineCount(publicEntry)).toBeLessThanOrEqual(80);
    expect(publicEntry).toContain('mermaidPreviewExtension');

    const extension = readProjectFile(
      'src/editor/capabilities/mermaid/mermaidPreviewExtension.ts',
    );
    expect(lineCount(extension)).toBeLessThanOrEqual(220);
    expect(extension).not.toContain('document.createElement');
    expect(extension).not.toContain('new EditorView');
    expect(extension).not.toContain('mermaid.render');
  });

  it('keeps table code block and image capabilities out of legacy widget and wysiwyg internals', () => {
    const expectedModules = [
      'src/editor/capabilities/table/createTableCapability.ts',
      'src/editor/capabilities/table/tableCommands.ts',
      'src/editor/capabilities/table/tablePreviewExtension.ts',
      'src/editor/capabilities/code-block/createCodeBlockCapability.ts',
      'src/editor/capabilities/code-block/codeBlockCommands.ts',
      'src/editor/capabilities/code-block/codeBlockDecorations.ts',
      'src/editor/capabilities/image/createImageCapability.ts',
      'src/editor/capabilities/image/imagePreviewExtension.ts',
    ];

    for (const modulePath of expectedModules) {
      expect(existsSync(join(root, modulePath)), modulePath).toBe(true);
    }

    expectFileToAvoid('src/editor/wysiwyg/markdownDecorations.ts', [
      "kind: 'codeBlock'",
      'lm-md-code-block',
      "case 'FencedCode'",
    ]);

    expectFileToAvoid('src/editor/widgets/table/TableWidget.ts', [
      'codemirror-markdown-tables',
      'markdownTables',
    ]);
    expectFileToAvoid('src/editor/widgets/image/ImageWidget.ts', [
      'class ImageBlockWidget',
      'syntaxTree',
    ]);
  });
});
