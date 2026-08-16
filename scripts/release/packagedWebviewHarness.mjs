import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

const issuedPorts = new Set();
const ACCEPTANCE_TEMP_PREFIX = 'lumamark-menu-context-os-';
const ACCEPTANCE_SETTINGS_CONFIG_LEAF = 'settings-config';

export function isRetryableCodeMirrorSnapshotError(error) {
  return (
    error instanceof Error &&
    /\bNo tile at position \d+\b/u.test(error.message)
  );
}

const LOCAL_DESKTOP_HOSTS = new Set([
  '127.0.0.1',
  'ipc.localhost',
  'localhost',
  'tauri.localhost',
]);

export function isRemoteDesktopRequest(url, appOrigin) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    if (LOCAL_DESKTOP_HOSTS.has(parsed.hostname)) {
      return false;
    }
    if (appOrigin && parsed.origin === appOrigin) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export function createPackagedWebviewEnvironment({
  baseEnvironment,
  debugPort,
  tempDirectory,
}) {
  assertValidPort(debugPort);
  if (typeof tempDirectory !== 'string' || tempDirectory.length === 0) {
    throw new Error('A temporary directory is required for packaged WebView2 data.');
  }

  return {
    ...baseEnvironment,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    WEBVIEW2_USER_DATA_FOLDER: join(tempDirectory, 'webview2-user-data'),
  };
}

export async function createAcceptanceSettingsEnvironment({
  baseEnvironment,
  debugPort,
  tempDirectory,
}) {
  const rootName = tempDirectory.split(/[/\\]/).filter(Boolean).at(-1) ?? '';
  if (!rootName.startsWith(ACCEPTANCE_TEMP_PREFIX)) {
    throw new Error(
      'Acceptance settings isolation requires a lumamark-menu-context-os- temporary root.',
    );
  }

  const settingsConfigDirectory = join(
    tempDirectory,
    ACCEPTANCE_SETTINGS_CONFIG_LEAF,
  );
  await mkdir(settingsConfigDirectory, { recursive: true });
  return createPackagedWebviewEnvironment({
    baseEnvironment: {
      ...baseEnvironment,
      LUMAMARK_ACCEPTANCE_MODE: '1',
      LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR: settingsConfigDirectory,
    },
    debugPort,
    tempDirectory,
  });
}

export async function removePackagedWebviewTempDirectory(
  tempDirectory,
  removeDirectory = rm,
) {
  await removeDirectory(tempDirectory, {
    force: true,
    maxRetries: 12,
    recursive: true,
    retryDelay: 250,
  });
}

export async function reserveDebugPort(requestedPort) {
  if (requestedPort !== undefined) {
    assertValidPort(requestedPort);
    await assertPortAvailable(requestedPort);
    issuedPorts.add(requestedPort);
    return requestedPort;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await findAvailablePort();
    if (!issuedPorts.has(port)) {
      issuedPorts.add(port);
      return port;
    }
  }

  throw new Error('Unable to select a unique WebView2 debugging port.');
}

function assertValidPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid WebView2 debugging port: ${port}`);
  }
}

async function assertPortAvailable(port) {
  try {
    await listenAndClose(port);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EADDRINUSE') {
      throw new Error(`WebView2 debugging port ${port} is already in use.`, {
        cause: error,
      });
    }
    throw error;
  }
}

async function findAvailablePort() {
  return listenAndClose(0);
}

function listenAndClose(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to resolve the WebView2 debugging port.'));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}
