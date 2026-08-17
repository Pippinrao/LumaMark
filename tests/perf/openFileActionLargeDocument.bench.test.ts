import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEditorApi } from '../../src/editor/core/editorApi';
import { createFileActions } from '../../src/features/file-actions/fileActions';
import { parseMarkdownOutlineFromState } from '../../src/features/outline/outlineParser';
import type { FileCommandClient } from '../../src/services/files/fileCommandClient';
import type { FileMetadata } from '../../src/services/files/fileTypes';
import type { CommandError } from '../../src/services/tauri/invokeCommand';
import { largeMarkdownFixturePaths } from '../fixtures/fixturePaths';

const OUTLINE_UPDATE_DELAY_MS = 120;

const openBudgetsMs: Record<string, number> = {
  'large-1mb.md': 300,
  'large-5mb.md': 1_000,
  'large-10mb.md': 2_000,
};

const outlineBudgetsMs: Record<string, number> = {
  'large-1mb.md': 50,
  'large-5mb.md': 150,
  'large-10mb.md': 300,
};

let originalRangeGetBoundingClientRect:
  | Range['getBoundingClientRect']
  | undefined;
let originalRangeGetClientRects: Range['getClientRects'] | undefined;

describe('large Markdown file action open baseline', () => {
  beforeAll(() => {
    originalRangeGetBoundingClientRect =
      globalThis.Range?.prototype.getBoundingClientRect;
    originalRangeGetClientRects = globalThis.Range?.prototype.getClientRects;

    if (globalThis.Range && !originalRangeGetBoundingClientRect) {
      globalThis.Range.prototype.getBoundingClientRect = () =>
        new DOMRect(0, 0, 0, 0);
    }

    if (globalThis.Range && !originalRangeGetClientRects) {
      globalThis.Range.prototype.getClientRects = () =>
        [] as unknown as DOMRectList;
    }
  });

  afterAll(() => {
    if (!globalThis.Range) {
      return;
    }

    if (originalRangeGetBoundingClientRect) {
      globalThis.Range.prototype.getBoundingClientRect =
        originalRangeGetBoundingClientRect;
    } else {
      Reflect.deleteProperty(
        globalThis.Range.prototype,
        'getBoundingClientRect',
      );
    }

    if (originalRangeGetClientRects) {
      globalThis.Range.prototype.getClientRects = originalRangeGetClientRects;
    } else {
      Reflect.deleteProperty(globalThis.Range.prototype, 'getClientRects');
    }
  });

  it.each(largeMarkdownFixturePaths)(
    'opens $name and refreshes outline through the application file action without freezing',
    async ({ name, path }) => {
      const source = await readFile(path, 'utf8');
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      let outlineDurationMs = 0;
      let outlineHeadingCount = 0;
      let outlineRefreshCount = 0;
      let outlineRefreshTimer: number | null = null;
      let resolveOutlineRefresh: (() => void) | null = null;
      const outlineRefreshed = new Promise<void>((resolve) => {
        resolveOutlineRefresh = resolve;
      });
      const editor = createEditorApi({
        doc: '',
        onDocumentChanged: () => {
          if (outlineRefreshTimer !== null) {
            window.clearTimeout(outlineRefreshTimer);
          }

          outlineRefreshTimer = window.setTimeout(() => {
            outlineRefreshTimer = null;
            const outlineStartedAt = performance.now();
            const headings = parseMarkdownOutlineFromState(editor.view.state);
            outlineDurationMs = performance.now() - outlineStartedAt;
            outlineHeadingCount = headings.length;
            outlineRefreshCount += 1;
            resolveOutlineRefresh?.();
          }, OUTLINE_UPDATE_DELAY_MS);
        },
        parent,
      });
      const state = createFileActionStateAdapter();
      const recentFiles = {
        addRecentFile: vi.fn(),
      };
      const commands = createReadOnlyFileCommandClient(path, source);
      const actions = createFileActions({
        commands,
        editor,
        recentFiles,
        state,
      });

      const startedAt = performance.now();
      const result = await actions.openFile(path);
      const durationMs = performance.now() - startedAt;
      await outlineRefreshed;

      process.stdout.write(
        `[perf:open-file-action] ${name}: open action ${durationMs.toFixed(2)} ms, outline ${outlineDurationMs.toFixed(2)} ms\n`,
      );

      expect(result.ok).toBe(true);
      expect(editor.getDocumentText()).toBe(source);
      expect(state.getState().currentFile?.path).toBe(path);
      expect(state.getState().dirty).toBe(false);
      expect(recentFiles.addRecentFile).toHaveBeenCalledWith(
        expect.objectContaining({ path }),
      );
      expect(durationMs).toBeLessThan(openBudgetsMs[name]);
      expect(outlineRefreshCount).toBe(1);
      expect(outlineHeadingCount).toBeGreaterThan(0);
      expect(outlineDurationMs).toBeLessThan(outlineBudgetsMs[name]);

      editor.destroy();
      parent.remove();
    },
  );
});

function createReadOnlyFileCommandClient(
  path: string,
  text: string,
): FileCommandClient {
  return {
    readText: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        byteLength: Buffer.byteLength(text, 'utf8'),
        path,
        text,
      },
    }),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    writeText: vi.fn(),
  };
}

function createFileActionStateAdapter() {
  let currentFile: FileMetadata | null = null;
  let dirty = true;
  let dirtyRevision = 1;
  let lastFileError: CommandError | null = null;

  return {
    getState: () => ({
      currentFile,
      dirty,
      dirtyRevision,
      lastFileError,
    }),
    setCurrentFile: (nextCurrentFile: FileMetadata | null) => {
      currentFile = nextCurrentFile;
    },
    setDirty: (nextDirty: boolean) => {
      dirty = nextDirty;
      if (nextDirty) {
        dirtyRevision += 1;
      }
    },
    setLastFileError: (nextLastFileError: CommandError | null) => {
      lastFileError = nextLastFileError;
    },
  };
}
