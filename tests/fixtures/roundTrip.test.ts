import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScopeHandlers } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { createEditorApi } from '../../src/editor/core/editorApi';
import {
  createFileActions,
  type FileActionState,
} from '../../src/features/file-actions/fileActions';
import { finalizeAllDraftImages } from '../../src/services/assets/assetCommands';
import type { FileCommandClient } from '../../src/services/files/fileCommandClient';
import {
  largeMarkdownFixtureNames,
  markdownFixturePaths,
} from './fixturePaths';

const exactSourceCases = [
  {
    name: 'utf8-bom-crlf-no-final-newline.md',
    source: Buffer.from('\uFEFF# BOM\r\n\r\nBody', 'utf8'),
  },
  {
    name: 'mixed-line-endings.md',
    source: Buffer.from('first\r\nsecond\rthird\nfourth\r\n', 'utf8'),
  },
  {
    name: 'lf-trailing-spaces-no-final-newline.md',
    source: Buffer.from('first  \nsecond\t', 'utf8'),
  },
] as const;

function createState(path: string, name: string) {
  let value: FileActionState = {
    currentFile: { name, path },
    dirty: false,
    dirtyRevision: 0,
    lastFileError: null,
  };

  return {
    getState: () => value,
    setCurrentFile: (currentFile: FileActionState['currentFile']) => {
      value = { ...value, currentFile };
    },
    setDirty: (dirty: boolean) => {
      value = {
        ...value,
        dirty,
        dirtyRevision: dirty
          ? value.dirtyRevision + 1
          : value.dirtyRevision,
      };
    },
    setLastFileError: (
      lastFileError: FileActionState['lastFileError'],
    ) => {
      value = { ...value, lastFileError };
    },
  };
}

function createFileClient(): FileCommandClient {
  return {
    readText: async (path) => {
      const source = await readFile(path);

      return {
        ok: true,
        data: {
          byteLength: source.byteLength,
          path,
          text: source.toString('utf8'),
        },
      };
    },
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    writeText: async (path, text) => {
      await writeFile(path, text, 'utf8');

      return {
        ok: true,
        data: {
          byteLength: Buffer.byteLength(text, 'utf8'),
          path,
        },
      };
    },
  };
}

describe('markdown fixture round-trip', () => {
  it('saves an auto-completed CRLF fence without changing the source envelope', async () => {
    const source = Buffer.from(
      '\uFEFF# CRLF document\r\n\r\n```ts',
      'utf8',
    );
    const expected = Buffer.from(
      '\uFEFF# CRLF document\r\n\r\n```ts\r\n\r\n```',
      'utf8',
    );
    const tempDirectory = await mkdtemp(
      join(tmpdir(), 'lumamark-round-trip-code-block-'),
    );
    const tempPath = join(tempDirectory, 'code-block-crlf.md');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      displayMode: 'livePreview',
      doc: '',
      parent,
    });
    const actions = createFileActions({
      commands: createFileClient(),
      editor,
      prepareTextForSave: async (path, text) =>
        finalizeAllDraftImages({ documentPath: path, text }),
      recentFiles: { addRecentFile: () => undefined },
      state: createState(tempPath, 'code-block-crlf.md'),
    });

    try {
      await writeFile(tempPath, source);
      expect((await actions.openFile(tempPath)).ok).toBe(true);
      editor.view.dispatch({
        selection: { anchor: editor.view.state.doc.length },
      });

      expect(
        runScopeHandlers(
          editor.view,
          new KeyboardEvent('keydown', {
            bubbles: true,
            code: 'Enter',
            key: 'Enter',
          }),
          'editor',
        ),
      ).toBe(true);
      expect(editor.captureDocumentSnapshot().serializedText).toBe(
        expected.toString('utf8'),
      );

      editor.setDisplayMode('source');
      expect(editor.captureDocumentSnapshot().serializedText).toBe(
        expected.toString('utf8'),
      );
      editor.setDisplayMode('livePreview');
      expect(editor.captureDocumentSnapshot().serializedText).toBe(
        expected.toString('utf8'),
      );

      expect((await actions.saveCurrentFile()).ok).toBe(true);
      expect(Buffer.compare(await readFile(tempPath), expected)).toBe(0);
      expect((await actions.openFile(tempPath)).ok).toBe(true);
      expect(editor.captureDocumentSnapshot().serializedText).toBe(
        expected.toString('utf8'),
      );
    } finally {
      editor.destroy();
      parent.remove();
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it('changes one line without changing unrelated mixed line-ending bytes', async () => {
    const source = Buffer.from(
      '\uFEFFfirst\r\nsecond\rthird\nfourth',
      'utf8',
    );
    const expected = Buffer.from(
      '\uFEFFfirst\r\nSECOND\rthird\nfourth',
      'utf8',
    );
    const tempDirectory = await mkdtemp(
      join(tmpdir(), 'lumamark-round-trip-edit-'),
    );
    const tempPath = join(tempDirectory, 'mixed-edit.md');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      displayMode: 'source',
      doc: '',
      parent,
    });
    const actions = createFileActions({
      commands: createFileClient(),
      editor,
      prepareTextForSave: async (path, text) =>
        finalizeAllDraftImages({ documentPath: path, text }),
      recentFiles: { addRecentFile: () => undefined },
      state: createState(tempPath, 'mixed-edit.md'),
    });

    try {
      await writeFile(tempPath, source);
      await actions.openFile(tempPath);
      const second = editor.view.state.doc.toString().indexOf('second');
      editor.view.dispatch({
        changes: {
          from: second,
          insert: 'SECOND',
          to: second + 'second'.length,
        },
      });

      const saveResult = await actions.saveCurrentFile();
      const saved = await readFile(tempPath);
      await actions.openFile(tempPath);

      expect(saveResult.ok).toBe(true);
      expect(Buffer.compare(saved, expected)).toBe(0);
      expect(editor.captureDocumentSnapshot().serializedText).toBe(
        expected.toString('utf8'),
      );
    } finally {
      editor.destroy();
      parent.remove();
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it(
    'passes exact bytes through a real EditorView, save preparation, write, and reopen',
    async () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const editor = createEditorApi({
        displayMode: 'source',
        doc: '',
        parent,
      });
      const largeFixtureNames = new Set<string>(largeMarkdownFixtureNames);
      const fileCases = await Promise.all(
        markdownFixturePaths
          .filter(({ name }) => !largeFixtureNames.has(name))
          .map(async ({ name, path }) => ({
            name,
            source: await readFile(path),
          })),
      );

      try {
        for (const { name, source } of [...fileCases, ...exactSourceCases]) {
          const tempDirectory = await mkdtemp(
            join(tmpdir(), 'lumamark-round-trip-'),
          );
          const tempPath = join(tempDirectory, name);
          const prepareTextForSave = vi.fn(
            async (path: string, text: string) =>
              finalizeAllDraftImages({
                documentPath: path,
                text,
              }),
          );
          await writeFile(tempPath, source);
          const actions = createFileActions({
            commands: createFileClient(),
            editor,
            prepareTextForSave,
            recentFiles: {
              addRecentFile: () => undefined,
            },
            state: createState(tempPath, name),
          });

          try {
            const openResult = await actions.openFile(tempPath);
            const saveResult = await actions.saveCurrentFile();
            const roundTripped = await readFile(tempPath);
            const reopenResult = await actions.openFile(tempPath);

            expect(openResult.ok, `${name}: open`).toBe(true);
            expect(saveResult.ok, `${name}: save`).toBe(true);
            expect(reopenResult.ok, `${name}: reopen`).toBe(true);
            expect(prepareTextForSave, `${name}: prepare`).toHaveBeenCalledWith(
              tempPath,
              source.toString('utf8'),
            );
            expect(
              Buffer.compare(roundTripped, source),
              `${name}: byte diff`,
            ).toBe(0);
            expect(
              editor.captureDocumentSnapshot().serializedText,
              `${name}: reopened editor source`,
            ).toBe(source.toString('utf8'));
          } finally {
            await rm(tempDirectory, { recursive: true, force: true });
          }
        }
      } finally {
        editor.destroy();
        parent.remove();
      }
    },
    120_000,
  );
});
