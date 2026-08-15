/**
 * Thin installed Windows gate for #16 desktop-window routing.
 *
 * CDP observes labels, document state, focus and screenshots. The only pointer
 * gesture uses the hardened Win32 bridge shared with menu acceptance. Full
 * dirty/save/discard/undo/watcher/recent-files coverage remains a later joint
 * installed matrix once the dependent #13 workflow is integrated.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import {
  assertNoExistingImageProcess,
  assertUnifiedProjectVersion,
  buildWin32PointerBridgeSource,
  classifyWin32BridgeFailure,
  cssPointToScreen,
  resolveTrustedWindowsToolPaths,
} from './installedMenuContextOsHelpers.mjs';
import {
  assertExactWindowMarkerMap,
  assertDurableUnchanged,
  assertExactlyOnceDurableTrace,
  assertOwnedProcessIdentity,
  assertOwnedRoutingCleanupContract,
  assertPrimaryRoutingDiagnostics,
  assertSameRoutingEnvironment,
  captureStrictPrimaryProcessEvidence,
  createBoundedProcessOutput,
  createRoutingEnvironment,
  inspectDurableSnapshot,
  observeChildClose,
  observeChildExit,
  PRIMARY_ROUTING_DIAGNOSTIC_ALLOWLIST,
  readExactRoutingWindowSnapshots,
  settleFailedPrimaryProcessEvidence,
  terminateDirectChild,
} from './installedWindowRoutingHelpers.mjs';
import {
  createPackagedWebviewEnvironment,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const APP_TIMEOUT = 30_000;
const DURABLE_STABLE_INTERVAL = 50;
const DURABLE_STABLE_OBSERVATIONS = 8;
const POINTER_TIMEOUT = 20_000;
const tempPrefix = 'lumamark-menu-context-os-routing-';
const workspaceDirectory = resolve(process.cwd());
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const artifactDirectory = resolve(
  process.env.LUMAMARK_ROUTING_ACCEPTANCE_ARTIFACTS?.trim() ||
    join('artifacts', 'installed-window-routing', timestamp),
);
const verifierSourcePath = fileURLToPath(import.meta.url);
const routingHelperSourcePath = fileURLToPath(
  new URL('./installedWindowRoutingHelpers.mjs', import.meta.url),
);
const pointerHelperSourcePath = fileURLToPath(
  new URL('./installedMenuContextOsHelpers.mjs', import.meta.url),
);

if (process.platform !== 'win32') {
  process.stdout.write(
    `${JSON.stringify({ skipped: true, reason: 'Installed window routing acceptance requires Windows.' })}\n`,
  );
  process.exit(0);
}

await mkdir(artifactDirectory, { recursive: true });

const result = {
  schemaVersion: 1,
  gate: 'installed-window-routing-thin-slice',
  limitation:
    'This gate proves routing, lifecycle, focus, native pointer activation and window isolation; the final #13/#16 installed joint matrix must still prove dirty/save/discard/undo/watcher/recent-files behavior.',
  artifactDirectory,
  startedAt: new Date().toISOString(),
  passed: false,
  modes: [],
};

let bridgePath;
let executablePath;
let systemTools;

try {
  systemTools = await resolveTrustedWindowsToolPaths();
  executablePath = await resolveExplicitExecutable();
  const projectVersion = await readProjectVersion();
  const nsisPath = await resolveCurrentNsis(projectVersion);
  bridgePath = join(artifactDirectory, 'win32-pointer-bridge.ps1');
  await writeFile(bridgePath, buildWin32PointerBridgeSource(), 'utf8');

  const [executableStats, nsisStats] = await Promise.all([
    stat(executablePath),
    stat(nsisPath),
  ]);
  result.sources = {
    pointerHelperSha256: await sha256File(pointerHelperSourcePath),
    routingHelperSha256: await sha256File(routingHelperSourcePath),
    verifierSha256: await sha256File(verifierSourcePath),
  };
  result.systemTools = {
    powershellPath: systemTools.powershellPath,
    powershellSha256: await sha256File(systemTools.powershellPath),
    tasklistPath: systemTools.tasklistPath,
    tasklistSha256: await sha256File(systemTools.tasklistPath),
  };
  result.win32Bridge = invokeBridge({ action: 'probe' });
  const executableVersions = invokeBridge({
    action: 'file-version',
    value: executablePath,
  });
  const nsisVersions = invokeBridge({ action: 'file-version', value: nsisPath });
  if (
    normalizeWindowsVersion(executableVersions.fileVersion) !== projectVersion ||
    normalizeWindowsVersion(executableVersions.productVersion) !== projectVersion ||
    normalizeWindowsVersion(nsisVersions.fileVersion) !== projectVersion ||
    normalizeWindowsVersion(nsisVersions.productVersion) !== projectVersion
  ) {
    throw new Error('Release executable or NSIS version does not match the project version.');
  }
  result.artifacts = {
    executable: {
      fileVersion: executableVersions.fileVersion,
      path: executablePath,
      productVersion: executableVersions.productVersion,
      sha256: await sha256File(executablePath),
      size: executableStats.size,
    },
    nsis: {
      fileVersion: nsisVersions.fileVersion,
      path: nsisPath,
      productVersion: nsisVersions.productVersion,
      sha256: await sha256File(nsisPath),
      size: nsisStats.size,
    },
    projectVersion,
  };

  assertNoExistingLumaMarkProcesses();
  for (const mode of ['multiWindow', 'aggregateWindow']) {
    result.modes.push(await runScenario(mode));
  }
  result.finishedAt = new Date().toISOString();
  result.passed = true;
  await writeEvidence('result.json', result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  result.finishedAt = new Date().toISOString();
  result.failure = {
    message: boundedFailureMessage(error),
    ...(error?.routingEvidence
      ? { routingEvidence: error.routingEvidence }
      : {}),
  };
  await writeEvidence('failure.json', result).catch(() => {});
  throw new Error(
    `Installed window routing acceptance failed. See ${join(artifactDirectory, 'failure.json')}.`,
    error instanceof Error ? { cause: error } : undefined,
  );
}

async function runScenario(mode) {
  const ownershipToken = randomUUID();
  const primaryOutput = createBoundedProcessOutput();
  const secondaryEvidence = [];
  const scenarioEvidence = {
    mode,
    commands: [],
    durable: {},
    focus: {},
    nativeInput: null,
    paths: null,
    screenshots: [],
    secondaries: secondaryEvidence,
    windowIsolation: null,
  };
  let browser;
  let context;
  let primary;
  let primaryClose;
  let primaryIdentity;
  let routingEnvironment;
  let tempDirectory;
  let ownershipMarkerPath;
  let settingsConfigDirectory;

  try {
    const debugPort = await reserveDebugPort();
    tempDirectory = await mkdtemp(join(tmpdir(), tempPrefix));
    settingsConfigDirectory = join(tempDirectory, 'settings-config');
    ownershipMarkerPath = join(
      tempDirectory,
      '.lumamark-window-routing-owner.json',
    );
    await mkdir(settingsConfigDirectory);
    await writeFile(
      ownershipMarkerPath,
      JSON.stringify({
        configDirectory: settingsConfigDirectory,
        ownershipToken,
        tempDirectory,
      }),
      { encoding: 'utf8', flag: 'wx' },
    );
    await writeFile(
      join(settingsConfigDirectory, 'settings.json'),
      JSON.stringify(settingsDocument(mode), null, 2),
      'utf8',
    );

    const firstMarker = `${mode}-primary-${ownershipToken}`;
    const secondMarker = `${mode}-secondary-${ownershipToken}`;
    const uncMarker = `${mode}-unc-${ownershipToken}`;
    const knownMarkers = [firstMarker, secondMarker, uncMarker];
    const firstDocumentPath = join(tempDirectory, `${mode}-primary.md`);
    const secondDocumentPath = join(tempDirectory, `${mode}-secondary.md`);
    const uncLocalDocumentPath = join(tempDirectory, `${mode}-unc.md`);
    await Promise.all([
      writeFile(
        firstDocumentPath,
        `# ${mode} primary\n\n${firstMarker}\n`,
        'utf8',
      ),
      writeFile(
        secondDocumentPath,
        `# ${mode} secondary\n\n${secondMarker}\n`,
        'utf8',
      ),
      writeFile(
        uncLocalDocumentPath,
        `# ${mode} UNC\n\n${uncMarker}\n`,
        'utf8',
      ),
    ]);
    const secondCaseAlias = secondDocumentPath.toLocaleUpperCase('en-US');
    const uncDocumentPath = localPathToUnc(uncLocalDocumentPath);
    const extendedUncDocumentPath = toExtendedUnc(uncDocumentPath);
    scenarioEvidence.paths = {
      primary: firstDocumentPath,
      secondaryAliases: [secondDocumentPath, secondCaseAlias],
      uncAliases: [uncDocumentPath, extendedUncDocumentPath],
    };
    const expectedUncContent = await readFile(uncLocalDocumentPath, 'utf8');
    for (const alias of [uncDocumentPath, extendedUncDocumentPath]) {
      const aliasContent = await readFile(alias, 'utf8').catch(() => null);
      if (aliasContent !== expectedUncContent) {
        throw new Error(
          'The dedicated Windows acceptance environment does not expose the owned temp fixture through its localhost administrative UNC share.',
        );
      }
    }

    routingEnvironment = createRoutingEnvironment(
      process.env,
      settingsConfigDirectory,
    );
    const primaryEnvironment = createPackagedWebviewEnvironment({
      baseEnvironment: routingEnvironment,
      debugPort,
      tempDirectory,
    });
    assertSameRoutingEnvironment(routingEnvironment, primaryEnvironment);
    const statePath = join(settingsConfigDirectory, 'open-requests.json');
    const emptyState = emptyDurableState();

    const initialCapture = await captureDurableLaunch(
      statePath,
      emptyState,
      async () => {
        scenarioEvidence.commands.push({
          args: [firstDocumentPath],
          role: 'primary',
        });
        primary = spawn(executablePath, [firstDocumentPath], {
          cwd: tempDirectory,
          env: primaryEnvironment,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: false,
        });
        primaryClose = observeChildClose(primary);
        primary.stdout?.on('data', (chunk) => primaryOutput.append(chunk));
        primary.stderr?.on('data', (chunk) => primaryOutput.append(chunk));
        if (!Number.isInteger(primary.pid)) {
          throw new Error('The primary routing process did not expose a PID.');
        }
        const processInfo = invokeBridge({
          action: 'process-info',
          processId: primary.pid,
        });
        primaryIdentity = assertOwnedProcessIdentity(processInfo, {
          executablePath,
          processId: primary.pid,
          startTimeUtc: processInfo.startTimeUtc,
        });

        await waitForDebug(debugPort, primary);
        browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${debugPort}`,
        );
        context = browser.contexts()[0];
        const initial = await waitForRoutingWindows(context, 1, [firstMarker]);
        assertExactWindowMarkerMap(
          initial,
          { main: firstMarker },
          knownMarkers,
        );
        assertWindowLabels(initial, ['main'], `${mode} cold primary`);
        await waitForFocusedLabel(context, 'main', 1);
        scenarioEvidence.focus.primary = captureOwnedForegroundProof(primaryIdentity);
        await captureWindowScreenshots(initial, `${mode}-cold-primary`, scenarioEvidence);
        return initial;
      },
    );
    scenarioEvidence.durable.primary = assertExactlyOnceDurableTrace({
      baseline: emptyState,
      finalSnapshot: initialCapture.finalSnapshot,
      observations: initialCapture.observations,
      stableObservationCount: initialCapture.stableObservationCount,
      targetWindow: 'main',
    });

    const secondTarget = mode === 'multiWindow' ? 'document-1' : 'main';
    const expectedAfterSecond = mode === 'multiWindow' ? 2 : 1;
    const secondCapture = await captureDurableLaunch(
      statePath,
      initialCapture.finalSnapshot,
      async () => {
        const outcomes = await Promise.all([
          spawnSecondary(secondDocumentPath, 'secondary-original-1'),
          spawnSecondary(secondCaseAlias, 'secondary-case-alias'),
          spawnSecondary(secondDocumentPath, 'secondary-original-2'),
          spawnSecondary(secondCaseAlias, 'secondary-case-alias-2'),
        ]);
        if (outcomes.some((outcome) => outcome.exitCode !== 0)) {
          throw new Error('A duplicate secondary launch did not exit successfully.');
        }
        const routed = await waitForRoutingWindows(
          context,
          expectedAfterSecond,
          mode === 'multiWindow'
            ? [firstMarker, secondMarker]
            : [secondMarker],
        );
        assertWindowLabels(
          routed,
          mode === 'multiWindow' ? ['document-1', 'main'] : ['main'],
          `${mode} duplicate secondary route`,
        );
        assertExactWindowMarkerMap(
          routed,
          mode === 'multiWindow'
            ? { main: firstMarker, 'document-1': secondMarker }
            : { main: secondMarker },
          knownMarkers,
        );
        await waitForFocusedLabel(context, secondTarget, expectedAfterSecond);
        scenarioEvidence.focus.secondaryCoalesced =
          captureOwnedForegroundProof(primaryIdentity);
        await captureWindowScreenshots(
          routed,
          `${mode}-secondary-coalesced`,
          scenarioEvidence,
        );
        return routed;
      },
    );
    scenarioEvidence.durable.secondaryCoalesced =
      assertExactlyOnceDurableTrace({
         baseline: initialCapture.finalSnapshot,
         finalSnapshot: secondCapture.finalSnapshot,
         observations: secondCapture.observations,
         stableObservationCount: secondCapture.stableObservationCount,
        targetWindow: secondTarget,
      });

    const uncTarget = mode === 'multiWindow' ? 'document-2' : 'main';
    const expectedAfterUnc = mode === 'multiWindow' ? 3 : 1;
    const uncCapture = await captureDurableLaunch(
      statePath,
      secondCapture.finalSnapshot,
      async () => {
        const outcomes = await Promise.all([
          spawnSecondary(uncDocumentPath, 'unc-normal'),
          spawnSecondary(extendedUncDocumentPath, 'unc-extended-alias'),
        ]);
        if (outcomes.some((outcome) => outcome.exitCode !== 0)) {
          throw new Error('A UNC secondary launch did not exit successfully.');
        }
        const routed = await waitForRoutingWindows(
          context,
          expectedAfterUnc,
          mode === 'multiWindow'
            ? [firstMarker, secondMarker, uncMarker]
            : [uncMarker],
        );
        assertWindowLabels(
          routed,
          mode === 'multiWindow'
            ? ['document-1', 'document-2', 'main']
            : ['main'],
          `${mode} UNC route`,
        );
        assertExactWindowMarkerMap(
          routed,
          mode === 'multiWindow'
            ? {
                main: firstMarker,
                'document-1': secondMarker,
                'document-2': uncMarker,
              }
            : { main: uncMarker },
          knownMarkers,
        );
        await waitForFocusedLabel(context, uncTarget, expectedAfterUnc);
        scenarioEvidence.focus.uncAliases =
          captureOwnedForegroundProof(primaryIdentity);
        await captureWindowScreenshots(routed, `${mode}-unc`, scenarioEvidence);
        return routed;
      },
    );
    scenarioEvidence.durable.uncAliases = assertExactlyOnceDurableTrace({
      baseline: secondCapture.finalSnapshot,
      finalSnapshot: uncCapture.finalSnapshot,
      observations: uncCapture.observations,
      stableObservationCount: uncCapture.stableObservationCount,
      targetWindow: uncTarget,
    });

    const noFileCapture = await captureDurableNoOp(
      statePath,
      uncCapture.finalSnapshot,
      async () => {
        const outcome = await spawnSecondary(null, 'no-file-activation');
        if (outcome.exitCode !== 0) {
          throw new Error('The no-file secondary activation did not exit successfully.');
        }
        const routed = await waitForRoutingWindows(
          context,
          expectedAfterUnc,
          mode === 'multiWindow'
            ? [firstMarker, secondMarker, uncMarker]
            : [uncMarker],
        );
        await waitForFocusedLabel(context, 'main', expectedAfterUnc);
        scenarioEvidence.focus.noFileActivation =
          captureOwnedForegroundProof(primaryIdentity);
        assertWindowLabels(
          routed,
          mode === 'multiWindow'
            ? ['document-1', 'document-2', 'main']
            : ['main'],
          `${mode} no-file activation`,
        );
        assertExactWindowMarkerMap(
          routed,
          mode === 'multiWindow'
            ? {
                main: firstMarker,
                'document-1': secondMarker,
                'document-2': uncMarker,
              }
            : { main: uncMarker },
          knownMarkers,
        );
        return routed;
      },
    );
    assertDurableUnchanged(
      uncCapture.finalSnapshot,
      noFileCapture.observations,
      noFileCapture.finalSnapshot,
    );
    scenarioEvidence.durable.noFileActivation = { unchanged: true };

    if (mode === 'aggregateWindow') {
      const routed = await waitForRoutingWindows(context, 1, [uncMarker]);
      assertExactWindowMarkerMap(
        routed,
        { main: uncMarker },
        knownMarkers,
      );
      scenarioEvidence.nativeInput = await clickEditorWithNativePointer(
        routed[0].page,
        primaryIdentity,
      );
      await routed[0].page.screenshot({
        path: join(artifactDirectory, `${mode}-native-focus.png`),
      });
      scenarioEvidence.screenshots.push(`${mode}-native-focus.png`);
    }

    if (mode === 'multiWindow') {
      const beforeClose = await waitForRoutingWindows(context, 3, [
        firstMarker,
        secondMarker,
        uncMarker,
      ]);
      assertExactWindowMarkerMap(
        beforeClose,
        {
          main: firstMarker,
          'document-1': secondMarker,
          'document-2': uncMarker,
        },
        knownMarkers,
      );
      const closing = beforeClose.find(({ label }) => label === 'document-2');
      if (!closing) throw new Error('The window-isolation close target is missing.');
      await closeWindowThroughItsOwnTauriHandle(closing.page);
      const survivors = await waitForRoutingWindows(context, 2, [
        firstMarker,
        secondMarker,
      ]);
      assertWindowLabels(
        survivors,
        ['document-1', 'main'],
        'multiWindow survivor set',
      );
      assertExactWindowMarkerMap(
        survivors,
        { main: firstMarker, 'document-1': secondMarker },
        knownMarkers,
      );
      const currentProcess = invokeBridge({
        action: 'process-info',
        processId: primary.pid,
      });
      assertOwnedProcessIdentity(currentProcess, primaryIdentity);
      await captureWindowScreenshots(
        survivors,
        `${mode}-one-window-closed`,
        scenarioEvidence,
      );
      scenarioEvidence.windowIsolation = {
        closedLabel: 'document-2',
        processIdentityPreserved: true,
        survivingLabels: survivors.map(({ label }) => label).sort(),
      };
    }

    const finalWindows = await readAllRoutingWindows(
      context,
      mode === 'multiWindow' ? 2 : 1,
    );
    scenarioEvidence.windows = finalWindows.map(sanitizeWindowSnapshot);

    await browser.close();
    browser = undefined;
    scenarioEvidence.primary = await terminateOwnedPrimary(
      primary,
      primaryClose,
      primaryIdentity,
      primaryOutput,
    );
    primary = undefined;
    assertPrimaryRoutingDiagnostics(scenarioEvidence.primary.output,
      PRIMARY_ROUTING_DIAGNOSTIC_ALLOWLIST,
    );
    await removeOwnedRoutingTempDirectory({
      ownershipMarkerPath,
      ownershipToken,
      settingsConfigDirectory,
      tempDirectory,
    });
    tempDirectory = undefined;
    return scenarioEvidence;
  } catch (error) {
    const cleanup = {
      browserClosed: browser === undefined,
      tempDirectoryRemoved: tempDirectory ? false : null,
    };
    if (browser) {
      try {
        await browser.close();
        cleanup.browserClosed = true;
      } catch {
        cleanup.browserClosed = false;
        cleanup.browserFailure = { code: 'browser_close_unproven' };
      }
      browser = undefined;
    }
    if (!scenarioEvidence.primary) {
      scenarioEvidence.primary = await settleFailedPrimaryProcessEvidence({
        identity: primaryIdentity,
        output: primaryOutput,
        primaryStarted: Boolean(primary),
        terminateIdentifiedPrimary: () =>
          terminateOwnedPrimary(
            primary,
            primaryClose,
            primaryIdentity,
            primaryOutput,
          ),
        terminateUnidentifiedPrimary: () => terminateDirectChild(primary),
      });
    }
    const primaryExitProven =
      !primary || scenarioEvidence.primary.identityExited === true;
    if (
      tempDirectory &&
      ownershipMarkerPath &&
      settingsConfigDirectory &&
      primaryExitProven
    ) {
      try {
        await removeOwnedRoutingTempDirectory({
          ownershipMarkerPath,
          ownershipToken,
          settingsConfigDirectory,
          tempDirectory,
        });
        tempDirectory = undefined;
        cleanup.tempDirectoryRemoved = true;
      } catch {
        cleanup.cleanupFailure = { code: 'routing_temp_cleanup_failed' };
      }
    } else if (tempDirectory) {
      cleanup.cleanupFailure = {
        code: primaryExitProven
          ? 'routing_temp_cleanup_contract_incomplete'
          : 'routing_temp_cleanup_blocked_by_unproven_process_exit',
      };
    }
    throw Object.assign(
      new Error(`${mode} routing scenario failed: ${boundedFailureMessage(error)}`, {
        cause: error,
      }),
      {
        routingEvidence: {
          commands: scenarioEvidence.commands,
          durable: scenarioEvidence.durable,
          focus: scenarioEvidence.focus,
          mode,
          paths: scenarioEvidence.paths,
          primary: scenarioEvidence.primary,
          cleanup,
          screenshots: scenarioEvidence.screenshots,
          secondaries: secondaryEvidence,
          windowObservation: error?.windowObservation ?? null,
          windowIsolation: scenarioEvidence.windowIsolation,
        },
      },
    );
  }

  function spawnSecondary(documentPath, role) {
    const secondaryEnvironment = Object.freeze({ ...routingEnvironment });
    assertSameRoutingEnvironment(routingEnvironment, secondaryEnvironment);
    const args = documentPath ? [documentPath] : [];
    const output = createBoundedProcessOutput();
    const child = spawn(executablePath, args, {
      cwd: tempDirectory,
      env: secondaryEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const terminal = observeChildExit(child);
    child.stdout?.on('data', (chunk) => output.append(chunk));
    child.stderr?.on('data', (chunk) => output.append(chunk));
    scenarioEvidence.commands.push({
      args,
      role,
    });
    return waitForOwnedChildExit(child, terminal, 12_000).then((outcome) => {
      const childEvidence = {
        exitCode: outcome.exitCode,
        output: output.summary(),
        pid: child.pid,
        role,
        signal: outcome.signal,
      };
      secondaryEvidence.push(childEvidence);
      return childEvidence;
    });
  }
}

async function captureDurableLaunch(statePath, baseline, action) {
  const observations = [];
  const actionResult = await action();
  const stable = await waitForStableDurableState(statePath, baseline, observations);
  return { ...stable, actionResult, observations };
}

async function captureDurableNoOp(statePath, baseline, action) {
  const observations = [];
  await action();
  let stable = 0;
  let finalSnapshot;
  const expected = JSON.stringify(baseline);
  const deadline = Date.now() + APP_TIMEOUT;
  while (Date.now() < deadline && stable < DURABLE_STABLE_OBSERVATIONS) {
    finalSnapshot = await readDurableState(statePath);
    if (!finalSnapshot) throw new Error('Durable no-op state disappeared.');
    observations.push(finalSnapshot);
    stable = JSON.stringify(finalSnapshot) === expected ? stable + 1 : 0;
    await delay(DURABLE_STABLE_INTERVAL);
  }
  if (stable < DURABLE_STABLE_OBSERVATIONS) {
    throw new Error('No-file activation did not preserve a stable durable state.');
  }
  return { finalSnapshot, observations };
}

async function waitForStableDurableState(statePath, baseline, observations) {
  const inspectedBaseline = inspectDurableSnapshot(baseline);
  let finalSnapshot;
  let previous = '';
  let stableObservationCount = 0;
  const deadline = Date.now() + APP_TIMEOUT;
  while (
    Date.now() < deadline &&
    stableObservationCount < DURABLE_STABLE_OBSERVATIONS
  ) {
    const snapshot = await readDurableState(statePath);
    if (snapshot) {
      observations.push(snapshot);
      const inspected = inspectDurableSnapshot(snapshot);
      const active = inspected.records.some(({ state }) =>
        ['queued', 'processing', 'appliedPendingAcknowledgement'].includes(
          state.kind,
        ),
      );
      const serialized = JSON.stringify(snapshot);
      const quiescent =
        inspected.nextRequestId > inspectedBaseline.nextRequestId &&
        inspected.nextAttemptSequence >
          inspectedBaseline.nextAttemptSequence &&
        inspected.retained.length === 0 &&
        !active;
      stableObservationCount =
        quiescent && serialized === previous
          ? stableObservationCount + 1
          : quiescent
            ? 1
            : 0;
      previous = serialized;
      finalSnapshot = snapshot;
    }
    await delay(DURABLE_STABLE_INTERVAL);
  }
  if (!finalSnapshot || stableObservationCount < DURABLE_STABLE_OBSERVATIONS) {
    throw new Error('Durable open-request state did not reach stable acknowledgement.');
  }
  return { finalSnapshot, stableObservationCount };
}

async function readDurableState(statePath) {
  try {
    const value = JSON.parse(await readFile(statePath, 'utf8'));
    inspectDurableSnapshot(value);
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function waitForRoutingWindows(context, expectedCount, expectedMarkers) {
  const deadline = Date.now() + APP_TIMEOUT;
  let latest;
  do {
    if (context.pages().length < expectedCount) {
      await delay(100);
      continue;
    }
    latest = await readAllRoutingWindows(context, expectedCount);
    const contents = latest.map((window) => window.content);
    if (
      latest.length === expectedCount &&
      expectedMarkers.every((marker) =>
        contents.some((content) => content.includes(marker)),
      )
    ) {
      return latest;
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error('Window labels/content did not reach the expected routing state.');
}

async function readAllRoutingWindows(context, expectedCount) {
  const pages = context.pages();
  return readExactRoutingWindowSnapshots(
    pages,
    expectedCount,
    async (page) => {
      const snapshot = await readRoutingWindow(page);
      return snapshot ? { ...snapshot, page } : null;
    },
  );
}

async function readRoutingWindow(page) {
  await page
    .waitForLoadState('domcontentloaded', { timeout: 2_000 })
    .catch(() => {});
  return page.evaluate(() => {
    const currentWindow = window.__TAURI_INTERNALS__?.metadata?.currentWindow;
    const title = document.querySelector('.lm-editor-title')?.textContent ?? '';
    const content = document.querySelector('.cm-content')?.textContent ?? '';
    if (!currentWindow?.label || !document.querySelector('.lm-app-shell')) {
      return null;
    }
    return {
      appShellReady: true,
      content,
      editorFocused: Boolean(document.activeElement?.closest?.('.cm-editor')),
      hasFocus: document.hasFocus(),
      label: currentWindow.label,
      title,
    };
  });
}

async function waitForFocusedLabel(context, expectedLabel, expectedCount) {
  const deadline = Date.now() + APP_TIMEOUT;
  while (Date.now() < deadline) {
    const windows = await readAllRoutingWindows(context, expectedCount);
    if (windows.some(({ hasFocus, label }) => label === expectedLabel && hasFocus)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Desktop focus did not move to the expected ${expectedLabel} window.`);
}

function assertWindowLabels(windows, expected, label) {
  const actual = windows.map((window) => window.label).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} produced an unexpected managed-window label set.`);
  }
}

async function captureWindowScreenshots(windows, phase, scenarioEvidence) {
  for (const window of windows) {
    const name = `${phase}-${window.label}.png`;
    await window.page.screenshot({ path: join(artifactDirectory, name) });
    scenarioEvidence.screenshots.push(name);
  }
}

function sanitizeWindowSnapshot(window) {
  return {
    editorFocused: window.editorFocused,
    hasFocus: window.hasFocus,
    label: window.label,
    title: window.title,
  };
}

async function clickEditorWithNativePointer(page, processIdentity) {
  const current = invokeBridge({
    action: 'process-info',
    processId: processIdentity.processId,
  });
  assertOwnedProcessIdentity(current, processIdentity);
  const locator = page.locator('.cm-content');
  await locator.waitFor({ state: 'visible', timeout: APP_TIMEOUT });
  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('The editor did not expose a native pointer target.');
  }
  const metrics = invokeBridge({
    action: 'metrics',
    processIdentity,
  });
  if (
    metrics.inputDesktop?.name !== 'Default' ||
    metrics.inputDesktop?.threadName !== 'Default' ||
    metrics.inputDesktop?.matchesThread !== true ||
    metrics.mainWindowResponsive !== true
  ) {
    throw new Error('The hardened pointer bridge did not prove the interactive Default desktop.');
  }
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  const screenPoint = cssPointToScreen({
    clientOrigin: metrics.clientOrigin,
    cssPoint: {
      x: box.x + Math.min(box.width / 2, 240),
      y: box.y + Math.min(box.height / 2, 120),
    },
    devicePixelRatio,
  });
  const pointer = invokeBridge({
    action: 'pointer',
    button: 'left',
    gesture: 'click',
    processIdentity,
    screenPoint,
  });
  const focused = await page.evaluate(
    () =>
      document.hasFocus() &&
      Boolean(document.activeElement?.closest?.('.cm-editor')),
  );
  if (!focused) {
    throw new Error('The native pointer click did not focus the real editor.');
  }
  return {
    clientOrigin: metrics.clientOrigin,
    coordinateConversion: 'ClientToScreen',
    inputApi: 'SendInput',
    inputDesktop: metrics.inputDesktop,
    pointer,
    screenPoint,
    targetOwnership: pointer.injected?.hitTest,
  };
}

function captureOwnedForegroundProof(processIdentity) {
  const metrics = invokeBridge({ action: 'metrics', processIdentity });
  if (
    metrics.inputDesktop?.name !== 'Default' ||
    metrics.inputDesktop?.threadName !== 'Default' ||
    metrics.inputDesktop?.matchesThread !== true ||
    metrics.mainWindowResponsive !== true ||
    metrics.foreground?.processId !== processIdentity.processId
  ) {
    throw new Error(
      'The focused routing window was not proven on the owned foreground process and Default desktop.',
    );
  }
  return {
    foregroundProcessId: metrics.foreground.processId,
    inputDesktop: metrics.inputDesktop,
    mainWindowResponsive: metrics.mainWindowResponsive,
  };
}

async function closeWindowThroughItsOwnTauriHandle(page) {
  const closed = page.waitForEvent('close', { timeout: APP_TIMEOUT });
  try {
    await page.evaluate(async () => {
      const internals = window.__TAURI_INTERNALS__;
      const label = internals?.metadata?.currentWindow?.label;
      if (!label || typeof internals?.invoke !== 'function') {
        throw new Error('The managed window close handle is unavailable.');
      }
      await internals.invoke('plugin:window|close', { label });
    });
  } catch (error) {
    try {
      await closed;
      return;
    } catch {
      throw error;
    }
  }
  await closed;
}

function invokeBridge({
  action,
  button,
  gesture,
  processId,
  processIdentity,
  screenPoint,
  value,
}) {
  if (!systemTools?.powershellPath || !bridgePath) {
    throw new Error('The trusted Win32 pointer bridge is unavailable.');
  }
  const args = [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    bridgePath,
    '-Action',
    action,
  ];
  const targetProcessId = processIdentity?.processId ?? processId;
  if (Number.isInteger(targetProcessId)) {
    args.push('-TargetProcessId', String(targetProcessId));
  }
  if (action === 'metrics' || action === 'pointer') {
    assertOwnedProcessIdentity(processIdentity, processIdentity);
    args.push('-TargetExecutablePath', processIdentity.executablePath);
    args.push('-TargetStartTimeUtc', processIdentity.startTimeUtc);
  }
  if (button) args.push('-Button', button);
  if (gesture) args.push('-Gesture', gesture);
  if (screenPoint) {
    args.push('-X', String(screenPoint.x), '-Y', String(screenPoint.y));
  }
  if (value !== undefined) args.push('-Value', value);
  try {
    const output = execFileSync(systemTools.powershellPath, args, {
      encoding: 'utf8',
      timeout: action === 'pointer' ? POINTER_TIMEOUT : 10_000,
      windowsHide: true,
    }).trim();
    const jsonLine = output.split(/\r?\n/).filter(Boolean).at(-1);
    if (!jsonLine) throw new Error('empty bridge output');
    return JSON.parse(jsonLine);
  } catch (error) {
    const failure = classifyWin32BridgeFailure(action, error);
    throw new Error(
      `Hardened Win32 bridge failed (${failure.action}/${failure.code}/${String(failure.status)}).`,
      { cause: error },
    );
  }
}

async function terminateOwnedPrimary(child, terminal, identity, output) {
  if (child.exitCode === null && child.signalCode === null) {
    const before = invokeBridge({
      action: 'process-info',
      processId: identity.processId,
    });
    assertOwnedProcessIdentity(before, identity);
    child.kill('SIGKILL');
  }
  let timeoutHandle;
  const timeout = new Promise((resolveTimeout) => {
    timeoutHandle = setTimeout(() => resolveTimeout({ timeout: true }), 8_000);
  });
  try {
    return await captureStrictPrimaryProcessEvidence({
      identity,
      output,
      proveIdentityExited: async () => {
        const after = invokeBridge({
          action: 'process-info',
          processId: identity.processId,
        });
        return after.exists === false;
      },
      terminal: Promise.race([terminal, timeout]),
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function waitForOwnedChildExit(child, terminal, timeoutMs) {
  const outcome = await Promise.race([
    terminal,
    delay(timeoutMs).then(() => ({ timeout: true })),
  ]);
  if (outcome?.timeout) {
    if (child.exitCode === null) await terminateDirectChild(child);
    throw new Error('An acceptance-owned secondary process did not exit in time.');
  }
  if (outcome?.error) {
    if (Number.isInteger(child.pid) && child.exitCode === null) {
      await terminateDirectChild(child);
    }
    throw new Error('An acceptance-owned secondary process failed.', {
      cause: outcome.error,
    });
  }
  return outcome;
}

async function waitForDebug(debugPort, child) {
  const deadline = Date.now() + APP_TIMEOUT;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('The primary process exited before WebView startup.');
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) return;
    } catch {
      // The endpoint is polled until the bounded deadline.
    }
    await delay(250);
  }
  throw new Error('The isolated WebView2 debug endpoint did not start.');
}

async function removeOwnedRoutingTempDirectory({
  ownershipMarkerPath,
  ownershipToken,
  settingsConfigDirectory,
  tempDirectory,
}) {
  const [canonicalSystemTemp, canonicalTemp, canonicalConfig] = await Promise.all([
    realpath(tmpdir()),
    realpath(tempDirectory),
    realpath(settingsConfigDirectory),
  ]);
  const marker = JSON.parse(await readFile(ownershipMarkerPath, 'utf8'));
  assertOwnedRoutingCleanupContract({
    canonicalConfig,
    canonicalSystemTemp,
    canonicalTemp,
    marker,
    ownershipToken,
  });
  await rm(canonicalTemp, {
    force: true,
    maxRetries: 12,
    recursive: true,
    retryDelay: 250,
  });
}

function assertNoExistingLumaMarkProcesses() {
  const imageName = basename(executablePath);
  const inspection = spawnSync(
    systemTools.tasklistPath,
    ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true },
  );
  assertNoExistingImageProcess(inspection, imageName);
}

async function resolveExplicitExecutable() {
  const requested = process.env.LUMAMARK_EXECUTABLE?.trim();
  if (!requested) {
    throw new Error('LUMAMARK_EXECUTABLE must explicitly identify the installed candidate.');
  }
  const canonical = await realpath(resolve(requested));
  const stats = await stat(canonical);
  if (!stats.isFile() || basename(canonical).toLocaleLowerCase('en-US') !== 'lumamark.exe') {
    throw new Error('LUMAMARK_EXECUTABLE is not the canonical LumaMark executable.');
  }
  return canonical;
}

async function resolveCurrentNsis(version) {
  const requested =
    process.env.LUMAMARK_ROUTING_ACCEPTANCE_NSIS?.trim() ||
    join(
      workspaceDirectory,
      'src-tauri',
      'target',
      'release',
      'bundle',
      'nsis',
      `LumaMark_${version}_x64-setup.exe`,
    );
  const canonical = await realpath(resolve(requested));
  const stats = await stat(canonical);
  if (!stats.isFile()) throw new Error('The current NSIS candidate is unavailable.');
  return canonical;
}

async function readProjectVersion() {
  const [packageText, cargoText, tauriText, lockText] = await Promise.all([
    readFile(join(workspaceDirectory, 'package.json'), 'utf8'),
    readFile(join(workspaceDirectory, 'src-tauri', 'Cargo.toml'), 'utf8'),
    readFile(join(workspaceDirectory, 'src-tauri', 'tauri.conf.json'), 'utf8'),
    readFile(join(workspaceDirectory, 'src-tauri', 'Cargo.lock'), 'utf8'),
  ]);
  const packageVersion = JSON.parse(packageText).version;
  const tauriVersion = JSON.parse(tauriText).version;
  const cargoVersion = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const lockVersion = lockText.match(
    /\[\[package\]\]\s*\r?\nname\s*=\s*"lumamark"\s*\r?\nversion\s*=\s*"([^"]+)"/,
  )?.[1];
  return assertUnifiedProjectVersion({
    cargo: cargoVersion,
    lock: lockVersion,
    package: packageVersion,
    tauri: tauriVersion,
  });
}

function settingsDocument(openWindowMode) {
  return {
    appearance: {
      fontZoomPercent: 100,
      pageWidth: 'standard',
      sidebarOpenOnStartup: false,
      theme: 'light',
    },
    editor: {
      defaultDisplayMode: 'livePreview',
      focusModeOnStartup: false,
    },
    general: {
      language: 'en',
      openWindowMode,
      startupBehavior: 'home',
    },
    images: { copyImagesToAssets: false },
    updates: { autoCheckOnStartup: false },
    version: 2,
  };
}

function emptyDurableState() {
  return {
    lifecycle: {
      acknowledgedRanges: [],
      nextAttemptSequence: 0,
      nextSequence: 0,
      recentCompletionFences: [],
      records: [],
    },
    nextRequestId: 0,
    retainedRequests: [],
    version: 2,
  };
}

function localPathToUnc(path) {
  const match = resolve(path).match(/^([A-Za-z]):\\(.*)$/);
  if (!match) throw new Error('The owned UNC fixture requires a drive-letter temp path.');
  return `\\\\localhost\\${match[1].toUpperCase()}$\\${match[2]}`;
}

function toExtendedUnc(path) {
  if (!path.startsWith('\\\\')) throw new Error('The UNC alias is invalid.');
  return `\\\\?\\UNC\\${path.slice(2)}`;
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function normalizeWindowsVersion(version) {
  const match = String(version ?? '').match(/\d+\.\d+\.\d+/);
  return match?.[0] ?? '';
}

function boundedFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 800);
}

async function writeEvidence(name, value) {
  await writeFile(
    join(artifactDirectory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}
