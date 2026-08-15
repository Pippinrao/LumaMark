import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

export const PRIMARY_ROUTING_DIAGNOSTIC_ALLOWLIST = Object.freeze([]);

const PRIMARY_ROUTING_FAILURE_PREFIXES = Object.freeze([
  'desktop.open_request_',
  'desktop.routing_',
  'desktop.window_',
]);

function isPrimaryRoutingFailureCode(code) {
  const normalizedCode = String(code).toLowerCase();
  return PRIMARY_ROUTING_FAILURE_PREFIXES.some((prefix) =>
    normalizedCode.startsWith(prefix),
  );
}

const ROUTING_ENVIRONMENT_KEYS = Object.freeze([
  'LUMAMARK_ACCEPTANCE_MODE',
  'LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR',
  'LUMAMARK_ROUTING_ACCEPTANCE_MODE',
]);
const FORBIDDEN_ROUTING_ENVIRONMENT_KEYS = Object.freeze([
  'LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR',
]);
const CONTROLLED_ROUTING_ENVIRONMENT_KEYS = new Set(
  [...ROUTING_ENVIRONMENT_KEYS, ...FORBIDDEN_ROUTING_ENVIRONMENT_KEYS].map(
    (key) => key.toLowerCase(),
  ),
);
const ACTIVE_LIFECYCLE_KINDS = new Set([
  'appliedPendingAcknowledgement',
  'processing',
  'queued',
]);
const MAX_RECENT_COMPLETION_FENCES = 128;

function normalizedWindowsPath(value) {
  return String(value)
    .replaceAll('\\', '/')
    .replace(/\/$/, '')
    .toLocaleLowerCase('en-US');
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} does not match the strict durable schema.`);
  }
}

function assertNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is not a non-negative safe integer.`);
  }
}

function assertCanonicalCounter(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} is not a canonical decimal token.`);
  }
}

function registerAttemptToken(value, nextAttemptSequence, seen, label) {
  assertCanonicalCounter(value, label);
  const sequence = Number(value);
  if (
    !Number.isSafeInteger(sequence) ||
    sequence >= nextAttemptSequence ||
    seen.has(value)
  ) {
    throw new Error(`${label} is outside the attempt high-water or duplicated.`);
  }
  seen.add(value);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is empty.`);
  }
}

function inspectTargetedPayload(payload, label) {
  assertExactKeys(payload, ['path', 'targetWindow'], label);
  assertNonEmptyString(payload.path, `${label} path`);
  assertNonEmptyString(payload.targetWindow, `${label} target window`);
  return payload;
}

function countLiteralOccurrences(content, marker) {
  let count = 0;
  let offset = 0;
  while ((offset = content.indexOf(marker, offset)) >= 0) {
    count += 1;
    offset += marker.length;
  }
  return count;
}

function matchingEnvironmentEntries(environment, canonicalKey) {
  if (!environment || typeof environment !== 'object') return [];
  const normalizedKey = canonicalKey.toLowerCase();
  return Object.entries(environment).filter(
    ([key]) => key.toLowerCase() === normalizedKey,
  );
}

export function assertExactWindowMarkerMap(
  windows,
  expectedByLabel,
  knownMarkers = Object.values(expectedByLabel ?? {}),
) {
  if (
    !Array.isArray(windows) ||
    !expectedByLabel ||
    typeof expectedByLabel !== 'object' ||
    Array.isArray(expectedByLabel) ||
    !Array.isArray(knownMarkers)
  ) {
    throw new Error('The exact window-marker contract is invalid.');
  }
  const expectedEntries = Object.entries(expectedByLabel);
  if (expectedEntries.length === 0 || windows.length !== expectedEntries.length) {
    throw new Error('The managed-window label set does not match the marker contract.');
  }
  const markerSet = new Set(knownMarkers);
  if (
    markerSet.size !== knownMarkers.length ||
    knownMarkers.some(
      (marker) =>
        typeof marker !== 'string' ||
        marker.length === 0 ||
        knownMarkers.some(
          (other) => other !== marker && other.includes(marker),
        ),
    ) ||
    expectedEntries.some(
      ([label, marker]) =>
        typeof label !== 'string' ||
        label.length === 0 ||
        !markerSet.has(marker),
    )
  ) {
    throw new Error('The exact window-marker values are ambiguous or incomplete.');
  }

  const actualByLabel = new Map();
  for (const window of windows) {
    if (
      typeof window?.label !== 'string' ||
      typeof window?.content !== 'string' ||
      actualByLabel.has(window.label)
    ) {
      throw new Error('The observed managed-window labels are invalid or duplicated.');
    }
    actualByLabel.set(window.label, window.content);
  }
  const actualLabels = [...actualByLabel.keys()].sort();
  const expectedLabels = expectedEntries.map(([label]) => label).sort();
  if (JSON.stringify(actualLabels) !== JSON.stringify(expectedLabels)) {
    throw new Error('The observed managed-window labels do not match the marker contract.');
  }

  for (const [label, expectedMarker] of expectedEntries) {
    const content = actualByLabel.get(label);
    const observedMarkers = knownMarkers
      .map((marker) => ({
        marker,
        occurrences: countLiteralOccurrences(content, marker),
      }))
      .filter(({ occurrences }) => occurrences > 0);
    if (
      observedMarkers.length !== 1 ||
      observedMarkers[0].marker !== expectedMarker ||
      observedMarkers[0].occurrences !== 1
    ) {
      throw new Error('A document marker was missing, duplicated, or routed to the wrong window.');
    }
  }
  return true;
}

export async function readExactRoutingWindowSnapshots(
  pages,
  expectedCount,
  snapshotPage,
) {
  if (
    !Array.isArray(pages) ||
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 0 ||
    typeof snapshotPage !== 'function'
  ) {
    throw new Error('The exact routing-window observation contract is invalid.');
  }
  const settled = await Promise.allSettled(pages.map(snapshotPage));
  const snapshots = [];
  let unreadableCount = 0;
  for (const result of settled) {
    if (
      result.status !== 'fulfilled' ||
      !result.value ||
      typeof result.value !== 'object' ||
      result.value.appShellReady !== true ||
      typeof result.value.label !== 'string' ||
      result.value.label.length === 0
    ) {
      unreadableCount += 1;
    } else {
      snapshots.push(result.value);
    }
  }
  if (pages.length !== expectedCount || unreadableCount > 0) {
    const windowObservation = Object.freeze({
      expectedCount,
      pageCount: pages.length,
      unreadableCount,
    });
    throw Object.assign(
      new Error(
        `Routing-window observation failed (expected=${expectedCount}, pages=${pages.length}, unreadable=${unreadableCount}).`,
      ),
      { windowObservation },
    );
  }
  return snapshots;
}

export function createRoutingEnvironment(baseEnvironment, configDirectory) {
  if (
    !baseEnvironment ||
    typeof baseEnvironment !== 'object' ||
    typeof configDirectory !== 'string' ||
    configDirectory.trim().length === 0 ||
    !isAbsolute(configDirectory)
  ) {
    throw new Error('The isolated routing environment is invalid.');
  }
  const sanitizedEnvironment = Object.fromEntries(
    Object.entries(baseEnvironment).filter(
      ([key]) => !CONTROLLED_ROUTING_ENVIRONMENT_KEYS.has(key.toLowerCase()),
    ),
  );
  return Object.freeze({
    ...sanitizedEnvironment,
    LUMAMARK_ACCEPTANCE_MODE: '1',
    LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR: resolve(configDirectory),
    LUMAMARK_ROUTING_ACCEPTANCE_MODE: '1',
  });
}

export function assertSameRoutingEnvironment(expected, actual) {
  for (const key of FORBIDDEN_ROUTING_ENVIRONMENT_KEYS) {
    if (
      matchingEnvironmentEntries(expected, key).length > 0 ||
      matchingEnvironmentEntries(actual, key).length > 0
    ) {
      throw new Error('A child launch changed the isolated routing environment.');
    }
  }
  for (const key of ROUTING_ENVIRONMENT_KEYS) {
    const expectedEntries = matchingEnvironmentEntries(expected, key);
    const actualEntries = matchingEnvironmentEntries(actual, key);
    if (
      expectedEntries.length !== 1 ||
      actualEntries.length !== 1 ||
      expectedEntries[0][0] !== key ||
      actualEntries[0][0] !== key ||
      typeof expectedEntries[0][1] !== 'string' ||
      expectedEntries[0][1].length === 0 ||
      actualEntries[0][1] !== expectedEntries[0][1]
    ) {
      throw new Error('A child launch changed the isolated routing environment.');
    }
  }
  return true;
}

export function createBoundedProcessOutput(maximumBytes = 64 * 1024) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error('The process output byte limit is invalid.');
  }
  let byteCount = 0;
  let diagnosticTail = '';
  const diagnosticCodes = new Set();
  const hash = createHash('sha256');
  return Object.freeze({
    append(chunk) {
      const text = String(chunk);
      byteCount += Buffer.byteLength(text, 'utf8');
      hash.update(text, 'utf8');
      const diagnosticText = `${diagnosticTail}${text}`;
      for (const match of diagnosticText.matchAll(
        /\b(?:desktop|document|file|settings)\.[a-z0-9_.-]+\b/gi,
      )) {
        const diagnosticCode = match[0];
        if (diagnosticCodes.has(diagnosticCode)) continue;
        if (diagnosticCodes.size < 32) {
          diagnosticCodes.add(diagnosticCode);
        } else if (isPrimaryRoutingFailureCode(diagnosticCode)) {
          const replaceable = [...diagnosticCodes].find(
            (code) => !isPrimaryRoutingFailureCode(code),
          );
          if (replaceable) {
            diagnosticCodes.delete(replaceable);
            diagnosticCodes.add(diagnosticCode);
          }
        }
      }
      diagnosticTail = diagnosticText.slice(-128);
    },
    summary() {
      return Object.freeze({
        byteCount,
        diagnosticCodes: [...diagnosticCodes].sort(),
        hadOutput: byteCount > 0,
        sha256: hash.copy().digest('hex'),
        truncated: byteCount > maximumBytes,
      });
    },
  });
}

export function assertPrimaryRoutingDiagnostics(
  summary,
  allowlist = PRIMARY_ROUTING_DIAGNOSTIC_ALLOWLIST,
) {
  if (
    !Array.isArray(summary?.diagnosticCodes) ||
    !Array.isArray(allowlist) ||
    summary.diagnosticCodes.some((code) => typeof code !== 'string') ||
    allowlist.some((code) => typeof code !== 'string')
  ) {
    throw new Error('The primary routing diagnostic summary is invalid.');
  }
  const allowed = new Set(allowlist.map((code) => code.toLowerCase()));
  for (const diagnosticCode of summary.diagnosticCodes) {
    const normalizedCode = diagnosticCode.toLowerCase();
    if (
      isPrimaryRoutingFailureCode(normalizedCode) &&
      !allowed.has(normalizedCode)
    ) {
      throw new Error(
        `The primary routing process reported ${diagnosticCode}.`,
      );
    }
  }
  return true;
}

export function observeChildExit(child) {
  if (!child || typeof child.once !== 'function') {
    return Promise.reject(new Error('The child process observer is invalid.'));
  }
  if (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
  ) {
    return Promise.resolve({
      exitCode: child.exitCode ?? null,
      signal: child.signalCode ?? null,
    });
  }
  return new Promise((resolveExit) => {
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      resolveExit(outcome);
    };
    child.once('error', (error) =>
      settle({ error, exitCode: null, signal: null }),
    );
    child.once('exit', (exitCode, signal) =>
      settle({ exitCode, signal: signal ?? null }),
    );
  });
}

export function observeChildClose(child) {
  if (!child || typeof child.once !== 'function') {
    return Promise.reject(new Error('The child process close observer is invalid.'));
  }
  return new Promise((resolveClose) => {
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      resolveClose(outcome);
    };
    child.once('error', (error) =>
      settle({ error, exitCode: null, signal: null }),
    );
    child.once('close', (exitCode, signal) =>
      settle({ exitCode, signal: signal ?? null }),
    );
  });
}

export function inspectChildTerminalOutcome(outcome) {
  const hasExitCode =
    Number.isSafeInteger(outcome?.exitCode) && outcome.exitCode >= 0;
  const hasSignal =
    typeof outcome?.signal === 'string' && outcome.signal.length > 0;
  if (outcome?.timeout || outcome?.error || hasExitCode === hasSignal) {
    throw new Error('The child terminal outcome is not strictly proven.');
  }
  return Object.freeze({
    exitCode: hasExitCode ? outcome.exitCode : null,
    signal: hasSignal ? outcome.signal : null,
  });
}

export async function captureStrictPrimaryProcessEvidence({
  identity,
  output,
  proveIdentityExited,
  terminal,
}) {
  if (
    !identity ||
    !output ||
    typeof output.summary !== 'function' ||
    typeof proveIdentityExited !== 'function' ||
    !terminal ||
    typeof terminal.then !== 'function'
  ) {
    throw new Error('The primary process evidence contract is invalid.');
  }
  const terminalOutcome = inspectChildTerminalOutcome(await terminal);
  if ((await proveIdentityExited(identity)) !== true) {
    throw new Error('The primary process identity exit is not proven.');
  }
  return Object.freeze({
    identity,
    identityExited: true,
    output: output.summary(),
    outputComplete: true,
    terminal: terminalOutcome,
  });
}

export async function settleFailedPrimaryProcessEvidence({
  identity,
  output,
  primaryStarted,
  terminateIdentifiedPrimary,
  terminateUnidentifiedPrimary,
}) {
  if (primaryStarted !== true) {
    if (!output || typeof output.summary !== 'function') {
      throw new Error('The primary process output contract is invalid.');
    }
    return Object.freeze({
      identity: null,
      identityExited: null,
      output: output.summary(),
      outputComplete: true,
      started: false,
      terminal: null,
    });
  }

  if (!identity) {
    let directTerminationReported = false;
    if (typeof terminateUnidentifiedPrimary === 'function') {
      try {
        await terminateUnidentifiedPrimary();
        directTerminationReported = true;
      } catch {
        directTerminationReported = false;
      }
    }
    return Object.freeze({
      identity: null,
      identityExited: false,
      outputComplete: false,
      terminationFailure: Object.freeze({
        code: 'primary_identity_unavailable',
        directTerminationReported,
      }),
    });
  }

  if (typeof terminateIdentifiedPrimary === 'function') {
    try {
      return await terminateIdentifiedPrimary();
    } catch {
      // The stable evidence below records that strict termination was unproven.
    }
  }
  return Object.freeze({
    identity,
    identityExited: false,
    outputComplete: false,
    terminationFailure: Object.freeze({
      code: 'primary_termination_unproven',
    }),
  });
}

export async function terminateDirectChild(child, timeoutMs = 8_000) {
  if (
    !child ||
    !Number.isInteger(child.pid) ||
    typeof child.kill !== 'function' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new Error('The direct child termination contract is invalid.');
  }
  if (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
  ) {
    return inspectChildTerminalOutcome(await observeChildExit(child));
  }

  const terminal = observeChildExit(child);
  child.kill('SIGKILL');
  let timeoutHandle;
  const timeout = new Promise((resolveTimeout) => {
    timeoutHandle = setTimeout(
      () => resolveTimeout({ timeout: true }),
      timeoutMs,
    );
  });
  const outcome = await Promise.race([terminal, timeout]);
  clearTimeout(timeoutHandle);
  try {
    return inspectChildTerminalOutcome(outcome);
  } catch (error) {
    throw new Error('The direct child exit could not be proven after termination.', {
      cause: error,
    });
  }
}

export function assertOwnedProcessIdentity(actual, expected) {
  if (
    actual?.exists === false ||
    !Number.isInteger(actual?.processId) ||
    actual.processId !== expected?.processId ||
    typeof actual?.executablePath !== 'string' ||
    typeof expected?.executablePath !== 'string' ||
    normalizedWindowsPath(actual.executablePath) !==
      normalizedWindowsPath(expected.executablePath) ||
    typeof actual?.startTimeUtc !== 'string' ||
    actual.startTimeUtc.length === 0 ||
    actual.startTimeUtc !== expected?.startTimeUtc
  ) {
    throw new Error('The acceptance process identity changed.');
  }
  return Object.freeze({
    executablePath: actual.executablePath,
    processId: actual.processId,
    startTimeUtc: actual.startTimeUtc,
  });
}

export function assertOwnedRoutingCleanupContract({
  canonicalConfig,
  canonicalSystemTemp,
  canonicalTemp,
  marker,
  ownershipToken,
}) {
  const normalizedSystemTemp = normalizedWindowsPath(canonicalSystemTemp);
  const normalizedTemp = normalizedWindowsPath(canonicalTemp);
  const normalizedConfig = normalizedWindowsPath(canonicalConfig);
  if (
    normalizedWindowsPath(dirname(canonicalTemp)) !== normalizedSystemTemp ||
    !basename(canonicalTemp).startsWith(
      'lumamark-menu-context-os-routing-',
    ) ||
    normalizedWindowsPath(dirname(canonicalConfig)) !== normalizedTemp ||
    basename(canonicalConfig).toLocaleLowerCase('en-US') !==
      'settings-config' ||
    typeof ownershipToken !== 'string' ||
    ownershipToken.length === 0 ||
    marker?.ownershipToken !== ownershipToken ||
    normalizedWindowsPath(resolve(marker?.tempDirectory ?? '')) !==
      normalizedTemp ||
    normalizedWindowsPath(resolve(marker?.configDirectory ?? '')) !==
      normalizedConfig
  ) {
    throw new Error('The routing acceptance ownership marker is invalid.');
  }
  return true;
}

export function inspectDurableSnapshot(document) {
  assertExactKeys(
    document,
    ['lifecycle', 'nextRequestId', 'retainedRequests', 'version'],
    'Open-request document',
  );
  if (document.version !== 2) {
    throw new Error('The open-request durable schema version is unsupported.');
  }
  assertNonNegativeSafeInteger(document.nextRequestId, 'nextRequestId');
  assertExactKeys(
    document.lifecycle,
    [
      'acknowledgedRanges',
      'nextAttemptSequence',
      'nextSequence',
      'recentCompletionFences',
      'records',
    ],
    'Open-request lifecycle',
  );
  assertNonNegativeSafeInteger(
    document.lifecycle.nextAttemptSequence,
    'nextAttemptSequence',
  );
  assertNonNegativeSafeInteger(document.lifecycle.nextSequence, 'nextSequence');
  if (document.nextRequestId !== document.lifecycle.nextSequence) {
    throw new Error('The open-request durable high-water counters diverged.');
  }
  if (
    !Array.isArray(document.lifecycle.acknowledgedRanges) ||
    !Array.isArray(document.lifecycle.recentCompletionFences) ||
    !Array.isArray(document.lifecycle.records) ||
    !Array.isArray(document.retainedRequests)
  ) {
    throw new Error('The open-request durable collections are invalid.');
  }

  let previousRangeEnd = -1;
  const acknowledgedRanges = document.lifecycle.acknowledgedRanges.map(
    (range, index) => {
      assertExactKeys(
        range,
        ['endSequenceExclusive', 'startSequence'],
        `Acknowledged range ${index}`,
      );
      assertNonNegativeSafeInteger(
        range.startSequence,
        `Acknowledged range ${index} start`,
      );
      assertNonNegativeSafeInteger(
        range.endSequenceExclusive,
        `Acknowledged range ${index} end`,
      );
      if (
        range.startSequence >= range.endSequenceExclusive ||
        range.endSequenceExclusive > document.lifecycle.nextSequence ||
        range.startSequence <= previousRangeEnd
      ) {
        throw new Error(
          `Acknowledged range ${index} is empty, unordered, overlapping, or not merged.`,
        );
      }
      previousRangeEnd = range.endSequenceExclusive;
      return range;
    },
  );

  const seenAttemptTokens = new Set();
  let previousRecordSequence = -1;
  const records = document.lifecycle.records.map((record, index) => {
    const kind = record.state?.kind;
    assertExactKeys(
      record,
      kind === 'appliedPendingAcknowledgement'
        ? ['requestId', 'sequence', 'state']
        : ['payload', 'requestId', 'sequence', 'state'],
      `Open-request record ${index}`,
    );
    assertCanonicalCounter(record.requestId, `requestId ${index}`);
    assertNonNegativeSafeInteger(record.sequence, `sequence ${index}`);
    if (
      record.requestId !== String(record.sequence) ||
      record.sequence >= document.lifecycle.nextSequence ||
      record.sequence <= previousRecordSequence
    ) {
      throw new Error(`Open-request active record ${index} has an invalid sequence identity.`);
    }
    previousRecordSequence = record.sequence;
    if (!ACTIVE_LIFECYCLE_KINDS.has(kind)) {
      throw new Error(
        `Open-request active record ${index} retained a completed or invalid state.`,
      );
    }
    const expectedStateKeys =
      kind === 'queued'
        ? ['kind']
        : kind === 'processing'
          ? ['attemptToken', 'kind', 'leaseExpiresAt', 'owner']
          : ['attemptToken', 'kind', 'owner'];
    assertExactKeys(record.state, expectedStateKeys, `Open-request state ${index}`);
    if (kind !== 'queued') {
      registerAttemptToken(
        record.state.attemptToken,
        document.lifecycle.nextAttemptSequence,
        seenAttemptTokens,
        `attemptToken ${index}`,
      );
      if (typeof record.state.owner !== 'string' || record.state.owner.length === 0) {
        throw new Error(`Open-request state ${index} has no owner.`);
      }
    }
    if (kind === 'processing') {
      assertNonNegativeSafeInteger(record.state.leaseExpiresAt, `lease ${index}`);
    }
    if (kind !== 'appliedPendingAcknowledgement') {
      inspectTargetedPayload(record.payload, `Open-request payload ${index}`);
    }
    return record;
  });

  if (document.lifecycle.recentCompletionFences.length > MAX_RECENT_COMPLETION_FENCES) {
    throw new Error('The recent completion fence collection is not bounded.');
  }
  const seenFenceIds = new Set();
  const seenFenceSequences = new Set();
  const completionFences = document.lifecycle.recentCompletionFences.map(
    (fence, index) => {
      assertExactKeys(
        fence,
        ['attemptToken', 'owner', 'requestId', 'sequence'],
        `Completion fence ${index}`,
      );
      assertCanonicalCounter(fence.requestId, `Completion fence ${index} requestId`);
      registerAttemptToken(
        fence.attemptToken,
        document.lifecycle.nextAttemptSequence,
        seenAttemptTokens,
        `Completion fence ${index} attemptToken`,
      );
      assertNonNegativeSafeInteger(fence.sequence, `Completion fence ${index} sequence`);
      assertNonEmptyString(fence.owner, `Completion fence ${index} owner`);
      const acknowledged = acknowledgedRanges.some(
        (range) =>
          range.startSequence <= fence.sequence &&
          fence.sequence < range.endSequenceExclusive,
      );
      if (
        fence.requestId !== String(fence.sequence) ||
        !acknowledged ||
        seenFenceIds.has(fence.requestId) ||
        seenFenceSequences.has(fence.sequence)
      ) {
        throw new Error(`Completion fence ${index} has an invalid request identity.`);
      }
      seenFenceIds.add(fence.requestId);
      seenFenceSequences.add(fence.sequence);
      return fence;
    },
  );

  const retained = document.retainedRequests.map((entry, index) => {
    assertExactKeys(
      entry,
      ['identity', 'payload', 'requestId'],
      `Retained open request ${index}`,
    );
    assertCanonicalCounter(entry.requestId, `retained requestId ${index}`);
    assertExactKeys(
      entry.identity,
      ['lexicalAlias', 'resolved'],
      `Retained identity ${index}`,
    );
    assertNonEmptyString(entry.identity.lexicalAlias, `Retained identity ${index} alias`);
    assertNonEmptyString(entry.identity.resolved, `Retained identity ${index} resolved path`);
    inspectTargetedPayload(entry.payload, `Retained payload ${index}`);
    return entry;
  });

  const coverage = [
    ...acknowledgedRanges.map((range) => ({
      end: range.endSequenceExclusive,
      start: range.startSequence,
    })),
    ...records.map((record) => ({
      end: record.sequence + 1,
      start: record.sequence,
    })),
  ].sort((left, right) => left.start - right.start);
  let coveredUntil = 0;
  for (const span of coverage) {
    if (span.start !== coveredUntil) {
      throw new Error('The durable lifecycle does not exactly cover its sequence high-water.');
    }
    coveredUntil = span.end;
  }
  if (coveredUntil !== document.lifecycle.nextSequence) {
    throw new Error('The durable lifecycle does not exactly cover its sequence high-water.');
  }

  const retainedById = new Map();
  for (const entry of retained) {
    if (retainedById.has(entry.requestId)) {
      throw new Error('The retained open-request identities are duplicated.');
    }
    retainedById.set(entry.requestId, entry);
  }
  if (retainedById.size !== records.length) {
    throw new Error('Active records and retained open requests are not one-to-one.');
  }
  for (const record of records) {
    const retainedEntry = retainedById.get(record.requestId);
    if (!retainedEntry) {
      throw new Error('An active record has no retained open-request identity.');
    }
    if (
      Object.hasOwn(record, 'payload') &&
      JSON.stringify(record.payload) !== JSON.stringify(retainedEntry.payload)
    ) {
      throw new Error('An active record payload diverged from its retained request.');
    }
    if (
      record.state.owner !== undefined &&
      record.state.owner !== retainedEntry.payload.targetWindow
    ) {
      throw new Error('An active record owner diverged from its retained target window.');
    }
  }
  return Object.freeze({
    acknowledgedRanges,
    completionFences,
    nextAttemptSequence: document.lifecycle.nextAttemptSequence,
    nextRequestId: document.nextRequestId,
    nextSequence: document.lifecycle.nextSequence,
    records,
    retained,
  });
}

export function assertExactlyOnceDurableTrace({
  baseline,
  finalSnapshot,
  observations,
  stableObservationCount,
  targetWindow,
}) {
  if (
    !Array.isArray(observations) ||
    !Number.isSafeInteger(stableObservationCount) ||
    stableObservationCount < 1 ||
    observations.length < stableObservationCount
  ) {
    throw new Error('The durable telemetry stability contract is invalid.');
  }
  const inspectedBaseline = inspectDurableSnapshot(baseline);
  const inspectedObservations = observations.map(inspectDurableSnapshot);
  const inspectedFinal = inspectDurableSnapshot(finalSnapshot);
  let previousRequests = inspectedBaseline.nextRequestId;
  let previousSequences = inspectedBaseline.nextSequence;
  let previousAttempts = inspectedBaseline.nextAttemptSequence;
  for (const observation of inspectedObservations) {
    if (
      observation.nextRequestId < previousRequests ||
      observation.nextSequence < previousSequences ||
      observation.nextAttemptSequence < previousAttempts
    ) {
      throw new Error('The durable telemetry contained a stale revision.');
    }
    previousRequests = observation.nextRequestId;
    previousSequences = observation.nextSequence;
    previousAttempts = observation.nextAttemptSequence;
  }

  const finalJson = JSON.stringify(finalSnapshot);
  if (
    observations
      .slice(-stableObservationCount)
      .some((observation) => JSON.stringify(observation) !== finalJson)
  ) {
    throw new Error('The durable telemetry did not reach a stable final revision.');
  }

  if (
    inspectedFinal.nextRequestId !== inspectedBaseline.nextRequestId + 1 ||
    inspectedFinal.nextSequence !== inspectedBaseline.nextSequence + 1
  ) {
    throw new Error('The launch did not create exactly one durable request.');
  }
  const requestId = String(inspectedBaseline.nextRequestId);
  const completion = inspectedFinal.completionFences.find(
    (fence) => fence.requestId === requestId,
  );
  if (
    !completion ||
    completion.owner !== targetWindow ||
    inspectedFinal.retained.length !== 0 ||
    inspectedFinal.records.length !== 0
  ) {
    throw new Error('The durable request did not reach one fully acknowledged completed state.');
  }
  const observedLifecycleStates = [];
  const seenLifecycleStates = new Set();
  for (const observation of inspectedObservations) {
    const record = observation.records.find(
      (candidate) => candidate.requestId === requestId,
    );
    if (record && !seenLifecycleStates.has(record.state.kind)) {
      seenLifecycleStates.add(record.state.kind);
      observedLifecycleStates.push(record.state.kind);
    }
  }
  if (
    completion.attemptToken !== String(inspectedBaseline.nextAttemptSequence) ||
    inspectedFinal.nextAttemptSequence !==
      inspectedBaseline.nextAttemptSequence + 1
  ) {
    throw new Error('The durable request was applied by more than one attempt.');
  }
  return Object.freeze({
    attemptToken: completion.attemptToken,
    baselineHighWater: Object.freeze({
      attempts: inspectedBaseline.nextAttemptSequence,
      requests: inspectedBaseline.nextRequestId,
      sequences: inspectedBaseline.nextSequence,
    }),
    completionFenceObserved: true,
    finalHighWater: Object.freeze({
      attempts: inspectedFinal.nextAttemptSequence,
      requests: inspectedFinal.nextRequestId,
      sequences: inspectedFinal.nextSequence,
    }),
    observedLifecycleStates: Object.freeze(observedLifecycleStates),
    requestId,
    stableObservationCount,
    targetWindow,
  });
}

export function assertDurableUnchanged(baseline, observations, finalSnapshot) {
  inspectDurableSnapshot(baseline);
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error('Durable no-op telemetry is unavailable.');
  }
  const expected = JSON.stringify(baseline);
  for (const observation of [...observations, finalSnapshot]) {
    inspectDurableSnapshot(observation);
    if (JSON.stringify(observation) !== expected) {
      throw new Error('A no-file activation changed durable request state.');
    }
  }
  return true;
}
