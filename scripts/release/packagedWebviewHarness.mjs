import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

const issuedPorts = new Set();

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
