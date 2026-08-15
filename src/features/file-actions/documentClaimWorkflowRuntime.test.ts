import { describe, expect, it } from 'vitest';
import type { DocumentClaimClient } from '../../services/window/documentClaimClient';
import {
  enqueueDocumentClaimMutation,
  enqueueDocumentClaimSave,
  getDocumentClaimWorkflowMountGeneration,
  isDocumentClaimWorkflowMountCurrent,
  nextDocumentClaimOperationId,
  registerDocumentClaimWorkflowMount,
  resolveDocumentClaimWorkflowRuntime,
  waitForDocumentClaimWorkflowMount,
} from './documentClaimWorkflowRuntime';

describe('documentClaimWorkflowRuntime', () => {
  it('persists session-scoped workflow state for the same claim client only', () => {
    const firstClient = {} as DocumentClaimClient;
    const secondClient = {} as DocumentClaimClient;

    const firstRuntime = resolveDocumentClaimWorkflowRuntime(firstClient);
    firstRuntime.ownershipBlockedError = {
      code: 'document_claim.ownership_unknown',
      message: 'Ownership is unknown.',
      recoverable: true,
    };

    expect(resolveDocumentClaimWorkflowRuntime(firstClient)).toBe(firstRuntime);
    expect(
      resolveDocumentClaimWorkflowRuntime(firstClient).ownershipBlockedError,
    ).toEqual(firstRuntime.ownershipBlockedError);
    expect(resolveDocumentClaimWorkflowRuntime(secondClient)).not.toBe(
      firstRuntime,
    );
    expect(
      resolveDocumentClaimWorkflowRuntime(secondClient).ownershipBlockedError,
    ).toBeNull();
  });

  it('allocates monotonic safe operation ids and fails closed at exhaustion', () => {
    const runtime = resolveDocumentClaimWorkflowRuntime(
      {} as DocumentClaimClient,
    );

    expect(nextDocumentClaimOperationId(runtime)).toEqual({
      ok: true,
      operationId: 1,
    });
    expect(nextDocumentClaimOperationId(runtime)).toEqual({
      ok: true,
      operationId: 2,
    });

    runtime.operationId = Number.MAX_SAFE_INTEGER;
    const exhausted = nextDocumentClaimOperationId(runtime);

    expect(exhausted).toMatchObject({
      error: { code: 'document_claim.operation_id_exhausted' },
      ok: false,
    });
    expect(runtime.ownershipBlockedError).toMatchObject({
      code: 'document_claim.operation_id_exhausted',
    });
    expect(runtime.operationId).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(runtime.operationId)).toBe(true);
  });

  it('serializes saves and document mutations for every remount using the same client', async () => {
    const client = {} as DocumentClaimClient;
    const firstRuntime = resolveDocumentClaimWorkflowRuntime(client);
    const secondRuntime = resolveDocumentClaimWorkflowRuntime(client);
    let finishFirstSave!: () => void;
    const firstSavePending = new Promise<void>((resolve) => {
      finishFirstSave = resolve;
    });
    const events: string[] = [];

    const firstSave = enqueueDocumentClaimSave(firstRuntime, async () => {
      events.push('save:start');
      await firstSavePending;
      events.push('save:end');
    });
    const mutation = enqueueDocumentClaimMutation(secondRuntime, async () => {
      events.push('rename');
    });
    const secondSave = enqueueDocumentClaimSave(secondRuntime, async () => {
      events.push('save:second');
    });

    await Promise.resolve();
    expect(events).toEqual(['save:start']);

    finishFirstSave();
    await Promise.all([firstSave, mutation, secondSave]);
    expect(events).toEqual([
      'save:start',
      'save:end',
      'rename',
      'save:second',
    ]);
  });

  it('installs the mutation tail before a synchronous operation can enqueue again', async () => {
    const runtime = resolveDocumentClaimWorkflowRuntime(
      {} as DocumentClaimClient,
    );
    const events: string[] = [];
    let nestedMutation: Promise<void> | null = null;

    const outerMutation = enqueueDocumentClaimMutation(runtime, async () => {
      events.push('outer:start');
      nestedMutation = enqueueDocumentClaimMutation(runtime, async () => {
        events.push('nested');
      });
      events.push('outer:end');
    });

    expect(events).toEqual([]);
    await outerMutation;
    await nestedMutation;
    expect(events).toEqual(['outer:start', 'outer:end', 'nested']);
  });

  it('continues the mutation queue after a rejected operation', async () => {
    const runtime = resolveDocumentClaimWorkflowRuntime(
      {} as DocumentClaimClient,
    );
    const events: string[] = [];
    const rejected = enqueueDocumentClaimMutation(runtime, async () => {
      events.push('rejected');
      throw new Error('mutation failed');
    });
    const recovered = enqueueDocumentClaimMutation(runtime, async () => {
      events.push('recovered');
    });

    await expect(rejected).rejects.toThrow('mutation failed');
    await expect(recovered).resolves.toBeUndefined();
    expect(events).toEqual(['rejected', 'recovered']);
  });

  it('hands terminal work to the newest mounted workflow after a remount', async () => {
    const runtime = resolveDocumentClaimWorkflowRuntime(
      {} as DocumentClaimClient,
    );
    const oldMount = {
      getEditor: () => null,
      getStateAdapter: () => ({
        getState: () => ({
          currentFile: null,
          dirty: false,
          dirtyRevision: 0,
          lastFileError: null,
        }),
        setCurrentFile: () => undefined,
        setDirty: () => undefined,
        setLastFileError: () => undefined,
      }),
      id: Symbol('old'),
      onDocumentBecameSafe: () => undefined,
      onDocumentLoaded: () => undefined,
      replaceWatchedDocument: async () => ({ status: 'ready' as const }),
      setLastFileError: () => undefined,
      setStatusKey: () => undefined,
    };
    const removeOldMount = registerDocumentClaimWorkflowMount(
      runtime,
      oldMount,
    );
    const oldGeneration = getDocumentClaimWorkflowMountGeneration(
      runtime,
      oldMount.id,
    );
    expect(oldGeneration).toBe(1);
    expect(
      isDocumentClaimWorkflowMountCurrent(runtime, oldGeneration!),
    ).toBe(true);
    removeOldMount();

    const pendingMount = waitForDocumentClaimWorkflowMount(
      runtime,
      oldGeneration!,
    );
    let settled = false;
    void pendingMount.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    const newMount = { ...oldMount, id: Symbol('new') };
    registerDocumentClaimWorkflowMount(runtime, newMount);

    await expect(pendingMount).resolves.toMatchObject({
      ...newMount,
      generation: 2,
    });
    expect(
      isDocumentClaimWorkflowMountCurrent(runtime, oldGeneration!),
    ).toBe(false);
    expect(
      isDocumentClaimWorkflowMountCurrent(
        runtime,
        getDocumentClaimWorkflowMountGeneration(runtime, newMount.id)!,
      ),
    ).toBe(true);
  });
});
