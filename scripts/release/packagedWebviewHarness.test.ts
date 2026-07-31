import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

describe('packaged WebView release harness', () => {
  it('reserves a different available debug port for each run', async () => {
    const first = await reserveDebugPort();
    const second = await reserveDebugPort();

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(0);
    expect(second).not.toBe(first);

    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(first, '127.0.0.1', resolve);
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('rejects an explicitly requested port that is already occupied', async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP address for the test server.');
    }

    await expect(reserveDebugPort(address.port)).rejects.toThrow(
      /already in use/i,
    );
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('isolates WebView2 data from an already-running installed app', () => {
    const tempDirectory = join('C:', 'temp', 'lumamark-packaged-webview');
    const environment = createPackagedWebviewEnvironment({
      baseEnvironment: { EXISTING_VALUE: 'preserved' },
      debugPort: 9_334,
      tempDirectory,
    });

    expect(environment).toMatchObject({
      EXISTING_VALUE: 'preserved',
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9334',
      WEBVIEW2_USER_DATA_FOLDER: join(tempDirectory, 'webview2-user-data'),
    });
  });

  it('retries transient WebView2 locks while removing temporary data', async () => {
    const removeDirectory = vi.fn().mockResolvedValue(undefined);

    await removePackagedWebviewTempDirectory(
      join('C:', 'temp', 'lumamark-packaged-webview'),
      removeDirectory,
    );

    expect(removeDirectory).toHaveBeenCalledWith(
      join('C:', 'temp', 'lumamark-packaged-webview'),
      {
        force: true,
        maxRetries: 12,
        recursive: true,
        retryDelay: 250,
      },
    );
  });

  it('makes current production builds inseparable from public release gates', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['test:e2e:production']).toMatch(
      /^pnpm quality:web-build && /,
    );
    expect(packageJson.scripts['release:packaged-webview']).toMatch(
      /^pnpm build && /,
    );
  });
});
