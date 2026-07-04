import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileActions } from '../../src/features/file-actions/fileActions';
import { markdownFixturePaths } from './fixturePaths';

describe('markdown fixture round-trip', () => {
  it.each(markdownFixturePaths)(
    'preserves the exact source bytes for $name',
    async ({ name, path }) => {
      const source = await readFile(path);
      const tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-round-trip-'));
      const tempPath = join(tempDirectory, name);

      const sourceText = source.toString('utf8');
      const actions = createFileActions({
        commands: {
          readText: async () => ({
            ok: true,
            data: {
              byteLength: source.byteLength,
              path: tempPath,
              text: sourceText,
            },
          }),
          showOpenDialog: async () => ({ ok: true, data: tempPath }),
          showSaveDialog: async () => ({ ok: true, data: tempPath }),
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
        },
        editor: {
          focus: () => undefined,
          getDocumentText: () => sourceText,
          loadDocument: () => undefined,
        },
        recentFiles: {
          addRecentFile: () => undefined,
        },
        state: {
          getState: () => ({
            currentFile: { name, path: tempPath },
            dirty: true,
            dirtyRevision: 0,
            lastFileError: null,
          }),
          setCurrentFile: () => undefined,
          setDirty: () => undefined,
          setLastFileError: () => undefined,
        },
      });

      try {
        const saveResult = await actions.saveCurrentFile();
        const roundTripped = await readFile(tempPath);

        expect(saveResult.ok).toBe(true);
        expect(Buffer.compare(roundTripped, source)).toBe(0);
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    },
  );
});
