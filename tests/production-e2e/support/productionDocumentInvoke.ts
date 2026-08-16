import type { Page } from '@playwright/test';

export type ProductionDocumentFileState = {
  files: Record<string, string>;
  invokedCommands: string[];
  lastWrite: null | { path: string; text: string };
  openDialogPath: string;
  openedUrls: string[];
  readPaths: string[];
  unexpectedCommands: string[];
  writes: Array<{ path: string; text: string }>;
};

type ProductionDocumentWindow = Window & {
  __LUMAMARK_LINK_NAVIGATION_PRODUCTION_STATE__?: ProductionDocumentFileState;
  __LUMAMARK_PRODUCTION_DOCUMENT_STATE__?: ProductionDocumentFileState;
  __TAURI_INTERNALS__?: Record<string, unknown> & {
    invoke?: (
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
};

export async function installProductionDocumentMock(
  page: Page,
  fixture: {
    files: Record<string, string>;
    openDialogPath: string;
    resolvedPath?: string;
  },
): Promise<void> {
  await page.addInitScript(({ files, openDialogPath, resolvedPath }) => {
    const testWindow = window as ProductionDocumentWindow;
    const state: ProductionDocumentFileState = {
      files: { ...files },
      invokedCommands: [],
      lastWrite: null,
      openDialogPath,
      openedUrls: [],
      readPaths: [],
      unexpectedCommands: [],
      writes: [],
    };
    const existingInternals = testWindow.__TAURI_INTERNALS__ ?? {};
    const previousInvoke = existingInternals.invoke;
    const callbacks =
      existingInternals.callbacks instanceof Map
        ? existingInternals.callbacks
        : new Map<number, (payload: unknown) => void>();
    let nextCallbackId = 1;
    testWindow.__LUMAMARK_PRODUCTION_DOCUMENT_STATE__ = state;
    testWindow.__LUMAMARK_LINK_NAVIGATION_PRODUCTION_STATE__ = state;
    testWindow.__TAURI_INTERNALS__ = {
      ...existingInternals,
      callbacks,
      transformCallback:
        existingInternals.transformCallback ??
        ((callback: (payload: unknown) => void, once?: boolean) => {
          const id = nextCallbackId;
          nextCallbackId += 1;
          callbacks.set(
            id,
            once
              ? (payload: unknown) => {
                  callbacks.delete(id);
                  callback(payload);
                }
              : callback,
          );
          return id;
        }),
      unregisterCallback:
        existingInternals.unregisterCallback ??
        ((id: number) => {
          callbacks.delete(id);
        }),
      invoke: async (command, args = {}) => {
        state.invokedCommands.push(command);
        switch (command) {
          case 'document_claim_begin_session':
            return { sessionGeneration: 1, status: 'began' };
          case 'document_claim_commit':
            return { status: 'committed' };
          case 'document_claim_release':
          case 'document_claim_release_owned':
            return { status: 'released' };
          case 'document_claim_release_session':
            return { releasedReservations: 0, status: 'released' };
          case 'document_claim_reserve':
            return { status: 'reserved' };
          case 'document_claim_takeover_session':
            return {
              releasedReservations: 0,
              sessionGeneration: 2,
              status: 'takenOver',
            };
          case 'desktop_focus_window':
            return { status: 'focused' };
          case 'files_show_open_file_dialog':
            return state.openDialogPath;
          case 'files_show_save_file_dialog':
            return null;
          case 'open_requests_abandon':
          case 'open_requests_acknowledge':
          case 'open_requests_record_applied':
            return undefined;
          case 'open_requests_claim':
          case 'open_requests_recover':
            return [];
          case 'recent_files_add':
          case 'recent_files_get':
            return { files: [], revision: 1 };
          case 'replace_local_image_targets':
          case 'unwatch_document':
            return undefined;
          case 'watch_document':
            return { fingerprint: null };
          case 'settings_get':
            return {
              corruptBackupPath: null,
              hadInvalidFields: false,
              settings: { version: 3 },
              settingsFileExists: false,
              usedDefaultsDueToCorruption: false,
            };
          case 'files_read_text':
          case 'files_read_text_claimed': {
            const path = args.path;
            if (typeof path !== 'string') {
              throw new Error(`${command} did not receive a string path.`);
            }
            state.readPaths.push(path);
            const text =
              state.files[path] ??
              (resolvedPath ? state.files[resolvedPath] : undefined);
            if (text === undefined) {
              throw {
                code: 'file.not_found',
                message: `Missing production E2E file: ${path}`,
                recoverable: true,
              };
            }
            return {
              byteLength: new TextEncoder().encode(text).length,
              path: resolvedPath ?? path,
              text,
            };
          }
          case 'files_write_text':
          case 'files_write_text_claimed': {
            const path = args.path;
            const text = args.text;
            if (typeof path !== 'string' || typeof text !== 'string') {
              throw new Error(`${command} received invalid arguments.`);
            }
            state.files[path] = text;
            state.lastWrite = { path, text };
            state.writes.push({ path, text });
            return {
              byteLength: new TextEncoder().encode(text).length,
              path,
            };
          }
          case 'plugin:event|listen':
            return 1;
          case 'plugin:event|unlisten':
            return null;
          case 'opener_open_url': {
            const url = args.url;
            if (typeof url !== 'string') {
              throw new Error('opener_open_url did not receive a string URL.');
            }
            state.openedUrls.push(url);
            return { opened: true };
          }
          default:
            state.unexpectedCommands.push(command);
            if (previousInvoke) {
              return previousInvoke(command, args);
            }
            throw new Error(`Unexpected production command: ${command}`);
        }
      },
    };
  }, fixture);
}

export async function confirmDiscardIfAsked(page: Page): Promise<void> {
  const discard = page.getByRole('button', {
    name: /^(?:Discard changes|放弃修改)$/,
  });
  try {
    await discard.waitFor({ state: 'visible', timeout: 1500 });
    await discard.click();
  } catch {
    // The current document did not need a discard confirmation.
  }
}

export function readProductionDocumentWrites(page: Page) {
  return page.evaluate(() =>
    (window as ProductionDocumentWindow).__LUMAMARK_PRODUCTION_DOCUMENT_STATE__
      ?.writes ?? [],
  );
}
