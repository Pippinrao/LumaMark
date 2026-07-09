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

describe('architecture boundaries', () => {
  it('keeps AppShell as a thin layout instead of a business orchestrator', () => {
    const source = readProjectFile('src/app/shell/AppShell.tsx');

    expect(lineCount(source)).toBeLessThanOrEqual(450);
    expect(source).not.toContain("features/file-actions/fileActions");
    expect(source).not.toContain("features/workspace/workspaceCommands");
    expect(source).not.toContain("editor/widgets/table/tableCommands");
    expect(source).not.toContain("services/files/fileCommandClient");
    expect(source).toContain("from '../controllers/useAppController'");
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
      'src/editor/widgets/mermaid/mermaidEditingState.ts',
      'src/editor/widgets/mermaid/mermaidRenderAdapter.ts',
    ];

    for (const modulePath of expectedModules) {
      expect(existsSync(join(root, modulePath)), modulePath).toBe(true);
    }

    const publicEntry = readProjectFile('src/editor/widgets/mermaid/MermaidWidget.ts');
    expect(lineCount(publicEntry)).toBeLessThanOrEqual(80);
    expect(publicEntry).toContain('mermaidPreviewExtension');
  });
});
