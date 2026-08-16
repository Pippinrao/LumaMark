import { afterEach, describe, expect, it } from 'vitest';

import type { InvokeCommandFunction } from '../tauri/invokeCommand';
import {
  createDocumentClaimClient,
  resolveDocumentClaimClient,
  type DocumentClaimClient,
  type DocumentClaimReservation,
} from './documentClaimClient';

describe('documentClaimClient', () => {
  afterEach(() => {
    delete window.__LUMAMARK_E2E_DOCUMENT_CLAIMS__;
    delete window.__LUMAMARK_E2E_FILE_COMMANDS__;
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it('maps document claim and focus operations to camelCase Tauri arguments', async () => {
    const calls: Array<{
      args: Record<string, unknown> | undefined;
      command: string;
    }> = [];
    const invokeFn: InvokeCommandFunction = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => {
      calls.push({ args, command });
      const responses: Record<string, unknown> = {
        desktop_focus_window: { status: 'focused' },
        document_claim_begin_session: {
          sessionGeneration: 3,
          status: 'began',
        },
        document_claim_commit: { status: 'committed' },
        document_claim_release: { status: 'released' },
        document_claim_release_owned: { status: 'released' },
        document_claim_release_session: {
          releasedReservations: 0,
          status: 'released',
        },
        document_claim_reserve: { status: 'reserved' },
        document_claim_takeover_session: {
          releasedReservations: 1,
          sessionGeneration: 4,
          status: 'takenOver',
        },
      };
      return responses[command] as T;
    };
    const client = createDocumentClaimClient({
      invokeFn,
      sessionId: 'session-a',
    });

    await expect(client.beginSession()).resolves.toEqual({
      ok: true,
      data: { sessionGeneration: 3, status: 'began' },
    });
    await expect(client.takeoverSession(3)).resolves.toEqual({
      ok: true,
      data: {
        releasedReservations: 1,
        sessionGeneration: 4,
        status: 'takenOver',
      },
    });
    await expect(
      client.reserveDocument({
        operationId: 42,
        path: 'C:\\Notes\\draft.md',
      }),
    ).resolves.toEqual({ ok: true, data: { status: 'reserved' } });
    await expect(
      client.commitReservation(42, 'C:\\Notes\\draft.md'),
    ).resolves.toEqual({ ok: true, data: { status: 'committed' } });
    await expect(
      client.releaseReservation(42, 'C:\\Notes\\draft.md'),
    ).resolves.toEqual({
      ok: true,
      data: { status: 'released' },
    });
    await expect(
      client.releaseOwnedDocument('C:\\Notes\\draft.md'),
    ).resolves.toEqual({ ok: true, data: { status: 'released' } });
    await expect(client.focusWindow('document-7')).resolves.toEqual({
      ok: true,
      data: { status: 'focused' },
    });
    await expect(client.releaseSession()).resolves.toEqual({
      ok: true,
      data: { releasedReservations: 0, status: 'released' },
    });

    expect(calls).toEqual([
      {
        args: { sessionId: 'session-a' },
        command: 'document_claim_begin_session',
      },
      {
        args: {
          expectedActiveGeneration: 3,
          sessionId: 'session-a',
        },
        command: 'document_claim_takeover_session',
      },
      {
        args: {
          operationId: 42,
          path: 'C:\\Notes\\draft.md',
          sessionId: 'session-a',
        },
        command: 'document_claim_reserve',
      },
      {
        args: {
          operationId: 42,
          path: 'C:\\Notes\\draft.md',
          sessionId: 'session-a',
        },
        command: 'document_claim_commit',
      },
      {
        args: {
          operationId: 42,
          path: 'C:\\Notes\\draft.md',
          sessionId: 'session-a',
        },
        command: 'document_claim_release',
      },
      {
        args: { path: 'C:\\Notes\\draft.md', sessionId: 'session-a' },
        command: 'document_claim_release_owned',
      },
      {
        args: { targetWindowLabel: 'document-7' },
        command: 'desktop_focus_window',
      },
      {
        args: { sessionId: 'session-a' },
        command: 'document_claim_release_session',
      },
    ]);
  });

  it('uses the claim client session for claimed file reads and writes', async () => {
    const calls: Array<{
      args: Record<string, unknown> | undefined;
      command: string;
    }> = [];
    const invokeFn: InvokeCommandFunction = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => {
      calls.push({ args, command });
      return (command === 'files_read_text_claimed'
        ? {
            byteLength: 7,
            fingerprint: 'read-fingerprint',
            path: 'C:\\Notes\\draft.md',
            text: '# Draft',
          }
        : {
            byteLength: 7,
            fingerprint: 'write-fingerprint',
            path: 'C:\\Notes\\draft.md',
          }) as T;
    };
    const client = createDocumentClaimClient({
      invokeFn,
      sessionId: 'session-a',
    });

    await expect(
      client.readTextClaimed(42, 'C:\\Notes\\draft.md'),
    ).resolves.toEqual({
      data: {
        byteLength: 7,
        fingerprint: 'read-fingerprint',
        path: 'C:\\Notes\\draft.md',
        text: '# Draft',
      },
      ok: true,
    });
    await expect(
      client.writeTextClaimed(42, 'C:\\Notes\\draft.md', '# Draft'),
    ).resolves.toEqual({
      data: {
        byteLength: 7,
        fingerprint: 'write-fingerprint',
        path: 'C:\\Notes\\draft.md',
      },
      ok: true,
    });

    expect(calls).toEqual([
      {
        args: {
          operationId: 42,
          path: 'C:\\Notes\\draft.md',
          sessionId: 'session-a',
        },
        command: 'files_read_text_claimed',
      },
      {
        args: {
          operationId: 42,
          path: 'C:\\Notes\\draft.md',
          sessionId: 'session-a',
          text: '# Draft',
        },
        command: 'files_write_text_claimed',
      },
    ]);
  });

  it.each<DocumentClaimReservation>([
    { status: 'reserved' },
    { status: 'alreadyPending' },
    { status: 'alreadyReleased' },
    { status: 'alreadyOwned' },
    { status: 'ownedBy', windowLabel: 'document-2' },
  ])('preserves the tagged reserve outcome %#', async (reservation) => {
    const invokeFn: InvokeCommandFunction = async <T>() => reservation as T;
    const client = createDocumentClaimClient({ invokeFn });

    await expect(
      client.reserveDocument({ operationId: 7, path: '/notes/a.md' }),
    ).resolves.toEqual({ ok: true, data: reservation });
  });

  it('preserves an idempotent takeover generation without inventing released reservations', async () => {
    const invokeFn: InvokeCommandFunction = async <T>() =>
      ({ sessionGeneration: 7, status: 'alreadyActive' }) as T;
    const client = createDocumentClaimClient({ invokeFn });

    await expect(client.takeoverSession(7)).resolves.toEqual({
      data: { sessionGeneration: 7, status: 'alreadyActive' },
      ok: true,
    });
  });

  it('preserves the active generation on a rejected stale session transition', async () => {
    const invokeFn: InvokeCommandFunction = async () => {
      throw {
        code: 'document_claim.session_generation_mismatch',
        details: { activeGeneration: 9 },
        message: 'Document claim session generation is stale.',
        recoverable: true,
      };
    };
    const client = createDocumentClaimClient({ invokeFn });

    await expect(client.takeoverSession(7)).resolves.toEqual({
      error: {
        code: 'document_claim.session_generation_mismatch',
        details: { activeGeneration: 9 },
        message: 'Document claim session generation is stale.',
        recoverable: true,
      },
      ok: false,
    });
  });

  it('fails closed for an invalid reserve payload', async () => {
    const invokeFn: InvokeCommandFunction = async <T>() =>
      ({ status: 'ownedBy' }) as T;
    const client = createDocumentClaimClient({ invokeFn });

    await expect(
      client.reserveDocument({ operationId: 8, path: '/notes/a.md' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'document_claim.invalid_response',
        message: 'The document claim response was invalid.',
        recoverable: false,
      },
    });
  });

  it('returns a stable rejected-path error without trying to focus a window', async () => {
    const calls: string[] = [];
    const invokeFn: InvokeCommandFunction = async (command) => {
      calls.push(command);
      throw {
        code: 'document_claim.invalid_path',
        message: 'Document path is invalid.',
        recoverable: false,
      };
    };
    const client = createDocumentClaimClient({ invokeFn });

    await expect(
      client.reserveDocument({ operationId: 9, path: '../draft.md' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'document_claim.invalid_path',
        message: 'Document path is invalid.',
        recoverable: false,
      },
    });
    expect(calls).toEqual(['document_claim_reserve']);
  });

  it('uses an explicit browser seam only when browser clients are allowed', () => {
    const seam = createBrowserSeam();
    window.__LUMAMARK_E2E_DOCUMENT_CLAIMS__ = seam;

    expect(
      resolveDocumentClaimClient({ allowBrowserClient: true }),
    ).toBe(seam);
    expect(
      resolveDocumentClaimClient({ allowBrowserClient: false }),
    ).not.toBe(seam);
  });

  it('fails closed in a browser unless an explicit claim seam is installed', async () => {
    const client = resolveDocumentClaimClient({ allowBrowserClient: true });

    await expect(
      client.reserveDocument({ operationId: 1, path: '/notes/a.md' }),
    ).resolves.toMatchObject({
      error: { code: 'document_claim.unavailable' },
      ok: false,
    });
  });

  it('bridges claimed reads and writes through the browser file-command seam', async () => {
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async (path) => ({
        ok: true,
        data: { byteLength: 12, path, text: '# from seam' },
      }),
      showOpenDialog: async () => ({ ok: true, data: null }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async (path, text) => ({
        ok: true,
        data: { byteLength: text.length, path },
      }),
    };

    const client = resolveDocumentClaimClient({ allowBrowserClient: true });

    await expect(client.beginSession()).resolves.toEqual({
      ok: true,
      data: { sessionGeneration: 1, status: 'began' },
    });
    await expect(
      client.reserveDocument({ operationId: 1, path: '/notes/a.md' }),
    ).resolves.toEqual({ ok: true, data: { status: 'reserved' } });
    await expect(client.readTextClaimed(1, '/notes/a.md')).resolves.toEqual({
      ok: true,
      data: { byteLength: 12, path: '/notes/a.md', text: '# from seam' },
    });
    await expect(
      client.writeTextClaimed(1, '/notes/a.md', '# saved'),
    ).resolves.toEqual({
      ok: true,
      data: { byteLength: 7, path: '/notes/a.md' },
    });
  });

  it('fails closed for malformed mutation and focus outcomes', async () => {
    const invokeFn: InvokeCommandFunction = async <T>() =>
      ({ status: 'unexpected' }) as T;
    const client = createDocumentClaimClient({ invokeFn });

    await expect(
      client.commitReservation(1, '/notes/a.md'),
    ).resolves.toMatchObject({
      error: { code: 'document_claim.invalid_response' },
      ok: false,
    });
    await expect(client.focusWindow('document-1')).resolves.toMatchObject({
      error: { code: 'document_claim.invalid_response' },
      ok: false,
    });
  });

  it('rejects unsafe operation identifiers before invoking native code', async () => {
    const calls: string[] = [];
    const invokeFn: InvokeCommandFunction = async (command) => {
      calls.push(command);
      throw new Error(`unexpected native invocation: ${command}`);
    };
    const client = createDocumentClaimClient({
      invokeFn,
      sessionId: 'session-a',
    });

    await expect(
      client.reserveDocument({
        operationId: Number.MAX_SAFE_INTEGER + 1,
        path: '/notes/a.md',
      }),
    ).resolves.toMatchObject({
      error: { code: 'document_claim.invalid_operation' },
      ok: false,
    });
    await expect(
      client.readTextClaimed(
        Number.MAX_SAFE_INTEGER + 1,
        '/notes/a.md',
      ),
    ).resolves.toMatchObject({
      error: { code: 'document_claim.invalid_operation' },
      ok: false,
    });
    await expect(
      client.writeTextClaimed(
        Number.MAX_SAFE_INTEGER + 1,
        '/notes/a.md',
        '# Draft',
      ),
    ).resolves.toMatchObject({
      error: { code: 'document_claim.invalid_operation' },
      ok: false,
    });
    expect(calls).toEqual([]);
  });

  it('prefers the browser file-command seam over a stubbed Tauri internals object', async () => {
    window.__TAURI_INTERNALS__ = { convertFileSrc: () => '' };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async (path) => ({
        ok: true,
        data: { byteLength: 4, path, text: '# hi' },
      }),
      showOpenDialog: async () => ({ ok: true, data: null }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async (path, text) => ({
        ok: true,
        data: { byteLength: text.length, path },
      }),
    };

    const client = resolveDocumentClaimClient({ allowBrowserClient: true });

    await expect(client.beginSession()).resolves.toEqual({
      ok: true,
      data: { sessionGeneration: 1, status: 'began' },
    });
    await expect(client.readTextClaimed(1, '/notes/a.md')).resolves.toEqual({
      ok: true,
      data: { byteLength: 4, path: '/notes/a.md', text: '# hi' },
    });
  });

  it('fails closed outside Tauri when browser clients are not allowed', async () => {
    const client = resolveDocumentClaimClient({ allowBrowserClient: false });

    await expect(client.focusWindow('document-1')).resolves.toEqual({
      ok: false,
      error: {
        code: 'document_claim.unavailable',
        message: 'Native document claim commands are unavailable.',
        recoverable: false,
      },
    });
  });
});

function createBrowserSeam(): DocumentClaimClient {
  return {
    beginSession: async () => ({
      ok: true,
      data: { sessionGeneration: 1, status: 'began' },
    }),
    commitReservation: async () => ({
      ok: true,
      data: { status: 'committed' },
    }),
    focusWindow: async () => ({ ok: true, data: { status: 'focused' } }),
    releaseOwnedDocument: async () => ({
      ok: true,
      data: { status: 'released' },
    }),
    releaseReservation: async () => ({
      ok: true,
      data: { status: 'released' },
    }),
    releaseSession: async () => ({
      ok: true,
      data: { releasedReservations: 0, status: 'released' },
    }),
    readTextClaimed: async (_operationId, path) => ({
      ok: true,
      data: { byteLength: 0, path, text: '' },
    }),
    reserveDocument: async () => ({
      ok: true,
      data: { status: 'reserved' },
    }),
    takeoverSession: async () => ({
      ok: true,
      data: {
        releasedReservations: 0,
        sessionGeneration: 2,
        status: 'takenOver',
      },
    }),
    writeTextClaimed: async (_operationId, path, text) => ({
      ok: true,
      data: { byteLength: text.length, path },
    }),
  };
}
