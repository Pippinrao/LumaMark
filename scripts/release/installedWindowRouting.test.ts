import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertExactWindowMarkerMap,
  assertExactlyOnceDurableTrace,
  assertDurableUnchanged,
  assertOwnedProcessIdentity,
  assertOwnedRoutingCleanupContract,
  assertPrimaryRoutingDiagnostics,
  assertSameRoutingEnvironment,
  captureStrictPrimaryProcessEvidence,
  createBoundedProcessOutput,
  createRoutingEnvironment,
  inspectChildTerminalOutcome,
  inspectDurableSnapshot,
  observeChildClose,
  observeChildExit,
  PRIMARY_ROUTING_DIAGNOSTIC_ALLOWLIST,
  readExactRoutingWindowSnapshots,
  settleFailedPrimaryProcessEvidence,
  terminateDirectChild,
} from './installedWindowRoutingHelpers.mjs';

type LifecycleKind =
  | 'appliedPendingAcknowledgement'
  | 'completed'
  | 'processing'
  | 'queued';

function snapshot({
  attempt = '0',
  kind = 'completed',
  nextAttemptSequence = 1,
  nextRequestId = 1,
  path = 'C:\\Notes\\draft.md',
  requestIds = ['0'],
  retained = false,
  target = 'main',
}: {
  attempt?: string;
  kind?: LifecycleKind;
  nextAttemptSequence?: number;
  nextRequestId?: number;
  path?: string;
  requestIds?: string[];
  retained?: boolean;
  target?: string;
} = {}) {
  const completed = kind === 'completed';
  const payload = { path, targetWindow: target };
  return {
    lifecycle: {
      acknowledgedRanges:
        completed && requestIds.length > 0
          ? [{ startSequence: 0, endSequenceExclusive: requestIds.length }]
          : [],
      nextAttemptSequence,
      nextSequence: requestIds.length,
      recentCompletionFences: completed
        ? requestIds.map((requestId, sequence) => ({
            attemptToken: String(Number(attempt) + sequence),
            owner: target,
            requestId,
            sequence,
          }))
        : [],
      records: completed
        ? []
        : requestIds.map((requestId, sequence) => ({
            ...(kind === 'appliedPendingAcknowledgement' ? {} : { payload }),
            requestId,
            sequence,
            state:
              kind === 'queued'
                ? { kind }
                : {
                    attemptToken: String(Number(attempt) + sequence),
                    kind,
                    owner: target,
                    ...(kind === 'processing' ? { leaseExpiresAt: 10 } : {}),
                  },
          })),
    },
    nextRequestId,
    retainedRequests:
      retained && !completed
        ? requestIds.map((requestId) => ({
            identity: {
              lexicalAlias: 'windows-drive:c:/notes/draft.md',
              resolved: 'windows-drive:c:/notes/draft.md',
            },
            payload,
            requestId,
          }))
        : [],
    version: 2,
  };
}

describe('installed window-routing acceptance helpers', () => {
  it('binds every expected marker to its exact managed-window label', () => {
    const expected = {
      'document-1': 'secondary-marker',
      'document-2': 'unc-marker',
      main: 'primary-marker',
    };
    const knownMarkers = Object.values(expected);
    const valid = [
      { content: '# Primary\nprimary-marker', label: 'main' },
      { content: '# Secondary\nsecondary-marker', label: 'document-1' },
      { content: '# UNC\nunc-marker', label: 'document-2' },
    ];

    expect(() =>
      assertExactWindowMarkerMap(valid, expected, knownMarkers),
    ).not.toThrow();
    for (const invalid of [
      [
        { content: '# Secondary\nsecondary-marker', label: 'main' },
        { content: '# Primary\nprimary-marker', label: 'document-1' },
        { content: '# UNC\nunc-marker', label: 'document-2' },
      ],
      [
        { content: '# Primary\nprimary-marker', label: 'main' },
        { content: '# Secondary\nsecondary-marker', label: 'document-1' },
        { content: '# Secondary again\nsecondary-marker', label: 'document-2' },
      ],
      [
        { content: '# Primary\nprimary-marker', label: 'main' },
        { content: '# Wrong\nunc-marker', label: 'document-1' },
        { content: '# Secondary\nsecondary-marker', label: 'document-2' },
      ],
      [
        {
          content: '# Swallowed\nprimary-marker\nsecondary-marker\nunc-marker',
          label: 'main',
        },
      ],
      [
        { content: '# Primary\nprimary-marker\nprimary-marker', label: 'main' },
        { content: '# Secondary\nsecondary-marker', label: 'document-1' },
        { content: '# UNC\nunc-marker', label: 'document-2' },
      ],
    ]) {
      expect(() =>
        assertExactWindowMarkerMap(invalid, expected, knownMarkers),
      ).toThrow(/marker|label|window/i);
    }

    expect(() =>
      assertExactWindowMarkerMap(
        [
          {
            content: '# Aggregate\nsecondary-marker\nprimary-marker',
            label: 'main',
          },
        ],
        { main: 'secondary-marker' },
        knownMarkers,
      ),
    ).toThrow(/marker|window/i);
    expect(() =>
      assertExactWindowMarkerMap(
        [{ content: '# Aggregate\nsecondary-marker', label: 'main' }],
        { main: 'secondary-marker' },
        knownMarkers,
      ),
    ).not.toThrow();
  });

  it('constructs one isolated marker/config contract and rejects launch drift', () => {
    const routing = createRoutingEnvironment(
      {
        lumamark_acceptance_mode: '0',
        LuMaMaRk_AcCePtAnCe_SeTtInGs_CoNfIg_DiR: 'C:\\Users\\real-user',
        lumamark_acceptance_settings_write_barrier_dir:
          'C:\\Temp\\stale-lowercase-barrier',
        lumamark_routing_acceptance_mode: '0',
        LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR:
          'C:\\Temp\\stale-menu-barrier',
        PATH: 'system-path',
      },
      'C:\\Temp\\owned\\settings-config',
    );
    const primary = { ...routing, WEBVIEW2_USER_DATA_FOLDER: 'primary-profile' };

    expect(routing).toMatchObject({
      LUMAMARK_ACCEPTANCE_MODE: '1',
      LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR:
        'C:\\Temp\\owned\\settings-config',
      LUMAMARK_ROUTING_ACCEPTANCE_MODE: '1',
    });
    expect(routing).not.toHaveProperty(
      'LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR',
    );
    const controlledKeys = Object.keys(routing).filter((key) =>
      [
        'lumamark_acceptance_mode',
        'lumamark_acceptance_settings_config_dir',
        'lumamark_acceptance_settings_write_barrier_dir',
        'lumamark_routing_acceptance_mode',
      ].includes(key.toLowerCase()),
    );
    expect(controlledKeys.sort()).toEqual([
      'LUMAMARK_ACCEPTANCE_MODE',
      'LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR',
      'LUMAMARK_ROUTING_ACCEPTANCE_MODE',
    ]);
    expect(() => assertSameRoutingEnvironment(routing, primary)).not.toThrow();
    expect(() =>
      assertSameRoutingEnvironment(routing, {
        ...primary,
        LUMAMARK_ROUTING_ACCEPTANCE_MODE: '0',
      }),
    ).toThrow(/routing environment/i);
    expect(() =>
      assertSameRoutingEnvironment(routing, {
        ...primary,
        LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR:
          'C:\\Users\\real-user\\AppData',
      }),
    ).toThrow(/routing environment/i);
    expect(() =>
      assertSameRoutingEnvironment(routing, {
        ...primary,
        LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR:
          'C:\\Temp\\injected-barrier',
      }),
    ).toThrow(/routing environment/i);
    expect(() =>
      assertSameRoutingEnvironment(routing, {
        ...primary,
        lumamark_acceptance_settings_write_barrier_dir:
          'C:\\Temp\\injected-lowercase-barrier',
      }),
    ).toThrow(/routing environment/i);
    expect(() =>
      assertSameRoutingEnvironment(routing, {
        ...primary,
        lumamark_routing_acceptance_mode: '0',
      }),
    ).toThrow(/routing environment/i);
    const lowercaseRequired = { ...primary };
    delete lowercaseRequired.LUMAMARK_ROUTING_ACCEPTANCE_MODE;
    lowercaseRequired.lumamark_routing_acceptance_mode = '1';
    expect(() =>
      assertSameRoutingEnvironment(routing, lowercaseRequired),
    ).toThrow(/routing environment/i);
  });

  it('requires every raw page to produce one app-shell routing snapshot', async () => {
    const loaded = {
      appShellReady: true,
      content: '# Loaded',
      label: 'main',
    };
    await expect(
      readExactRoutingWindowSnapshots([loaded], 1, async (page) => page),
    ).resolves.toEqual([loaded]);

    await expect(
      readExactRoutingWindowSnapshots(
        [loaded, null],
        1,
        async (page) => page,
      ),
    ).rejects.toMatchObject({
      windowObservation: {
        expectedCount: 1,
        pageCount: 2,
        unreadableCount: 1,
      },
    });
    await expect(
      readExactRoutingWindowSnapshots(
        [loaded, { throws: true }],
        2,
        async (page) => {
          if (page?.throws) throw new Error('private page failure');
          return page;
        },
      ),
    ).rejects.toMatchObject({
      message: expect.not.stringContaining('private page failure'),
      windowObservation: {
        expectedCount: 2,
        pageCount: 2,
        unreadableCount: 1,
      },
    });
  });

  it('proves one request/attempt reached completed and rejects stale or duplicate apply traces', () => {
    const baseline = snapshot({
      nextAttemptSequence: 0,
      nextRequestId: 0,
      requestIds: [],
    });
    const processing = snapshot({ kind: 'processing', retained: true });
    const applied = snapshot({
      kind: 'appliedPendingAcknowledgement',
      retained: true,
    });
    const completed = snapshot();

    expect(
      assertExactlyOnceDurableTrace({
        baseline,
        finalSnapshot: completed,
        observations: [completed, completed],
        stableObservationCount: 2,
        targetWindow: 'main',
      }),
    ).toMatchObject({
      attemptToken: '0',
      completionFenceObserved: true,
      finalHighWater: { attempts: 1, requests: 1, sequences: 1 },
      observedLifecycleStates: [],
      requestId: '0',
      stableObservationCount: 2,
    });

    const duplicateCompleted = snapshot({
      nextAttemptSequence: 2,
      nextRequestId: 2,
      requestIds: ['0', '1'],
    });
    expect(() =>
      assertExactlyOnceDurableTrace({
        baseline,
        finalSnapshot: duplicateCompleted,
        observations: [processing, duplicateCompleted],
        stableObservationCount: 1,
        targetWindow: 'main',
      }),
    ).toThrow(/exactly one/i);

    expect(() =>
      assertExactlyOnceDurableTrace({
        baseline,
        finalSnapshot: applied,
        observations: [processing, baseline, applied],
        stableObservationCount: 1,
        targetWindow: 'main',
      }),
    ).toThrow(/stale|active|completed/i);

    expect(() =>
      assertDurableUnchanged(completed, [completed, completed], completed),
    ).not.toThrow();
    expect(() =>
      assertDurableUnchanged(completed, [duplicateCompleted], duplicateCompleted),
    ).toThrow(/changed/i);
  });

  it('accepts only the bounded active-record plus completion-fence durable schema', () => {
    const completed = snapshot();
    expect(inspectDurableSnapshot(completed)).toMatchObject({
      acknowledgedRanges: [{ startSequence: 0, endSequenceExclusive: 1 }],
      completionFences: [
        {
          attemptToken: '0',
          owner: 'main',
          requestId: '0',
          sequence: 0,
        },
      ],
      nextRequestId: 1,
      nextSequence: 1,
      records: [],
    });

    const completedRecord = structuredClone(completed);
    completedRecord.lifecycle.records.push({
      payload: {
        path: 'C:\\Notes\\draft.md',
        targetWindow: 'main',
      },
      requestId: '0',
      sequence: 0,
      state: { attemptToken: '0', kind: 'completed', owner: 'main' },
    });
    expect(() => inspectDurableSnapshot(completedRecord)).toThrow(
      /active|completed|coverage/i,
    );

    const gap = structuredClone(completed);
    gap.lifecycle.acknowledgedRanges = [];
    gap.lifecycle.recentCompletionFences = [];
    expect(() => inspectDurableSnapshot(gap)).toThrow(/cover/i);

    const mismatchedFence = structuredClone(completed);
    mismatchedFence.lifecycle.recentCompletionFences[0].requestId = '7';
    expect(() => inspectDurableSnapshot(mismatchedFence)).toThrow(
      /fence|request/i,
    );

    const exhaustedAttempt = structuredClone(completed);
    exhaustedAttempt.lifecycle.recentCompletionFences[0].attemptToken = '1';
    expect(() => inspectDurableSnapshot(exhaustedAttempt)).toThrow(/attempt/i);

    const duplicateAttempt = snapshot({
      nextAttemptSequence: 2,
      nextRequestId: 2,
      requestIds: ['0', '1'],
    });
    duplicateAttempt.lifecycle.recentCompletionFences[1].attemptToken = '0';
    expect(() => inspectDurableSnapshot(duplicateAttempt)).toThrow(/attempt/i);
  });

  it('rejects a PID, executable, start-time, or cleanup ownership mismatch', () => {
    const expected = {
      executablePath: 'C:\\Build\\lumamark.exe',
      processId: 42,
      startTimeUtc: '2026-08-15T00:00:00.0000000Z',
    };
    expect(() => assertOwnedProcessIdentity(expected, expected)).not.toThrow();
    for (const actual of [
      { ...expected, processId: 43 },
      { ...expected, executablePath: 'C:\\Other\\lumamark.exe' },
      { ...expected, startTimeUtc: '2026-08-15T00:00:01.0000000Z' },
    ]) {
      expect(() => assertOwnedProcessIdentity(actual, expected)).toThrow(
        /process identity/i,
      );
    }

    const cleanup = {
      canonicalConfig: 'C:\\Temp\\lumamark-menu-context-os-routing-a\\settings-config',
      canonicalSystemTemp: 'C:\\Temp',
      canonicalTemp: 'C:\\Temp\\lumamark-menu-context-os-routing-a',
      marker: {
        configDirectory:
          'C:\\Temp\\lumamark-menu-context-os-routing-a\\settings-config',
        ownershipToken: 'owned-token',
        tempDirectory: 'C:\\Temp\\lumamark-menu-context-os-routing-a',
      },
      ownershipToken: 'owned-token',
    };
    expect(() => assertOwnedRoutingCleanupContract(cleanup)).not.toThrow();
    expect(() =>
      assertOwnedRoutingCleanupContract({
        ...cleanup,
        marker: { ...cleanup.marker, ownershipToken: 'wrong-token' },
      }),
    ).toThrow(/ownership marker/i);
  });

  it('observes one child terminal event even when the process already exited', async () => {
    const alreadyExited = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    };
    alreadyExited.exitCode = 0;
    alreadyExited.signalCode = null;
    await expect(observeChildExit(alreadyExited)).resolves.toEqual({
      exitCode: 0,
      signal: null,
    });

    const alreadySignaled = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    };
    alreadySignaled.exitCode = null;
    alreadySignaled.signalCode = 'SIGTERM';
    await expect(
      Promise.race([
        observeChildExit(alreadySignaled),
        Promise.resolve({ pendingObserverWon: true }),
      ]),
    ).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' });

    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    };
    child.exitCode = null;
    child.signalCode = null;
    const terminal = observeChildExit(child);
    child.emit('exit', 7, null);
    await expect(terminal).resolves.toEqual({ exitCode: 7, signal: null });
  });

  it('accepts only one proven primary terminal outcome', () => {
    expect(inspectChildTerminalOutcome({ exitCode: 0, signal: null })).toEqual({
      exitCode: 0,
      signal: null,
    });
    expect(
      inspectChildTerminalOutcome({ exitCode: null, signal: 'SIGKILL' }),
    ).toEqual({ exitCode: null, signal: 'SIGKILL' });
    for (const invalid of [
      { exitCode: null, signal: null },
      { exitCode: 0, signal: 'SIGTERM' },
      { exitCode: null, signal: null, timeout: true },
      {
        error: new Error('private child error'),
        exitCode: null,
        signal: null,
      },
    ]) {
      expect(() => inspectChildTerminalOutcome(invalid)).toThrow(
        /terminal outcome/i,
      );
    }
  });

  it('waits for child stdio close before finalizing primary output evidence', async () => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    };
    child.exitCode = null;
    child.signalCode = null;
    const closed = observeChildClose(child);
    child.emit('exit', null, 'SIGKILL');
    let settled = false;
    void closed.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit('close', null, 'SIGKILL');
    await expect(closed).resolves.toEqual({
      exitCode: null,
      signal: 'SIGKILL',
    });
  });

  it('captures primary output only after close and includes stderr appended after exit', async () => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    };
    child.exitCode = null;
    child.signalCode = null;
    const output = createBoundedProcessOutput();
    output.append('primary started\n');
    const evidencePromise = captureStrictPrimaryProcessEvidence({
      identity: {
        executablePath: 'C:\\Program Files\\LumaMark\\lumamark.exe',
        processId: 42,
        startTimeUtc: '2026-08-15T00:00:00.000Z',
      },
      output,
      proveIdentityExited: async () => true,
      terminal: observeChildClose(child),
    });
    let settled = false;
    void evidencePromise.finally(() => {
      settled = true;
    });

    child.emit('exit', null, 'SIGKILL');
    output.append('desktop.window_focus_failed\n');
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit('close', null, 'SIGKILL');

    await expect(evidencePromise).resolves.toEqual({
      identity: expect.objectContaining({ processId: 42 }),
      identityExited: true,
      output: expect.objectContaining({
        diagnosticCodes: ['desktop.window_focus_failed'],
      }),
      outputComplete: true,
      terminal: { exitCode: null, signal: 'SIGKILL' },
    });
  });

  it('never summarizes primary output unless terminal and identity exit are proven', async () => {
    const summarized: string[] = [];
    const output = {
      summary() {
        summarized.push('summary');
        return { diagnosticCodes: [] };
      },
    };
    const identity = {
      executablePath: 'C:\\Program Files\\LumaMark\\lumamark.exe',
      processId: 42,
      startTimeUtc: '2026-08-15T00:00:00.000Z',
    };

    for (const terminal of [
      { exitCode: null, signal: null },
      { exitCode: null, signal: null, timeout: true },
      { error: new Error('private failure'), exitCode: null, signal: null },
    ]) {
      await expect(
        captureStrictPrimaryProcessEvidence({
          identity,
          output,
          proveIdentityExited: async () => true,
          terminal: Promise.resolve(terminal),
        }),
      ).rejects.toThrow(/terminal outcome/i);
    }
    await expect(
      captureStrictPrimaryProcessEvidence({
        identity,
        output,
        proveIdentityExited: async () => false,
        terminal: Promise.resolve({ exitCode: 0, signal: null }),
      }),
    ).rejects.toThrow(/identity exit/i);
    expect(summarized).toEqual([]);
  });

  it('never summarizes an identity-less failed primary settlement', async () => {
    const summaries: string[] = [];
    const directTerminationReports: boolean[] = [];
    const output = {
      summary() {
        summaries.push('summary');
        return { diagnosticCodes: [] };
      },
    };

    for (const directTerminationReported of [true, false]) {
      const evidence = await settleFailedPrimaryProcessEvidence({
        identity: null,
        output,
        primaryStarted: true,
        terminateIdentifiedPrimary: async () => {
          throw new Error('identified termination must not run');
        },
        terminateUnidentifiedPrimary: async () => {
          directTerminationReports.push(directTerminationReported);
          if (!directTerminationReported) {
            throw new Error('private direct termination failure');
          }
        },
      });
      expect(evidence).toEqual({
        identity: null,
        identityExited: false,
        outputComplete: false,
        terminationFailure: {
          code: 'primary_identity_unavailable',
          directTerminationReported,
        },
      });
    }
    expect(directTerminationReports).toEqual([true, false]);
    expect(summaries).toEqual([]);
  });

  it('proves a directly spawned child exited after termination and rejects an unproven kill', async () => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      kill: (signal: NodeJS.Signals) => boolean;
      pid: number;
      signalCode: NodeJS.Signals | null;
    };
    child.exitCode = null;
    child.pid = 42;
    child.signalCode = null;
    child.kill = () => {
      child.signalCode = 'SIGKILL';
      child.emit('exit', null, 'SIGKILL');
      return true;
    };
    await expect(terminateDirectChild(child, 25)).resolves.toEqual({
      exitCode: null,
      signal: 'SIGKILL',
    });

    const stuck = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      kill: () => boolean;
      pid: number;
      signalCode: NodeJS.Signals | null;
    };
    stuck.exitCode = null;
    stuck.pid = 43;
    stuck.signalCode = null;
    stuck.kill = () => false;
    await expect(terminateDirectChild(stuck, 5)).rejects.toThrow(/exit|terminate/i);
  });

  it('bounds process diagnostics without preserving private output', () => {
    const output = createBoundedProcessOutput(12);
    output.append('C:\\Users\\secret\\draft.md');
    output.append(' desktop.open_request_state_startup_timeout');
    const summary = output.summary();
    expect(summary).toEqual({
      diagnosticCodes: ['desktop.open_request_state_startup_timeout'],
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      byteCount: Buffer.byteLength(
        'C:\\Users\\secret\\draft.md desktop.open_request_state_startup_timeout',
        'utf8',
      ),
      hadOutput: true,
      truncated: true,
    });
    expect(JSON.stringify(summary)).not.toContain('secret');
    expect(summary).toEqual(expect.objectContaining({
      hadOutput: true,
      truncated: true,
    }));
  });

  it('fails closed on primary routing diagnostics even after later success', () => {
    expect(() =>
      assertPrimaryRoutingDiagnostics(
        { diagnosticCodes: [] },
        PRIMARY_ROUTING_DIAGNOSTIC_ALLOWLIST,
      ),
    ).not.toThrow();
    expect(() =>
      assertPrimaryRoutingDiagnostics(
        { diagnosticCodes: ['file.watch_refresh_complete'] },
        PRIMARY_ROUTING_DIAGNOSTIC_ALLOWLIST,
      ),
    ).not.toThrow();

    for (const diagnosticCode of [
      'desktop.window_create_failed',
      'desktop.open_request_state_startup_timeout',
      'desktop.open_request_target_ambiguous',
      'desktop.routing_acceptance_mode_invalid',
    ]) {
      expect(() =>
        assertPrimaryRoutingDiagnostics(
          { diagnosticCodes: [diagnosticCode] },
          PRIMARY_ROUTING_DIAGNOSTIC_ALLOWLIST,
        ),
      ).toThrow(diagnosticCode);
    }

    const output = createBoundedProcessOutput();
    output.append('first worker: desktop.window_create_failed\n');
    output.append('later worker: routing completed successfully\n');
    expect(() =>
      assertPrimaryRoutingDiagnostics(
        output.summary(),
        PRIMARY_ROUTING_DIAGNOSTIC_ALLOWLIST,
      ),
    ).toThrow('desktop.window_create_failed');

    const noisyOutput = createBoundedProcessOutput();
    for (let index = 0; index < 32; index += 1) {
      noisyOutput.append(`file.noise_${index}\n`);
    }
    noisyOutput.append('desktop.window_focus_failed\n');
    expect(() =>
      assertPrimaryRoutingDiagnostics(
        noisyOutput.summary(),
        PRIMARY_ROUTING_DIAGNOSTIC_ALLOWLIST,
      ),
    ).toThrow('desktop.window_focus_failed');
  });

  it('keeps the executable release entry and documents that this is a thin gate', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const releaseGuide = await readFile(
      join(process.cwd(), 'docs', 'release', 'WINDOWS_V1_BUILD.md'),
      'utf8',
    );
    const gitignore = await readFile(join(process.cwd(), '.gitignore'), 'utf8');
    const verifier = await readFile(
      join(
        process.cwd(),
        'scripts',
        'release',
        'verify-installed-second-instance-open.mjs',
      ),
      'utf8',
    );

    expect(packageJson.scripts['release:installed-window-routing']).toBe(
      'node scripts/release/verify-installed-second-instance-open.mjs',
    );
    expect(releaseGuide).toContain('release:installed-window-routing');
    expect(releaseGuide).toContain('LUMAMARK_ROUTING_ACCEPTANCE_MODE');
    expect(releaseGuide).toContain('completion fence/high-water');
    expect(releaseGuide).toContain('localhost administrative share');
    expect(releaseGuide).toContain('联合矩阵');
    expect(gitignore).toContain(
      'artifacts/installed-window-routing/**/result.json',
    );
    expect(verifier).toContain('assertExactWindowMarkerMap');
    expect(verifier).not.toContain('DURABLE_SAMPLE_INTERVAL');
    expect(verifier).toContain('readExactRoutingWindowSnapshots');
    expect(verifier).not.toContain('readRoutingWindow(page).catch');
    expect(verifier).toContain('windowObservation: error?.windowObservation');
    expect(verifier).toContain('observeChildClose(primary)');
    expect(verifier).toContain('captureStrictPrimaryProcessEvidence');
    expect(verifier).toContain('await settleFailedPrimaryProcessEvidence({');
    expect(verifier).not.toContain('async function settleFailedPrimaryProcess(');
    const primarySpawn = verifier.indexOf(
      'primary = spawn(executablePath, [firstDocumentPath]',
    );
    const primaryIdentityCapture = verifier.indexOf(
      'primaryIdentity = assertOwnedProcessIdentity(processInfo',
      primarySpawn,
    );
    const webviewWait = verifier.indexOf(
      'await waitForDebug(debugPort, primary)',
      primarySpawn,
    );
    expect(primarySpawn).toBeGreaterThan(0);
    expect(primaryIdentityCapture).toBeGreaterThan(primarySpawn);
    expect(webviewWait).toBeGreaterThan(primaryIdentityCapture);
    expect(verifier).not.toContain('primaryOutput: primaryOutput.summary()');
    expect(verifier).not.toContain('} finally {\n    if (browser)');
    expect(verifier).toContain("code: 'routing_temp_cleanup_failed'");
    expect(verifier).toContain('primary: scenarioEvidence.primary');
    expect(verifier).toContain(
      'scenarioEvidence.primary.identityExited === true',
    );
  });
});
