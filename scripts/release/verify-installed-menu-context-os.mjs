/**
 * Installed Windows acceptance for titlebar and context menus.
 *
 * Every menu trigger, menu command, context-menu open, and titlebar gesture is
 * injected through Win32. Playwright/CDP is deliberately limited to locating
 * targets, reading state, polling assertions, capturing screenshots, and
 * installing the scoped workspace-command bridge used by this acceptance run.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';
import {
  accessErrorMeansPathMissing,
  assertAlreadyExitedAcceptanceChild,
  assertClipboardCleanupReady,
  assertCurrentCommandOwnedClipboardMetadata,
  assertOwnedClipboardMutation,
  clipboardTextMatches,
  assertOwnedClipboardMetadata,
  assertNoExistingImageProcess,
  assertExplicitReleaseExecutable,
  assertUnifiedProjectVersion,
  buildWin32PointerBridgeSource,
  classifyWin32BridgeFailure,
  classifyClipboardFormats,
  cssPointToScreen,
  decodeClipboardTextFromBridge,
  encodeClipboardTextForBridge,
  isSafeAcceptanceTempDirectory,
  isHorizontalMenuLayout,
  resolveTrustedWindowsToolPaths,
  summarizeClipboardMetadataForEvidence,
} from './installedMenuContextOsHelpers.mjs';

const POINTER_TIMEOUT = 20_000;
const APP_TIMEOUT = 30_000;
const LINK_DESTINATION = 'https://example.com/lumamark-context';
const IMAGE_SOURCE = './acceptance.svg';
const PLAIN_MARKER = 'PLAIN_ACCEPTANCE_MARKER';
const TABLE_MARKER = 'TABLE_ACCEPTANCE_MARKER';
const SECOND_TABLE_MARKER = 'SECOND_TABLE_ACCEPTANCE_MARKER';
const AFTER_MARKER = 'AFTER_TABLE_ACCEPTANCE_MARKER';
const ACCEPTANCE_TABLE_WIDGET_COUNT = 2;
const INSTALLED_TEXT_WRITER_KIND = 'tauri-native-text';
const TABLE_SOURCE = [
  '| Target                  | Value |',
  '| ----------------------- | ----- |',
  `| ${TABLE_MARKER} | keep  |`,
].join('\n');
const SECOND_TABLE_SOURCE = [
  '| Other                          | Value    |',
  '| ------------------------------ | -------- |',
  `| ${SECOND_TABLE_MARKER} | preserve |`,
].join('\n');
const ACCEPTANCE_FIXTURE_MARKERS = [
  PLAIN_MARKER,
  TABLE_MARKER,
  SECOND_TABLE_MARKER,
  AFTER_MARKER,
  'LINK_ACCEPTANCE_LABEL',
  'IMAGE_ACCEPTANCE',
];
const SETTINGS_WRITE_BARRIER_MARKERS = new Set([
  'arm',
  'close-entered',
  'entered',
  'release',
]);
const allowPlainTextClipboardRestore =
  process.env.LUMAMARK_ACCEPTANCE_ALLOW_PLAINTEXT_CLIPBOARD_RESTORE === '1';

const LABELS = {
  appearance: /^(?:Appearance|外观)$/,
  autoCheckUpdates: /^(?:Check for updates when LumaMark starts|启动时检查更新)$/,
  close: /^(?:Close|关闭)$/,
  copy: /^(?:Copy|复制)(?:\s|$)/,
  cut: /^(?:Cut|剪切)(?:\s|$)/,
  copyImagePath: /^(?:Copy image path|复制图片路径)$/i,
  copyLinkAddress: /^(?:Copy link address|复制链接地址)$/i,
  copyPath: /^(?:Copy Path|复制路径)$/,
  copyTable: /^(?:Copy table|复制表格)(?:\s|$)/i,
  deleteImageReference: /^(?:Delete reference|删除引用)$/i,
  deleteTable: /^(?:Delete table|删除表格)(?:\s|$)/i,
  file: /^(?:File|文件)$/,
  maximizeOrRestore: /(?:Maximize|Restore|最大化|还原)/i,
  newFile: /^(?:New File|新建文件)$/,
  newFolder: /^(?:New Folder|新建文件夹)$/,
  openWorkspace: /^(?:Open Workspace|打开工作区)$/,
  paste: /^(?:Paste|粘贴)(?:\s|$)/,
  rename: /^(?:Rename|重命名)$/,
  revealImage: /^(?:Reveal in File Manager|在文件管理器中显示)$/i,
  selectAll: /^(?:Select All|全选)(?:\s|$)/,
  settings: /^(?:Settings|设置)$/,
  theme: /^(?:Theme|主题)$/,
  themeDark: /^(?:Dark|暗色)$/,
  themeSystem: /^(?:System|跟随系统)$/,
  windowClose: /^(?:Close window|关闭窗口)$/,
};

if (process.platform !== 'win32') {
  process.stdout.write(
    `${JSON.stringify({ skipped: true, reason: 'Win32 OS pointer acceptance requires Windows.' })}\n`,
  );
  process.exit(0);
}

const workspaceDirectory = resolve(process.cwd());
const verifierSourcePath = fileURLToPath(import.meta.url);
const helperSourcePath = join(
  dirname(verifierSourcePath),
  'installedMenuContextOsHelpers.mjs',
);
const acceptanceRunId = process.env.LUMAMARK_ACCEPTANCE_RUN_ID?.trim() ?? '';
let executablePath = process.env.LUMAMARK_EXECUTABLE?.trim() || '';
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const artifactDirectory = resolve(
  process.env.LUMAMARK_ACCEPTANCE_ARTIFACTS?.trim() ||
    join('artifacts', 'installed-menu-context-os', timestamp),
);

const evidence = {
  schemaVersion: 2,
  mode: 'installed-win32-os-pointer',
  acceptanceRunId,
  cdpUsage:
    'test setup bridge activation plus read-only geometry, state assertions, polling, and screenshots; all acceptance interactions use Win32 input',
  clipboardHandling:
    'clipboard-changing checks require an empty clipboard by default; dedicated-environment plain-text restore is explicit opt-in, uses stdin plus a sequence-number compare-and-set, and evidence never stores content or fingerprints',
  executablePath,
  artifactDirectory,
  startedAt: new Date().toISOString(),
  clientMetrics: [],
  pointerEvents: [],
  menuLayouts: [],
  checks: [],
  screenshots: [],
  workspaceBridge: null,
  consoleErrors: [],
  pageErrors: [],
  pageCrashes: [],
  startupDialogs: [],
  processOutput: { stderr: [], stdout: [] },
  processLaunches: [],
  clipboardMetadataObservations: [],
  debugPorts: [],
  webviewProfiles: [],
  settingsPersistence: null,
};

let app;
let appTermination;
let activeChildBaseline;
let browser;
let page;
let cdpConnectionEstablished = false;
let tempDirectory;
let bridgePath;
let workspaceRoot;
let documentPath;
let settingsConfigDirectory;
let settingsWriteBarrierDirectory;
let originalClipboardText = '';
let originalClipboardHadText = false;
let expectedClipboardSequence;
let clipboardCaptured = false;
let clipboardWasMutated = false;
let pendingClipboardMutation;
let inputInjectionPermitted = true;
let clipboardCleanupState = {
  cdpDisconnected: false,
  childExitVerified: false,
  inputStopped: false,
};
let clipboardPrivacyRisk;
let interruptionSignal;
let failure;
let safeFixtureVisible = false;
let systemTools;

const requestGracefulInterruption = (signal) => {
  if (interruptionSignal) return;
  interruptionSignal = signal;
  process.exitCode = 1;
  evidence.interruption = {
    requestedAt: new Date().toISOString(),
    signal,
  };
  evidence.checks.push({
    detail: { signal },
    name: 'acceptance-not-interrupted',
    ok: false,
  });
};
const handleSigint = () => requestGracefulInterruption('SIGINT');
const handleSigterm = () => requestGracefulInterruption('SIGTERM');
process.on('SIGINT', handleSigint);
process.on('SIGTERM', handleSigterm);

await mkdir(artifactDirectory, { recursive: true });

try {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(acceptanceRunId)) {
    throw new Error('The installed acceptance run identifier is invalid.');
  }
  evidence.acceptanceSourceIdentity = {
    helperSha256: await sha256File(helperSourcePath),
    verifierSha256: await sha256File(verifierSourcePath),
  };
  systemTools = await resolveTrustedWindowsToolPaths();
  evidence.systemTools = {
    powershellPath: systemTools.powershellPath,
    powershellSha256: await sha256File(systemTools.powershellPath),
    tasklistPath: systemTools.tasklistPath,
    tasklistSha256: await sha256File(systemTools.tasklistPath),
  };
  executablePath = assertExplicitReleaseExecutable(
    process.env.LUMAMARK_EXECUTABLE?.trim() || '',
    workspaceDirectory,
  );
  evidence.executablePath = executablePath;
  await access(executablePath);
  assertNoExistingInstance(executablePath);

  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-menu-context-os-'));
  requireCheck(
    'acceptance-temp-root-has-owned-prefix',
    isSafeAcceptanceTempDirectory(tempDirectory, tmpdir()),
    { temporaryRootName: basename(tempDirectory) },
  );
  workspaceRoot = join(tempDirectory, 'acceptance-workspace');
  const folderPath = join(workspaceRoot, 'FolderTarget');
  settingsConfigDirectory = join(tempDirectory, 'settings-config');
  settingsWriteBarrierDirectory = join(tempDirectory, 'settings-write-barrier');
  documentPath = join(workspaceRoot, 'acceptance.md');
  bridgePath = join(tempDirectory, 'win32-pointer-bridge.ps1');
  await Promise.all([
    mkdir(folderPath, { recursive: true }),
    mkdir(settingsConfigDirectory, { recursive: true }),
    mkdir(settingsWriteBarrierDirectory, { recursive: true }),
  ]);

  const markdown = [
    '# Installed menu context acceptance',
    '',
    `${PLAIN_MARKER} keep this paragraph`,
    '',
    `[LINK_ACCEPTANCE_LABEL](${LINK_DESTINATION})`,
    '',
    `![IMAGE_ACCEPTANCE](${IMAGE_SOURCE})`,
    '',
    TABLE_SOURCE,
    '',
    SECOND_TABLE_SOURCE,
    '',
    `${AFTER_MARKER} keep this paragraph`,
    '',
  ].join('\n');

  await Promise.all([
    writeFile(documentPath, markdown, 'utf8'),
    writeFile(join(workspaceRoot, 'file-target.md'), '# File target\n', 'utf8'),
    writeFile(join(folderPath, 'nested.md'), '# Nested target\n', 'utf8'),
    writeFile(
      join(workspaceRoot, 'acceptance.svg'),
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="54" viewBox="0 0 180 54">',
        '<rect width="180" height="54" rx="8" fill="#5271ff"/>',
        '<text x="90" y="33" fill="white" text-anchor="middle" font-family="sans-serif" font-size="14">IMAGE ACCEPTANCE</text>',
        '</svg>',
      ].join(''),
      'utf8',
    ),
    writeFile(bridgePath, buildWin32PointerBridgeSource(), 'utf8'),
  ]);

  evidence.win32Bridge = invokeBridge({ action: 'probe', timeout: 15_000 });
  requireCheck(
    'win32-bridge-uses-pmv2-client-hit-testing',
    evidence.win32Bridge.dpiAwareness === 'per-monitor-v2' &&
      evidence.win32Bridge.clientCoordinates === true &&
      evidence.win32Bridge.windowHitTesting === true,
    evidence.win32Bridge,
  );

  const versions = await readProjectVersions(workspaceDirectory);
  const projectVersion = assertUnifiedProjectVersion(versions);
  const fileVersions = invokeBridge({
    action: 'file-version',
    timeout: 10_000,
    value: executablePath,
  });
  const executableStats = await stat(executablePath);
  const executableSha256 = await sha256File(executablePath);
  evidence.executableIdentity = {
    executableSha256,
    fileVersion: fileVersions.fileVersion,
    productVersion: fileVersions.productVersion,
    projectVersion,
    size: executableStats.size,
    sourceVersions: versions,
  };
  requireCheck(
    'explicit-executable-version-matches-project',
    normalizeWindowsVersion(fileVersions.fileVersion) === projectVersion &&
      normalizeWindowsVersion(fileVersions.productVersion) === projectVersion,
    evidence.executableIdentity,
  );

  evidence.acceptanceInput = {
    documentPath,
    workspaceRoot,
    isolatedUnderTemporaryDirectory: isInside(tempDirectory, documentPath) && isInside(tempDirectory, workspaceRoot),
  };
  evidence.configIsolation = {
    acceptanceMode: '1',
    requestedConfigDirectory: settingsConfigDirectory,
    requestedWriteBarrierDirectory: settingsWriteBarrierDirectory,
    requestedInsideTemporaryDirectory: isInside(
      tempDirectory,
      settingsConfigDirectory,
    ),
    requestedWriteBarrierInsideTemporaryDirectory: isInside(
      tempDirectory,
      settingsWriteBarrierDirectory,
    ),
  };
  requireCheck(
    'acceptance-input-is-temporary',
    evidence.acceptanceInput.isolatedUnderTemporaryDirectory,
    evidence.acceptanceInput,
  );
  requireCheck(
    'tauri-settings-config-request-is-temporary',
    evidence.configIsolation.requestedInsideTemporaryDirectory &&
      evidence.configIsolation.requestedWriteBarrierInsideTemporaryDirectory,
    evidence.configIsolation,
  );

  await launchAcceptanceApplication('initial');

  await verifyTopChromeAndDragging();
  await verifySettingsPersistenceAcrossRestart();
  await activateWorkspaceAcceptanceBridge();
  await openTemporaryWorkspace();
  try {
    const clipboardMetadata = inspectBridgeClipboard();
    const clipboardMetadataSummary =
      summarizeClipboardMetadataForEvidence(clipboardMetadata);
    const classification = classifyClipboardFormats(clipboardMetadata);
    const clipboardInputIsPermitted =
      classification.reason === 'empty' ||
      (classification.reason === 'plain-text' &&
        allowPlainTextClipboardRestore);
    requireCheck(
      'clipboard-formats-are-safely-recoverable',
      classification.recoverable &&
        clipboardInputIsPermitted &&
        Number.isInteger(clipboardMetadata.sequence),
      {
        allowedPlainTextRestore: allowPlainTextClipboardRestore,
        classification: classification.reason,
        metadata: clipboardMetadataSummary,
        inputPermitted: clipboardInputIsPermitted,
      },
    );
    originalClipboardHadText = clipboardMetadata.hasText;
    originalClipboardText = originalClipboardHadText
      ? readBridgeClipboardText(clipboardMetadata.sequence)
      : '';
    if (originalClipboardText.includes('\0')) {
      throw new Error('The plain-text clipboard contains a NUL and cannot be restored safely.');
    }
    expectedClipboardSequence = clipboardMetadata.sequence;
    clipboardCaptured = true;
    evidence.clipboardProtection = {
      captured: true,
      initialMetadata: clipboardMetadataSummary,
      restored: false,
    };
  } catch (error) {
    evidence.clipboardProtection = {
      captured: false,
      captureError: 'clipboard-capture-failed',
      restored: false,
    };
    throw new Error(
      'Unable to back up the Windows clipboard; clipboard-changing acceptance checks were not started.',
      { cause: error },
    );
  }
  await verifyFileTreeContextMenus();
  await verifyEditorContextMenus(markdown);

  requireCheck('no-page-errors', evidence.pageErrors.length === 0, {
    pageErrors: evidence.pageErrors,
  });
  requireCheck('no-console-errors', evidence.consoleErrors.length === 0, {
    consoleErrors: evidence.consoleErrors,
  });
  requireCheck('no-page-crashes', evidence.pageCrashes.length === 0, {
    pageCrashes: evidence.pageCrashes,
  });
} catch (error) {
  failure = error;
  process.exitCode = 1;
  if (page && safeFixtureVisible && !clipboardPrivacyRisk) {
    await captureScreenshot('failure').catch(() => {});
  } else {
    if (clipboardPrivacyRisk) {
      evidence.failureScreenshotSkippedForClipboardPrivacy = true;
    }
    if (page && !safeFixtureVisible) {
      evidence.failureScreenshotSkippedUntilFixtureVerified = true;
    }
  }
} finally {
  inputInjectionPermitted = false;
  clipboardCleanupState = {
    ...clipboardCleanupState,
    inputStopped: true,
  };
  if (failure) {
    evidence.failure = {
      code: 'acceptance-failed',
      interrupted: Boolean(interruptionSignal),
      kind: failure instanceof Error ? 'error' : 'non-error',
    };
  }
  evidence.cleanupStages = [];

  await runCleanupStage('browser-disconnect', async () => {
    if (!browser) {
      if (cdpConnectionEstablished) {
        throw new Error(
          'The acceptance CDP browser handle was unavailable before disconnect was verified.',
        );
      }
      clipboardCleanupState = {
        ...clipboardCleanupState,
        cdpDisconnected: true,
      };
      return { skipped: true, disconnected: true };
    }
    await browser.close();
    if (browser.isConnected()) {
      throw new Error('The acceptance CDP browser remained connected after close.');
    }
    cdpConnectionEstablished = false;
    browser = undefined;
    page = undefined;
    clipboardCleanupState = {
      ...clipboardCleanupState,
      cdpDisconnected: true,
    };
    return { closed: true, disconnected: true };
  });

  await runCleanupStage('owned-child-process-exit', async () => {
    if (!app?.pid) return { skipped: true, childExitVerified: false };
    const baseline = activeChildBaseline;
    if (!baseline) {
      throw new Error('The immutable acceptance child baseline is unavailable.');
    }
    const before = invokeBridge({ action: 'process-info', timeout: 5_000 });
    if (!before.exists) {
      const termination = await waitForOwnedChildTermination();
      const after = invokeBridge({ action: 'process-info', timeout: 5_000 });
      const alreadyExited = assertAlreadyExitedAcceptanceChild({
        after,
        baseline,
        before,
        termination,
      });
      clipboardCleanupState = {
        ...clipboardCleanupState,
        childExitVerified: true,
      };
      evidence.childProcessExit = {
        after,
        before,
        termination,
        verified: true,
        ...alreadyExited,
      };
      evidence.checks.push({
        name: 'acceptance-owned-child-process-alive-before-cleanup',
        ok: false,
        detail: evidence.childProcessExit,
      });
      throw new Error('The acceptance-owned child exited before cleanup.');
    }
    verifyOwnedChildProcess(before, baseline, executablePath);
    const terminationAttempt = stopOwnedChild(app);
    if (terminationAttempt.accepted !== true) {
      throw new Error('Unable to terminate the verified acceptance-owned child process.');
    }
    const termination = await waitForOwnedChildTermination();
    const after = invokeBridge({ action: 'process-info', timeout: 5_000 });
    if (after.exists) {
      throw new Error('The acceptance-owned LumaMark process did not exit.');
    }
    clipboardCleanupState = {
      ...clipboardCleanupState,
      childExitVerified: true,
    };
    evidence.childProcessExit = {
      after,
      before,
      termination,
      terminationAttempt,
      verified: true,
    };
    evidence.checks.push({
      name: 'acceptance-owned-child-process-exited',
      ok: true,
      detail: evidence.childProcessExit,
    });
    return evidence.childProcessExit;
  });

  await runCleanupStage('clipboard-restore', async () => {
    if (!clipboardCaptured) return { skipped: true };
    try {
      assertClipboardCleanupReady(clipboardCleanupState);
    } catch {
      markClipboardPrivacyRisk('clipboard-writer-not-quiesced');
      throw new Error(
        'Clipboard restore was refused because the acceptance-owned writer was not proven quiescent.',
      );
    }
    if (pendingClipboardMutation) {
      const pendingMetadata = inspectBridgeClipboard();
      recordClipboardMetadataObservation(
        pendingClipboardMutation.name,
        'cleanup-after-writer-quiesced',
        pendingMetadata,
      );
      if (pendingMetadata.sequence === expectedClipboardSequence) {
        pendingClipboardMutation = undefined;
      } else {
        const pending = pendingClipboardMutation;
        try {
          assertOwnedClipboardMetadata({
            metadata: pendingMetadata,
            previousSequence: pending.previousSequence,
            writerKind: pending.writerKind,
          });
          const pendingText = readBridgeClipboardText(pendingMetadata.sequence);
          assertOwnedClipboardMutation({
            actualText: pendingText,
            compareAsPath: pending.compareAsPath,
            expectedText: pending.expectedText,
            metadata: pendingMetadata,
            previousSequence: pending.previousSequence,
            writerKind: pending.writerKind,
          });
        } catch {
          markClipboardPrivacyRisk('interrupted-clipboard-command-ownership-unproven');
          throw new Error(
            'Clipboard changed after a command was injected, but exact command ownership could not be proven; restore was refused.',
          );
        }
        expectedClipboardSequence = pendingMetadata.sequence;
        clipboardWasMutated = true;
        evidence.clipboardMutations ??= [];
        evidence.clipboardMutations.push({
          interruptedBeforeCommandVerification: true,
          name: pendingClipboardMutation.name,
          ...summarizeClipboardMetadataForEvidence(pendingMetadata),
        });
        pendingClipboardMutation = undefined;
      }
    }
    if (!clipboardWasMutated) {
      evidence.clipboardProtection = {
        ...evidence.clipboardProtection,
        restored: true,
        restoreSkippedBecauseUnchanged: true,
      };
      evidence.checks.push({
        name: 'system-clipboard-restored',
        ok: true,
        detail: { unchanged: true },
      });
      return { unchanged: true };
    }
    try {
      if (!Number.isInteger(expectedClipboardSequence)) {
        throw new Error('No owned clipboard sequence was recorded.');
      }
      const restoreResult = invokeBridge({
        action: 'clipboard-restore',
        expectedClipboardSequence,
        input: encodeClipboardTextForBridge(originalClipboardText),
        restoreHadText: originalClipboardHadText,
        timeout: 8_000,
      });
      const restoredMetadata = inspectBridgeClipboard();
      const restoredClassification = classifyClipboardFormats(restoredMetadata);
      const restoreMetadataIsSafeToRead =
        restoredMetadata.sequence === Number(restoreResult.resultingSequence) &&
        restoredMetadata.hasText === originalClipboardHadText &&
        restoredClassification.recoverable &&
        restoredClassification.reason ===
          (originalClipboardHadText ? 'plain-text' : 'empty');
      if (!restoreMetadataIsSafeToRead) {
        throw new Error(
          'Clipboard ownership changed before restoration could be verified.',
        );
      }
      const restoredText = restoredMetadata.hasText
        ? readBridgeClipboardText(restoredMetadata.sequence)
        : '';
      const restoredExactly = restoredText === originalClipboardText;
      evidence.clipboardProtection = {
        ...evidence.clipboardProtection,
        restored: restoredExactly,
        restoredMetadata: summarizeClipboardMetadataForEvidence(restoredMetadata),
        restoreObservedSequence: restoreResult.observedSequence,
        restoreResultingSequence: restoreResult.resultingSequence,
      };
      if (!restoredExactly) {
        throw new Error('Clipboard restore verification did not match the captured state.');
      }
      evidence.checks.push({
        name: 'system-clipboard-restored',
        ok: true,
        detail: {
          initialMetadata: evidence.clipboardProtection.initialMetadata,
          restoredMetadata: summarizeClipboardMetadataForEvidence(restoredMetadata),
          sequenceCompareAndSet: true,
        },
      });
      return { restored: true, sequenceCompareAndSet: true };
    } catch (error) {
      evidence.clipboardProtection = {
        ...evidence.clipboardProtection,
        restoreError: 'clipboard-restore-failed',
        restored: false,
      };
      evidence.checks.push({
        name: 'system-clipboard-restored',
        ok: false,
        detail: { error: evidence.clipboardProtection.restoreError },
      });
      throw error;
    }
  });

  await runCleanupStage('temporary-directory-remove', async () => {
    if (!tempDirectory) return { skipped: true };
    if (!isSafeAcceptanceTempDirectory(tempDirectory, tmpdir())) {
      throw new Error('Refusing to remove a directory outside the owned acceptance temp root.');
    }
    const processStillRunning = app?.pid
      ? invokeBridge({ action: 'process-info', timeout: 5_000 }).exists
      : false;
    if (processStillRunning) {
      throw new Error('Refusing temp cleanup while the acceptance child still exists.');
    }
    await removePackagedWebviewTempDirectory(tempDirectory);
    const removed = !(await pathExists(tempDirectory));
    evidence.temporaryDirectoryRemoved = removed;
    evidence.checks.push({
      name: 'temporary-directory-removed',
      ok: removed,
      detail: { ownedPrefix: true, removed },
    });
    if (!removed) throw new Error('The acceptance temporary directory still exists.');
    return { removed: true };
  });

  await runCleanupStage('write-process-logs-last', async () => {
    await Promise.all([
      writeFile(
        join(artifactDirectory, 'app-stdout.log'),
        evidence.processOutput.stdout.join(''),
        'utf8',
      ),
      writeFile(
        join(artifactDirectory, 'app-stderr.log'),
        evidence.processOutput.stderr.join(''),
        'utf8',
      ),
    ]);
    return { stderr: 'app-stderr.log', stdout: 'app-stdout.log' };
  });

  process.removeListener('SIGINT', handleSigint);
  process.removeListener('SIGTERM', handleSigterm);
  const failedChecks = evidence.checks.filter((check) => !check.ok).map((check) => check.name);
  const failedCleanupStages = evidence.cleanupStages
    .filter((stage) => !stage.ok)
    .map((stage) => stage.name);
  evidence.finishedAt = new Date().toISOString();
  evidence.summary = {
    checks: evidence.checks.length,
    failedCleanupStages,
    failedChecks,
    passed:
      !failure &&
      !interruptionSignal &&
      failedChecks.length === 0 &&
      failedCleanupStages.length === 0 &&
      evidence.pageErrors.length === 0 &&
      evidence.consoleErrors.length === 0 &&
      evidence.pageCrashes.length === 0 &&
      evidence.temporaryDirectoryRemoved === true,
  };
  evidence.plannedExitCode = evidence.summary.passed ? 0 : 1;
  process.exitCode = evidence.plannedExitCode;
  const resultPath = join(artifactDirectory, 'result.json');
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...evidence, resultPath }, null, 2)}\n`);
}

async function launchAcceptanceApplication(phase) {
  safeFixtureVisible = false;
  throwIfInterrupted(`launching the ${phase} application`);
  if (app?.pid) {
    throw new Error('Refusing to launch another acceptance process before the current one exits.');
  }
  const preferredDebugPort =
    evidence.debugPorts.length === 0 && process.env.LUMAMARK_WEBVIEW_DEBUG_PORT
      ? Number(process.env.LUMAMARK_WEBVIEW_DEBUG_PORT)
      : undefined;
  const debugPort = await reserveDebugPort(preferredDebugPort);
  evidence.debugPort = debugPort;
  evidence.debugPorts.push({ debugPort, phase });
  const webviewPhaseDirectory = join(tempDirectory, `webview-${phase}`);
  await mkdir(webviewPhaseDirectory, { recursive: true });
  const launchEnvironment = createPackagedWebviewEnvironment({
    baseEnvironment: {
      ...process.env,
      LUMAMARK_ACCEPTANCE_MODE: '1',
      LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR: settingsConfigDirectory,
      LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR:
        settingsWriteBarrierDirectory,
    },
    debugPort,
    tempDirectory: webviewPhaseDirectory,
  });
  const webviewProfile = launchEnvironment.WEBVIEW2_USER_DATA_FOLDER;
  const webviewProfileIsOwned = isInside(tempDirectory, webviewProfile);
  const webviewProfileIsFresh = evidence.webviewProfiles.every(
    (launch) => normalizedPath(launch.path) !== normalizedPath(webviewProfile),
  );
  const profileStartedAbsent = !(await pathExists(webviewProfile));
  const profileEvidence = { path: webviewProfile, phase, profileStartedAbsent };
  evidence.webviewProfiles.push(profileEvidence);
  requireCheck(
    `webview-profile-is-inside-owned-temp-${phase}`,
    webviewProfileIsOwned,
    { path: webviewProfile, phase },
  );
  requireCheck(
    `webview-profile-starts-absent-${phase}`,
    profileStartedAbsent,
    { phase, profileStartedAbsent },
  );
  if (phase === 'settings-restart') {
    requireCheck(
      'settings-restart-uses-fresh-webview-profile',
      webviewProfileIsFresh,
      { path: webviewProfile, phase },
    );
  }
  app = spawn(executablePath, [documentPath], {
    cwd: tempDirectory,
    env: launchEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  const launchedApp = app;
  const launchedProcessIdentity = { processId: launchedApp.pid };
  evidence.childProcess = launchedProcessIdentity;
  let terminationResolved = false;
  appTermination = new Promise((resolveTermination) => {
    const resolveOnce = (state) => {
      if (terminationResolved) return;
      terminationResolved = true;
      resolveTermination(state);
    };
    launchedApp.once('exit', (code, signal) =>
      resolveOnce({ code, kind: 'exit', signal }),
    );
    launchedApp.once('error', (error) =>
      resolveOnce({ error: error.message, kind: 'spawn-error' }),
    );
  });
  launchedApp.stdout?.on('data', (chunk) =>
    recordProcessOutput('stdout', phase, chunk),
  );
  launchedApp.stderr?.on('data', (chunk) =>
    recordProcessOutput('stderr', phase, chunk),
  );

  const childProcess = await Promise.race([
    pollUntil(
      () => invokeBridge({ action: 'process-info', timeout: 5_000 }),
      (processInfo) => processInfo.exists,
      `${phase} acceptance process identity`,
      { timeout: 5_000 },
    ),
    appTermination.then((termination) => {
      throw new Error(
        `LumaMark terminated before its ${phase} process identity was captured: ${JSON.stringify(termination)}`,
      );
    }),
  ]);
  verifyOwnedChildProcess(childProcess, launchedProcessIdentity, executablePath);
  activeChildBaseline = Object.freeze({
    executablePath: childProcess.executablePath,
    processId: childProcess.processId,
    startTimeUtc: childProcess.startTimeUtc,
  });
  evidence.childProcess = { ...activeChildBaseline };
  const launchExecutableSha256 = await sha256File(executablePath);
  evidence.processLaunches.push({
    debugPort,
    executableSha256: launchExecutableSha256,
    phase,
    ...childProcess,
  });
  requireCheck(
    `spawned-child-identity-matches-explicit-executable-${phase}`,
    launchExecutableSha256 === evidence.executableIdentity.executableSha256,
    {
      executablePath: childProcess.executablePath,
      executableSha256: launchExecutableSha256,
      phase,
      processId: childProcess.processId,
      startTimeUtc: childProcess.startTimeUtc,
    },
  );

  await Promise.race([
    waitForDebugEndpoint(debugPort),
    appTermination.then((termination) => {
      throw new Error(
        `LumaMark terminated before its ${phase} debug endpoint was ready: ${JSON.stringify(termination)}`,
      );
    }),
  ]);
  if (cdpConnectionEstablished) {
    throw new Error('A previous acceptance CDP connection is still active.');
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  cdpConnectionEstablished = true;
  const context = browser.contexts()[0];
  if (!context) throw new Error(`No WebView context was available for ${phase}.`);
  page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 5_000 }));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      evidence.consoleErrors.push({ phase, source: 'page-console' });
    }
  });
  page.on('pageerror', () =>
    evidence.pageErrors.push({ phase, source: 'page-error' }),
  );
  page.on('crash', () =>
    evidence.pageCrashes.push({ at: new Date().toISOString(), phase }),
  );
  const cdpSession = await context.newCDPSession(page);
  cdpSession.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error') {
      evidence.consoleErrors.push({
        phase,
        source: `cdp-${entry.source ?? 'unknown'}`,
      });
    }
  });
  await cdpSession.send('Log.enable');
  requireCheck(`startup-error-listeners-active-${phase}`, true, {
    bufferedCdpLog: true,
    console: true,
    crash: true,
    pageerror: true,
    phase,
    process: true,
  });

  await waitForTauriInvokeReady(phase);

  const runtimeProfileProof = await pollUntil(
    async () => {
      const markerPath = join(webviewProfile, 'EBWebView');
      if (!(await pathExists(webviewProfile)) || !(await pathExists(markerPath))) {
        return { markerDirectory: false, profileDirectory: false };
      }
      const [profileStats, markerStats] = await Promise.all([
        stat(webviewProfile),
        stat(markerPath),
      ]);
      return {
        markerDirectory: markerStats.isDirectory(),
        profileDirectory: profileStats.isDirectory(),
      };
    },
    (proof) => proof.profileDirectory && proof.markerDirectory,
    `${phase} WebView2 runtime profile to be created`,
    { timeout: APP_TIMEOUT },
  );
  Object.assign(profileEvidence, {
    runtimeCreated: true,
    runtimeMarker: 'EBWebView',
  });
  requireCheck(
    `webview-runtime-created-profile-${phase}`,
    profileStartedAbsent &&
      runtimeProfileProof.profileDirectory &&
      runtimeProfileProof.markerDirectory,
    { phase, profileStartedAbsent, runtimeProfileProof },
  );

  const resolvedSettingsConfigDirectory = await invokeTauriCommand(
    'settings_acceptance_config_dir',
  );
  const resolvedSettingsWriteBarrierDirectory = await invokeTauriCommand(
    'settings_acceptance_write_barrier_dir',
  );
  const launchConfigIsolation = {
    ipcVerified:
      normalizedPath(resolvedSettingsConfigDirectory) ===
        normalizedPath(settingsConfigDirectory) &&
      isInside(tempDirectory, resolvedSettingsConfigDirectory) &&
      normalizedPath(resolvedSettingsWriteBarrierDirectory) ===
        normalizedPath(settingsWriteBarrierDirectory) &&
      isInside(tempDirectory, resolvedSettingsWriteBarrierDirectory),
    phase,
    resolvedConfigDirectory: resolvedSettingsConfigDirectory,
    resolvedWriteBarrierDirectory: resolvedSettingsWriteBarrierDirectory,
  };
  evidence.configIsolation.launches ??= [];
  evidence.configIsolation.launches.push(launchConfigIsolation);
  evidence.configIsolation.resolvedConfigDirectory = resolvedSettingsConfigDirectory;
  evidence.configIsolation.resolvedWriteBarrierDirectory =
    resolvedSettingsWriteBarrierDirectory;
  evidence.configIsolation.ipcVerified = evidence.configIsolation.launches.every(
    (launch) => launch.ipcVerified,
  );
  requireCheck(
    `tauri-settings-config-resolves-to-temporary-override-${phase}`,
    launchConfigIsolation.ipcVerified,
    launchConfigIsolation,
  );

  await page.getByRole('banner').getByRole('heading', { name: /lumamark/i }).waitFor({
    state: 'visible',
    timeout: APP_TIMEOUT,
  });
  await page.locator('.cm-content').first().waitFor({
    state: 'visible',
    timeout: APP_TIMEOUT,
  });
  const loadedFixtureState = await pollUntil(
    readFixtureLoadState,
    (state) => state.markerMatches.every(Boolean),
    `${phase} temporary Markdown document to load`,
  );
  safeFixtureVisible = loadedFixtureState.markerMatches.every(Boolean);
  requireCheck(`safe-acceptance-fixture-visible-${phase}`, safeFixtureVisible, {
    markerCount: ACCEPTANCE_FIXTURE_MARKERS.length,
    phase,
  });
  await page.locator('.lm-md-link').waitFor({ state: 'visible', timeout: APP_TIMEOUT });
  await page.locator('.lm-image-preview').waitFor({
    state: 'visible',
    timeout: APP_TIMEOUT,
  });
  await pollUntil(
    () => page.locator('.tbl-table-widget').count(),
    (count) => count === ACCEPTANCE_TABLE_WIDGET_COUNT,
    `${phase} acceptance table widgets to render`,
    { timeout: APP_TIMEOUT },
  );

  const metrics = await readClientMetrics();
  evidence.clientMetrics.push({ phase: `${phase}-initial`, ...metrics });
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  requireCheck(
    `webview-dpr-matches-get-dpi-for-window-${phase}`,
    Math.abs(devicePixelRatio - Number(metrics.dpiScale)) <= 0.02,
    { devicePixelRatio, metrics, phase },
  );
  requireCheck(
    `interactive-input-desktop-is-default-${phase}`,
    metrics.inputDesktop?.name === 'Default' &&
      metrics.inputDesktop?.threadName === 'Default' &&
      metrics.inputDesktop?.matchesThread === true &&
      typeof metrics.foreground?.processName === 'string' &&
      metrics.foreground.processName.trim().length > 0,
    {
      foreground: metrics.foreground,
      inputDesktop: metrics.inputDesktop,
      phase,
    },
  );
  await dismissStartupDialogs();
}

async function verifySettingsPersistenceAcrossRestart() {
  const settingsFilePath = join(settingsConfigDirectory, 'settings.json');
  requireCheck(
    'isolated-settings-file-starts-absent',
    isInside(tempDirectory, settingsFilePath) && !(await pathExists(settingsFilePath)),
    { insideTemporaryDirectory: isInside(tempDirectory, settingsFilePath) },
  );

  let dialog = await openSettingsDialog('settings-persistence.first-launch');
  const autoCheck = dialog.getByRole('switch', { name: LABELS.autoCheckUpdates });
  requireCheck('settings-auto-check-default-is-enabled', await autoCheck.isChecked(), {
    checked: await autoCheck.isChecked(),
  });
  await osPointer(autoCheck, 'settings-persistence.first-launch.auto-check');
  await pollUntil(
    () => autoCheck.isChecked(),
    (checked) => checked === false,
    'the auto-check setting to become disabled',
  );

  await captureScreenshot('settings-persistence-first-launch');

  const dialogClose = dialog.getByRole('button', { name: LABELS.close });
  await osPointer(dialogClose, 'settings-persistence.first-launch.close-dialog');
  await pollUntil(
    () => dialog.isVisible().catch(() => false),
    (visible) => !visible,
    'the settings dialog to close and flush pending writes',
  );

  const persisted = await readPersistedSettingsFile(
    (settings) =>
      settings.version === 2 &&
      settings.appearance?.theme === 'light' &&
      settings.updates?.autoCheckOnStartup === false,
    'the v2 baseline to flush before the top-menu theme change',
  );
  evidence.settingsPersistence = {
    firstLaunch: {
      autoCheckOnStartup: persisted.updates.autoCheckOnStartup,
      theme: persisted.appearance.theme,
      version: persisted.version,
    },
    settingsFilePath,
    settingsFileInsideTemporaryDirectory: isInside(tempDirectory, settingsFilePath),
  };
  requireCheck(
    'settings-v2-written-inside-isolated-config',
    evidence.settingsPersistence.settingsFileInsideTemporaryDirectory &&
      persisted.version === 2 &&
      persisted.appearance.theme === 'light' &&
      persisted.updates.autoCheckOnStartup === false,
    evidence.settingsPersistence,
  );
  requireCheck(
    'settings-pre-close-baseline-is-light',
    persisted.appearance.theme === 'light',
    evidence.settingsPersistence,
  );

  await createSettingsWriteBarrierMarker('arm');
  const themeMenu = await openTopMenu(LABELS.theme, 'settings-persistence.theme-menu');
  await recordMenuLayout(themeMenu, 'settings-persistence-theme-menu');
  const systemTheme = await findVisibleRole('menuitemradio', LABELS.themeSystem);
  await osPointer(
    systemTheme,
    'settings-persistence.theme-menu.system-theme',
  );
  const enteredMarker = await waitForSettingsWriteBarrierMarker('entered');
  const blockedBeforeClose = await readPersistedSettingsSnapshot();
  requireCheck(
    'settings-write-barrier-entered-before-close',
    enteredMarker.isFile === true &&
      blockedBeforeClose.appearance?.theme === 'light',
    {
      marker: enteredMarker.marker,
      persistedTheme: blockedBeforeClose.appearance?.theme,
    },
  );
  const closeResult = await closeCurrentApplicationNormally(
    'settings-theme-menu-immediate-close', {
      afterClosePointer: async ({ baseline }) => {
        const closeEnteredMarker =
          await waitForSettingsWriteBarrierMarker('close-entered');
        requireCheck(
          'settings-close-coordinator-entered-write-barrier',
          closeEnteredMarker.isFile === true,
          { marker: closeEnteredMarker.marker },
        );
        const blockedWindowMetrics = await readClientMetrics();
        requireCheck(
          'settings-main-window-remains-open-while-close-awaits-settings',
          Number(blockedWindowMetrics.hWnd) > 0 &&
            Number(blockedWindowMetrics.clientSize?.width) > 0 &&
            Number(blockedWindowMetrics.clientSize?.height) > 0,
          {
            clientSize: blockedWindowMetrics.clientSize,
            hWnd: blockedWindowMetrics.hWnd,
          },
        );
        const whileBlocked = invokeBridge({
          action: 'process-info',
          timeout: 5_000,
        });
        verifyOwnedChildProcess(whileBlocked, baseline, executablePath);
        requireCheck(
          'settings-process-alive-while-write-is-blocked',
          whileBlocked.exists === true,
          {
            processId: whileBlocked.processId,
            startTimeUtc: whileBlocked.startTimeUtc,
          },
        );
        const blockedAfterClose = await readPersistedSettingsSnapshot();
        requireCheck(
          'settings-remains-light-while-close-is-blocked',
          blockedAfterClose.appearance?.theme === 'light',
          { persistedTheme: blockedAfterClose.appearance?.theme },
        );
        const releaseMarker = await createSettingsWriteBarrierMarker('release');
        return {
          persistedThemeBeforeRelease: blockedAfterClose.appearance?.theme,
          processIdBeforeRelease: whileBlocked.processId,
          mainWindowHandleBeforeRelease: blockedWindowMetrics.hWnd,
          closeEnteredMarker: closeEnteredMarker.marker,
          releaseMarker: releaseMarker.marker,
        };
      },
    },
  );
  const persistedAfterClose = await readPersistedSettingsFile(
    (settings) =>
      settings.version === 2 &&
      settings.appearance?.theme === 'system' &&
      settings.updates?.autoCheckOnStartup === false,
    'the released theme save to complete before restart',
  );
  const remainingBarrierMarkers = (
    await Promise.all(
      [...SETTINGS_WRITE_BARRIER_MARKERS].map(async (marker) => ({
        exists: await pathExists(settingsWriteBarrierMarkerPath(marker)),
        marker,
      })),
    )
  ).filter((marker) => marker.exists);
  requireCheck(
    'settings-write-barrier-markers-consumed',
    remainingBarrierMarkers.length === 0,
    { remainingMarkers: remainingBarrierMarkers.map((marker) => marker.marker) },
  );
  evidence.settingsPersistence.immediateClose = {
    barrier: closeResult.afterClosePointerEvidence,
    persistedThemeAfterClose: persistedAfterClose.appearance.theme,
    requestedTheme: 'system',
  };
  await launchAcceptanceApplication('settings-restart');

  dialog = await openSettingsDialog('settings-persistence.restart');
  const restoredAutoCheck = dialog.getByRole('switch', {
    name: LABELS.autoCheckUpdates,
  });
  const restoredAutoCheckValue = await pollUntil(
    () => restoredAutoCheck.isChecked(),
    (checked) => checked === false,
    'the restarted settings UI to restore disabled update checks',
  );
  const restoredAppearanceTab = dialog.getByRole('tab', {
    name: LABELS.appearance,
  });
  await osPointer(
    restoredAppearanceTab,
    'settings-persistence.restart.appearance-tab',
  );
  await pollUntil(
    () => restoredAppearanceTab.getAttribute('aria-selected'),
    (selected) => selected === 'true',
    'the restarted appearance tab to become selected',
  );
  const restoredSystemTheme = await findVisibleRole('radio', LABELS.themeSystem);
  const restoredThemeAriaChecked = await pollUntil(
    () => restoredSystemTheme.getAttribute('aria-checked'),
    (checked) => checked === 'true',
    'the restarted settings UI to restore the system theme',
  );
  const restoredThemeChecked = restoredThemeAriaChecked === 'true';
  const persistedAfterRestart = await readPersistedSettingsFile(
    (settings) =>
      settings.version === 2 &&
      settings.appearance?.theme === 'system' &&
      settings.updates?.autoCheckOnStartup === false,
    'the same isolated v2 settings file after restart',
  );
  evidence.settingsPersistence.restart = {
    autoCheckOnStartup: restoredAutoCheckValue,
    persistedAutoCheckOnStartup:
      persistedAfterRestart.updates.autoCheckOnStartup,
    persistedTheme: persistedAfterRestart.appearance.theme,
    persistedVersion: persistedAfterRestart.version,
    themeChecked: restoredThemeChecked,
  };
  requireCheck(
    'settings-immediate-close-flushed-theme-menu-change',
    persistedAfterRestart.appearance.theme === 'system' &&
      evidence.settingsPersistence.immediateClose.requestedTheme === 'system',
    evidence.settingsPersistence,
  );
  requireCheck(
    'settings-persistence-restart-restored-ui',
    restoredAutoCheckValue === false &&
      restoredThemeChecked === true &&
      persistedAfterRestart.version === 2,
    evidence.settingsPersistence,
  );
  await captureScreenshot('settings-persistence-restart-restored');

  const restartedDialogClose = dialog.getByRole('button', { name: LABELS.close });
  await osPointer(
    restartedDialogClose,
    'settings-persistence.restart.close-dialog',
  );
  await pollUntil(
    () => dialog.isVisible().catch(() => false),
    (visible) => !visible,
    'the restarted settings dialog to close',
  );
}

async function openSettingsDialog(evidenceName) {
  const fileMenu = await openTopMenu(LABELS.file, `${evidenceName}.file-menu`);
  await recordMenuLayout(fileMenu, `${evidenceName}-file-menu`);
  const settingsItem = await findVisibleRole('menuitem', LABELS.settings);
  await osPointer(settingsItem, `${evidenceName}.settings-item`);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: POINTER_TIMEOUT });
  return dialog;
}

async function readPersistedSettingsFile(predicate, description) {
  const settingsFilePath = join(settingsConfigDirectory, 'settings.json');
  if (!isInside(tempDirectory, settingsFilePath)) {
    throw new Error('Refusing to read settings outside the owned acceptance temp root.');
  }
  return pollUntil(
    async () => JSON.parse(await readFile(settingsFilePath, 'utf8')),
    predicate,
    description,
    { timeout: APP_TIMEOUT },
  );
}

async function readPersistedSettingsSnapshot() {
  const settingsFilePath = join(settingsConfigDirectory, 'settings.json');
  if (!isInside(tempDirectory, settingsFilePath)) {
    throw new Error('Refusing to read settings outside the owned acceptance temp root.');
  }
  return JSON.parse(await readFile(settingsFilePath, 'utf8'));
}

function settingsWriteBarrierMarkerPath(marker) {
  if (!SETTINGS_WRITE_BARRIER_MARKERS.has(marker)) {
    throw new Error('Unknown acceptance settings write-barrier marker.');
  }
  const markerPath = join(settingsWriteBarrierDirectory, marker);
  if (
    !isInside(tempDirectory, markerPath) ||
    !isInside(settingsWriteBarrierDirectory, markerPath)
  ) {
    throw new Error('Refusing a settings write-barrier marker outside owned temp.');
  }
  return markerPath;
}

async function createSettingsWriteBarrierMarker(marker) {
  const markerPath = settingsWriteBarrierMarkerPath(marker);
  if (await pathExists(markerPath)) {
    throw new Error('Refusing to replace an existing settings write-barrier marker.');
  }
  await writeFile(markerPath, `${marker}\n`, { encoding: 'utf8', flag: 'wx' });
  if (marker === 'release') {
    // Rust may consume the create-new release marker immediately. Successful
    // creation is the hand-off; a post-write lstat would race that consumption.
    return { isFile: true, marker };
  }
  const markerStats = await lstat(markerPath);
  if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
    throw new Error('The settings write-barrier marker is not a regular file.');
  }
  return { isFile: true, marker };
}

async function waitForSettingsWriteBarrierMarker(marker) {
  const markerPath = settingsWriteBarrierMarkerPath(marker);
  return pollUntil(
    async () => {
      if (!(await pathExists(markerPath))) {
        return { isFile: false, marker };
      }
      const markerStats = await lstat(markerPath);
      return {
        isFile: markerStats.isFile() && !markerStats.isSymbolicLink(),
        marker,
      };
    },
    (state) => state.isFile,
    `the Rust settings write barrier to create ${marker}`,
    { timeout: APP_TIMEOUT },
  );
}

async function closeCurrentApplicationNormally(
  phase,
  { afterClosePointer } = {},
) {
  if (!app?.pid || !appTermination || !browser || !page) {
    throw new Error(`Cannot close the ${phase} process before it is fully attached.`);
  }
  const closingApp = app;
  const closingBrowser = browser;
  const closingTermination = appTermination;
  const baseline = activeChildBaseline;
  if (!baseline) {
    throw new Error(`Cannot close the ${phase} process without its immutable identity.`);
  }
  const before = invokeBridge({ action: 'process-info', timeout: 5_000 });
  verifyOwnedChildProcess(before, baseline, executablePath);

  const closeButton = page
    .getByRole('banner')
    .getByRole('button', { name: LABELS.windowClose });
  await osPointer(closeButton, `${phase}.close-window`, {
    allowTargetExit: true,
  });
  const afterClosePointerEvidence = afterClosePointer
    ? await afterClosePointer({ baseline, before })
    : undefined;
  const termination = await Promise.race([
    closingTermination,
    delay(APP_TIMEOUT).then(() => {
      throw new Error(`Timed out waiting for the ${phase} process to exit normally.`);
    }),
  ]);
  requireCheck(
    `${phase}-normal-exit`,
    termination.kind === 'exit' && termination.code === 0,
    { baseline, termination },
  );
  const after = invokeBridge({ action: 'process-info', timeout: 5_000 });
  requireCheck(`${phase}-process-exited`, after.exists === false, { after, before });
  await closingBrowser.close();
  if (closingBrowser.isConnected()) {
    throw new Error(`The ${phase} CDP browser remained connected after close.`);
  }
  cdpConnectionEstablished = false;
  evidence.normalExits ??= [];
  evidence.normalExits.push({ after, before, phase, termination });

  if (app === closingApp) app = undefined;
  if (browser === closingBrowser) browser = undefined;
  page = undefined;
  appTermination = undefined;
  activeChildBaseline = undefined;
  evidence.childProcess = null;
  return { afterClosePointerEvidence, termination };
}

async function verifyTopChromeAndDragging() {
  const originBeforeMenu = await readClientMetrics();
  const fileMenu = await openTopMenu(LABELS.file, 'top.file');
  await recordMenuLayout(fileMenu, 'top-file');

  const settingsItem = await findVisibleRole('menuitem', LABELS.settings);
  await osPointer(settingsItem, 'top.file.settings');
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: POINTER_TIMEOUT });
  await captureScreenshot('top-settings-open');
  const originAfterPortal = await readClientMetrics();
  requireCheck(
    'top-menu-trigger-and-portal-do-not-drag',
    originsEqual(originBeforeMenu.clientOrigin, originAfterPortal.clientOrigin, 2),
    { before: originBeforeMenu, after: originAfterPortal },
  );

  const closeButton = await findVisibleRole('button', LABELS.close);
  await osPointer(closeButton, 'settings.close-button');
  await pollUntil(
    async () => page.getByRole('dialog').isVisible().catch(() => false),
    (visible) => !visible,
    'settings dialog to close after the OS button click',
  );

  const maximizeButton = await findVisibleRole('button', LABELS.maximizeOrRestore);
  let label = await maximizeButton.getAttribute('aria-label');
  if (/Restore|还原/i.test(label ?? '')) {
    await osPointer(maximizeButton, 'window.restore-before-button-check');
    label = await pollUntil(
      () => maximizeButton.getAttribute('aria-label'),
      (value) => /Maximize|最大化/i.test(value ?? ''),
      'window to restore before checking its control button',
    );
  }

  const normalMetrics = await readClientMetrics();
  await osPointer(maximizeButton, 'window.maximize-button');
  const maximizedLabel = await pollUntil(
    () => maximizeButton.getAttribute('aria-label'),
    (value) => /Restore|还原/i.test(value ?? ''),
    'maximize button to become restore',
  );
  await osPointer(maximizeButton, 'window.restore-button');
  const restoredLabel = await pollUntil(
    () => maximizeButton.getAttribute('aria-label'),
    (value) => /Maximize|最大化/i.test(value ?? ''),
    'restore button to become maximize',
  );
  const restoredMetrics = await readClientMetrics();
  requireCheck('window-control-button-remains-interactive', true, {
    initialLabel: label,
    maximizedLabel,
    restoredLabel,
    normalMetrics,
    restoredMetrics,
  });

  const dragStrip = page.locator('.lm-titlebar-drag');
  const dragBefore = await readClientMetrics();
  await osPointer(dragStrip, 'titlebar.blank-drag-strip', {
    deltaCss: { x: 72, y: 36 },
    gesture: 'drag',
  });
  const dragAfter = await pollUntil(
    readClientMetrics,
    (metrics) => !originsEqual(dragBefore.clientOrigin, metrics.clientOrigin, 8),
    'blank titlebar strip to move the installed window',
  );
  requireCheck('blank-titlebar-drag-region-moves-window', true, {
    before: dragBefore,
    after: dragAfter,
  });
  evidence.clientMetrics.push({ phase: 'after-titlebar-drag', ...dragAfter });
}

async function dismissStartupDialogs() {
  const observationDeadline = Date.now() + 8_000;
  let dismissed = 0;
  while (Date.now() < observationDeadline) {
    const dialogs = page.getByRole('dialog');
    let visibleDialog = null;
    const count = await dialogs.count();
    for (let index = 0; index < count; index += 1) {
      if (await dialogs.nth(index).isVisible()) {
        visibleDialog = dialogs.nth(index);
        break;
      }
    }

    if (!visibleDialog) {
      await delay(125);
      continue;
    }

    const before = await readTarget(visibleDialog);
    const dismissButton = await findVisibleRole(
      'button',
      /^(?:Close|关闭|Later|稍后|Not now|暂不)$/,
    );
    await osPointer(dismissButton, `startup-dialog-${dismissed + 1}.dismiss`);
    await pollUntil(
      () => visibleDialog.isVisible().catch(() => false),
      (visible) => !visible,
      'startup dialog to close after an OS pointer command',
    );
    evidence.startupDialogs.push({
      dismissedByOsPointer: true,
      target: before.identity,
    });
    dismissed += 1;
  }

  requireCheck('startup-blocking-dialogs-dismissed-by-os-pointer', true, {
    dismissed,
  });
}

async function openTemporaryWorkspace() {
  const fileMenu = await openTopMenu(LABELS.file, 'top.file.open-workspace');
  await recordMenuLayout(fileMenu, 'top-file-open-workspace');
  const openWorkspaceItem = await findVisibleRole('menuitem', LABELS.openWorkspace);
  await osPointer(openWorkspaceItem, 'top.file.open-workspace.item');

  await page.getByTestId('file-tree-workspace-root').waitFor({
    state: 'visible',
    timeout: APP_TIMEOUT,
  });
  await page.locator('.lm-file-tree-node-file').filter({ hasText: 'file-target.md' }).waitFor({
    state: 'visible',
    timeout: APP_TIMEOUT,
  });
  requireCheck('workspace-bridge-opened-temporary-workspace', true, {
    workspaceRoot,
    workspaceBridge: evidence.workspaceBridge,
  });
  await page.evaluate(() => {
    delete window.__LUMAMARK_E2E_WORKSPACE__;
  });
  evidence.workspaceBridge.removedAfterSetup = true;
  await captureScreenshot('workspace-open');
}

async function activateWorkspaceAcceptanceBridge() {
  evidence.workspaceBridge = await page.evaluate((temporaryWorkspacePath) => {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals?.invoke) {
      throw new Error('Tauri invoke is unavailable for workspace acceptance setup.');
    }
    const invoke = internals.invoke.bind(internals);
    const result = async (command, args) => {
      try {
        return { data: await invoke(command, args), ok: true };
      } catch (error) {
        const candidate = error && typeof error === 'object' ? error : {};
        return {
          error: {
            code: typeof candidate.code === 'string' ? candidate.code : 'command.failed',
            message:
              typeof candidate.message === 'string'
                ? candidate.message
                : 'Acceptance workspace command failed.',
            recoverable:
              typeof candidate.recoverable === 'boolean'
                ? candidate.recoverable
                : true,
          },
          ok: false,
        };
      }
    };
    window.__LUMAMARK_E2E_WORKSPACE__ = {
      createDirectory: (input) =>
        result('workspace_create_directory', {
          name: input.name,
          parentPath: input.parentPath,
          workspaceRoot: input.workspaceRoot,
        }),
      createFile: (input) =>
        result('workspace_create_file', {
          name: input.name,
          parentPath: input.parentPath,
          workspaceRoot: input.workspaceRoot,
        }),
      deleteEntry: (input) =>
        result('workspace_delete_entry', {
          path: input.path,
          workspaceRoot: input.workspaceRoot,
        }),
      listChildren: (path) => result('workspace_list_children', { path }),
      openDirectory: () =>
        result('workspace_open_path', { path: temporaryWorkspacePath }),
      openPath: (path) => result('workspace_open_path', { path }),
      renameEntry: (input) =>
        result('workspace_rename_entry', {
          newName: input.newName,
          path: input.path,
          workspaceRoot: input.workspaceRoot,
        }),
    };
    return {
      activated: true,
      backing: 'Tauri workspace commands',
      nativeDialogBypassedForHostIsolation: true,
    };
  }, workspaceRoot);

  requireCheck(
    'temporary-workspace-bridge-activated',
    evidence.workspaceBridge?.activated === true,
    evidence.workspaceBridge,
  );
}

async function verifyFileTreeContextMenus() {
  const scenarios = [
    {
      expectedItems: [LABELS.newFile, LABELS.newFolder, LABELS.copyPath],
      expectedPath: workspaceRoot,
      name: 'file-tree-root',
      target: page.getByTestId('file-tree-workspace-root'),
    },
    {
      expectedItems: [LABELS.rename, LABELS.newFile, LABELS.newFolder, LABELS.copyPath],
      expectedPath: join(workspaceRoot, 'FolderTarget'),
      name: 'file-tree-directory',
      target: page.locator('.lm-file-tree-node-directory').filter({ hasText: 'FolderTarget' }),
    },
    {
      expectedItems: [LABELS.rename, LABELS.copyPath],
      expectedPath: join(workspaceRoot, 'file-target.md'),
      name: 'file-tree-file',
      target: page.locator('.lm-file-tree-node-file').filter({ hasText: 'file-target.md' }),
    },
  ];

  for (const scenario of scenarios) {
    const menu = await openContextMenu(scenario.target, scenario.name);
    const layout = await recordMenuLayout(menu, scenario.name);
    for (const expectedItem of scenario.expectedItems) {
      requireCheck(
        `${scenario.name}-contains-${String(expectedItem)}`,
        layout.items.some((item) => expectedItem.test(item.text)),
        { items: layout.items.map((item) => item.text) },
      );
    }
    await captureScreenshot(`${scenario.name}-context`);
    const copyPathItem = await findVisibleRole('menuitem', LABELS.copyPath);
    beginClipboardMutation(`${scenario.name}.copy-path`, scenario.expectedPath, {
      compareAsPath: true,
    });
    await osPointer(copyPathItem, `${scenario.name}.copy-path`);
    const copiedPath = await trackOwnedClipboardMutation(`${scenario.name}.copy-path`);
    requireCheck(`${scenario.name}-copy-path-executed`, true, {
      copiedPath,
      expectedPath: scenario.expectedPath,
    });
  }
}

async function verifyEditorContextMenus(originalMarkdown) {
  const plainLine = page.locator('.cm-line').filter({ hasText: PLAIN_MARKER }).first();
  const link = page.locator('.lm-md-link').filter({ hasText: 'LINK_ACCEPTANCE_LABEL' }).first();
  const image = page.locator('.lm-image-preview').first();
  const tableWidgets = page.locator('.tbl-table-widget');
  const tableCell = page.locator('.tbl-data-cell').filter({ hasText: TABLE_MARKER }).first();

  await osPointer(plainLine, 'editor.plain.focus');
  let menu = await openContextMenu(plainLine, 'editor-plain');
  await recordMenuLayout(menu, 'editor-plain');
  await captureScreenshot('editor-plain-context');
  const selectAllItem = await findVisibleRole('menuitem', LABELS.selectAll);
  await osPointer(selectAllItem, 'editor.plain.select-all');
  const selectedAll = await pollUntil(
    readRootEditorState,
    (state) => state.selection.from === 0 && state.selection.to === state.doc.length,
    'Select All to select the complete CodeMirror document',
  );
  requireCheck('editor-select-all-executed', true, selectedAll.selection);

  menu = await openContextMenu(plainLine, 'editor-selection');
  await recordMenuLayout(menu, 'editor-selection');
  const selectionAtCopy = await readRootEditorState();
  const selectionStillCoversFixture =
    selectionAtCopy.selection.from === 0 &&
    selectionAtCopy.selection.to === selectionAtCopy.doc.length;
  const selectedDocumentMatchesFixture = selectionAtCopy.doc === originalMarkdown;
  requireCheck(
    'editor-context-menu-preserves-complete-selection',
    selectionStillCoversFixture && selectedDocumentMatchesFixture,
    {
      documentLength: selectionAtCopy.doc.length,
      documentMatchesFixture: selectedDocumentMatchesFixture,
      expectedLength: originalMarkdown.length,
      selection: selectionAtCopy.selection,
      selectionStillCoversFixture,
    },
  );
  const copyItem = await findVisibleRole('menuitem', LABELS.copy);
  beginClipboardMutation('editor.selection.copy', selectionAtCopy.doc);
  await osPointer(copyItem, 'editor.selection.copy');
  const copiedDocument = await trackOwnedClipboardMutation('editor.selection.copy');
  requireCheck('editor-copy-executed', true, {
    containsPlainMarker: copiedDocument.includes(PLAIN_MARKER),
    containsTableMarker: copiedDocument.includes(TABLE_MARKER),
    containsSecondTableMarker: copiedDocument.includes(SECOND_TABLE_MARKER),
    containsAfterMarker: copiedDocument.includes(AFTER_MARKER),
  });

  menu = await openContextMenu(plainLine, 'editor-selection-cut');
  await recordMenuLayout(menu, 'editor-selection-cut');
  const cutItem = await findVisibleRole('menuitem', LABELS.cut);
  beginClipboardMutation('editor.selection.cut', originalMarkdown);
  await osPointer(cutItem, 'editor.selection.cut');
  await pollUntil(
    readRootEditorState,
    (state) => state.doc.length === 0,
    'Cut to remove the selected document',
  );
  const cutDocument = await trackOwnedClipboardMutation('editor.selection.cut');
  const cutClipboardMatchesCompleteSelection = clipboardTextMatches(
    cutDocument,
    originalMarkdown,
  );
  requireCheck('editor-cut-executed', cutClipboardMatchesCompleteSelection, {
    clipboardStillContainsCompleteSelection:
      cutClipboardMatchesCompleteSelection,
    documentWasEmpty: true,
  });

  menu = await openContextMenu(page.locator('.cm-content').first(), 'editor-empty-paste');
  await recordMenuLayout(menu, 'editor-empty-paste');
  const pasteItem = await findVisibleRole('menuitem', LABELS.paste);
  const pasteClipboardPreflight = inspectBridgeClipboard();
  const pastePreflightSequence = assertCurrentCommandOwnedClipboardMetadata({
    expectedSequence: expectedClipboardSequence,
    metadata: pasteClipboardPreflight,
    writerKind: INSTALLED_TEXT_WRITER_KIND,
  });
  requireCheck(
    'editor-paste-clipboard-preflight-is-command-owned',
    pastePreflightSequence === expectedClipboardSequence,
    {
      formats: pasteClipboardPreflight.formats,
      hasText: pasteClipboardPreflight.hasText,
      ownerBelongsToTarget: pasteClipboardPreflight.ownerBelongsToTarget,
      sequenceMatches: pasteClipboardPreflight.sequence === expectedClipboardSequence,
    },
  );
  await osPointer(pasteItem, 'editor.empty.paste', {
    clipboardSequenceGuard: expectedClipboardSequence,
  });
  const pasted = await waitForPasteFixture(originalMarkdown);
  requireCheck('editor-paste-executed', pasted.matchesExpected, {
    documentLength: pasted.documentLength,
    expectedLength: originalMarkdown.length,
    restoredExactFixture: pasted.matchesExpected,
  });

  await osPointer(plainLine, 'editor.plain.collapse-selection');
  menu = await openContextMenu(link, 'editor-link');
  await recordMenuLayout(menu, 'editor-link');
  await captureScreenshot('editor-link-context');
  const copyLinkItem = await findVisibleRole('menuitem', LABELS.copyLinkAddress);
  beginClipboardMutation('editor.link.copy-address', LINK_DESTINATION);
  await osPointer(copyLinkItem, 'editor.link.copy-address');
  const copiedLink = await trackOwnedClipboardMutation('editor.link.copy-address');
  requireCheck('editor-link-copy-executed', copiedLink === LINK_DESTINATION, {
    copiedLink,
  });

  menu = await openContextMenu(image, 'editor-image');
  const imageLayout = await recordMenuLayout(menu, 'editor-image');
  await captureScreenshot('editor-image-context');
  const imageActionPresence = {
    copyImagePath: imageLayout.items.some((item) => LABELS.copyImagePath.test(item.text)),
    deleteImageReference: imageLayout.items.some((item) =>
      LABELS.deleteImageReference.test(item.text),
    ),
    revealImage: imageLayout.items.some((item) => LABELS.revealImage.test(item.text)),
  };
  requireCheck('editor-image-context-contains-image-actions',
    Object.values(imageActionPresence).every(Boolean), {
      actions: imageActionPresence,
      items: imageLayout.items.map(({ role, text }) => ({ role, text })),
    });
  const copyImageItem = await findVisibleRole('menuitem', LABELS.copyImagePath);
  beginClipboardMutation(
    'editor.image.copy-path',
    join(workspaceRoot, 'acceptance.svg'),
    { compareAsPath: true },
  );
  await osPointer(copyImageItem, 'editor.image.copy-path');
  const copiedImagePath = await trackOwnedClipboardMutation('editor.image.copy-path');
  requireCheck('editor-image-copy-executed', true, {
    copiedImagePath,
  });

  await osPointer(plainLine, 'editor.plain.before-table-copy');
  const beforeTableCopy = await readRootEditorState();
  const tableFrom = beforeTableCopy.doc.indexOf(TABLE_SOURCE);
  const tableTo = tableFrom + TABLE_SOURCE.length;
  requireCheck(
    'table-copy-target-range-resolves-exact-fixture',
    tableFrom >= 0 &&
      tableTo <= beforeTableCopy.doc.length &&
      beforeTableCopy.doc.slice(tableFrom, tableTo) === TABLE_SOURCE &&
      beforeTableCopy.doc.slice(tableFrom, tableTo).includes(TABLE_MARKER),
    {
      documentLength: beforeTableCopy.doc.length,
      marker: TABLE_MARKER,
      tableRange: { from: tableFrom, to: tableTo },
    },
  );
  requireCheck(
    'table-copy-starts-with-selection-outside-target',
    beforeTableCopy.selection.head < tableFrom || beforeTableCopy.selection.head > tableTo,
    { selection: beforeTableCopy.selection, tableRange: { from: tableFrom, to: tableTo } },
  );

  menu = await openContextMenu(tableCell, 'editor-table-copy');
  await recordMenuLayout(menu, 'editor-table-copy');
  await captureScreenshot('editor-table-copy-context');
  const copyTableItem = await findVisibleRole('menuitem', LABELS.copyTable);
  beginClipboardMutation('editor.table.copy-target-range', TABLE_SOURCE);
  await osPointer(copyTableItem, 'editor.table.copy-target-range');
  const copiedTable = await trackOwnedClipboardMutation('editor.table.copy-target-range');
  requireCheck('editor-table-copy-target-range-executed', true, {
    copiedExactFirstTable: copiedTable === TABLE_SOURCE,
    excludedSecondTable: !copiedTable.includes(SECOND_TABLE_MARKER),
    selectionBefore: beforeTableCopy.selection,
    tableRange: { from: tableFrom, to: tableTo },
  });

  await osPointer(plainLine, 'editor.plain.before-table-delete');
  const beforeTableDelete = await readRootEditorState();
  const deleteTableFrom = beforeTableDelete.doc.indexOf(TABLE_SOURCE);
  const deleteTableTo = deleteTableFrom + TABLE_SOURCE.length;
  const expectedAfterTableDelete =
    beforeTableDelete.doc.slice(0, deleteTableFrom) +
    beforeTableDelete.doc.slice(deleteTableTo);
  requireCheck(
    'table-delete-target-range-resolves-exact-fixture',
    deleteTableFrom >= 0 &&
      deleteTableTo <= beforeTableDelete.doc.length &&
      beforeTableDelete.doc.slice(deleteTableFrom, deleteTableTo) === TABLE_SOURCE,
    {
      documentLength: beforeTableDelete.doc.length,
      tableRange: { from: deleteTableFrom, to: deleteTableTo },
    },
  );
  requireCheck(
    'table-delete-starts-with-selection-outside-target',
    beforeTableDelete.selection.to <= deleteTableFrom ||
      beforeTableDelete.selection.from >= deleteTableTo,
    {
      selection: beforeTableDelete.selection,
      tableRange: { from: deleteTableFrom, to: deleteTableTo },
    },
  );
  const beforeTableWidgetCount = await tableWidgets.count();
  requireCheck('table-delete-starts-with-two-widgets', beforeTableWidgetCount === 2, {
    beforeTableWidgetCount,
  });
  menu = await openContextMenu(tableCell, 'editor-table-delete');
  await recordMenuLayout(menu, 'editor-table-delete');
  await captureScreenshot('editor-table-delete-context');
  const deleteTableItem = await findVisibleRole('menuitem', LABELS.deleteTable);
  await osPointer(deleteTableItem, 'editor.table.delete-target-range');
  const afterTableDelete = await pollUntil(
    async () => ({
      ...(await readRootEditorState()),
      tableWidgetCount: await tableWidgets.count(),
    }),
    (state) =>
      state.doc === expectedAfterTableDelete &&
      state.tableWidgetCount === 1,
    'Delete Table to remove only the right-clicked table',
  );
  const afterTableWidgetCount = afterTableDelete.tableWidgetCount;
  const diskText = await readFile(documentPath, 'utf8');
  requireCheck(
    'editor-table-delete-target-range-executed',
    afterTableDelete.doc === expectedAfterTableDelete &&
      beforeTableWidgetCount === 2 && afterTableWidgetCount === 1,
    {
    beforeSelection: beforeTableDelete.selection,
    afterSelection: afterTableDelete.selection,
    beforeTableWidgetCount,
    afterTableWidgetCount,
    exactTargetRangeRemoved: afterTableDelete.doc === expectedAfterTableDelete,
    plainMarkerPreserved: afterTableDelete.doc.includes(PLAIN_MARKER),
    afterMarkerPreserved: afterTableDelete.doc.includes(AFTER_MARKER),
    secondTablePreserved: afterTableDelete.doc.includes(SECOND_TABLE_MARKER),
    tableRemoved: !afterTableDelete.doc.includes(TABLE_MARKER),
    diskInputWasTemporary: isInside(tempDirectory, documentPath),
    diskStillOriginalAtObservation: diskText === originalMarkdown,
    },
  );
  await captureScreenshot('editor-after-table-delete');
}

async function openTopMenu(name, evidenceName) {
  const trigger = await findVisibleRole('menuitem', name);
  await osPointer(trigger, `${evidenceName}.trigger`);
  await pollUntil(
    () => trigger.getAttribute('data-state'),
    (state) => state === 'open',
    `${evidenceName} trigger to open`,
  );
  const content = page.locator('.lm-menu-content[data-state="open"]:not(.lm-context-menu-content)').last();
  await content.waitFor({ state: 'visible', timeout: POINTER_TIMEOUT });
  return content;
}

async function openContextMenu(target, evidenceName) {
  await osPointer(target, `${evidenceName}.open`, { button: 'right' });
  const content = page.locator('.lm-context-menu-content[data-state="open"]').last();
  await content.waitFor({ state: 'visible', timeout: POINTER_TIMEOUT });
  return content;
}

async function recordMenuLayout(content, name) {
  const layout = await content.evaluate((menu) => {
    const menuRect = menu.getBoundingClientRect();
    const items = [
      ...menu.querySelectorAll(
        '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
      ),
    ]
      .filter((item) => {
        const rect = item.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((item) => {
        const rect = item.getBoundingClientRect();
        const label = item.querySelector('.lm-menu-label') ?? item;
        const labelStyle = getComputedStyle(label);
        return {
          height: rect.height,
          labelWhiteSpace: labelStyle.whiteSpace,
          labelWritingMode: labelStyle.writingMode,
          role: item.getAttribute('role'),
          text: item.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          width: rect.width,
        };
      });
    return {
      contentHeight: menuRect.height,
      contentWidth: menuRect.width,
      items,
    };
  });
  const itemResults = layout.items.map((item) => ({
    ...item,
    horizontal: isHorizontalMenuLayout({
      contentWidth: layout.contentWidth,
      itemHeight: item.height,
      itemWidth: item.width,
      labelWhiteSpace: item.labelWhiteSpace,
      labelWritingMode: item.labelWritingMode,
    }),
  }));
  const result = { ...layout, items: itemResults, name };
  evidence.menuLayouts.push(result);
  requireCheck(
    `${name}-uses-horizontal-menu-layout`,
    itemResults.length > 0 && itemResults.every((item) => item.horizontal),
    result,
  );
  return result;
}

async function osPointer(
  locator,
  name,
  {
    allowTargetExit = false,
    button = 'left',
    clipboardSequenceGuard,
    deltaCss = null,
    gesture = 'click',
  } = {},
) {
  if (!inputInjectionPermitted) {
    throw new Error('OS input injection is disabled during acceptance cleanup.');
  }
  throwIfInterrupted(`locating the ${name} pointer target`);
  if (pendingClipboardMutation && pendingClipboardMutation.name !== name) {
    throw new Error('A different pointer command cannot run while clipboard ownership is pending.');
  }
  const pendingClipboardSequence = pendingClipboardMutation?.previousSequence;
  if (
    clipboardSequenceGuard !== undefined &&
    pendingClipboardSequence !== undefined &&
    clipboardSequenceGuard !== pendingClipboardSequence
  ) {
    throw new Error('Conflicting clipboard sequence guards were requested.');
  }
  const guardedClipboardSequence =
    clipboardSequenceGuard ?? pendingClipboardSequence;
  const target = await readTarget(locator);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const metrics = await readClientMetrics();
  requireCheck(
    `pointer-dpr-and-input-desktop-match-${name}`,
    Math.abs(dpr - Number(metrics.dpiScale)) <= 0.02 &&
      metrics.inputDesktop?.name === 'Default' &&
      metrics.inputDesktop?.threadName === 'Default' &&
      metrics.inputDesktop?.matchesThread === true,
    {
      devicePixelRatio: dpr,
      dpiScale: metrics.dpiScale,
      inputDesktop: metrics.inputDesktop,
      name,
    },
  );
  const cssPoint = {
    x: target.box.x + target.box.width / 2,
    y: target.box.y + target.box.height / 2,
  };
  const screenPoint = cssPointToScreen({
    clientOrigin: metrics.clientOrigin,
    cssPoint,
    devicePixelRatio: dpr,
  });
  const toCssPoint = deltaCss
    ? { x: cssPoint.x + deltaCss.x, y: cssPoint.y + deltaCss.y }
    : cssPoint;
  const toScreenPoint = cssPointToScreen({
    clientOrigin: metrics.clientOrigin,
    cssPoint: toCssPoint,
    devicePixelRatio: dpr,
  });
  throwIfInterrupted(`injecting the ${name} pointer gesture`);
  const bridge = invokeBridge({
    action: 'pointer',
    allowTargetExit,
    button,
    expectedClipboardSequence: guardedClipboardSequence,
    gesture,
    guardClipboardSequence: guardedClipboardSequence !== undefined,
    screenPoint,
    timeout: POINTER_TIMEOUT,
    toScreenPoint,
  });
  const event = {
    name,
    allowTargetExit,
    button,
    gesture,
    target: target.identity,
    clientOrigin: metrics.clientOrigin,
    clientSize: metrics.clientSize,
    devicePixelRatio: dpr,
    cssPoint,
    screenPoint,
    toCssPoint,
    toScreenPoint,
    bridge,
  };
  evidence.pointerEvents.push(event);
  return event;
}

async function readTarget(locator) {
  await locator.waitFor({ state: 'visible', timeout: POINTER_TIMEOUT });
  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('OS pointer target has no visible bounding box.');
  }
  const identity = await locator.evaluate((element) => ({
    ariaLabel: element.getAttribute('aria-label'),
    className: element.getAttribute('class'),
    role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
    testId: element.getAttribute('data-testid'),
    text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  }));
  return { box, identity };
}

async function findVisibleRole(role, name) {
  const candidates = page.getByRole(role, { name });
  const index = await pollUntil(
    async () => {
      const count = await candidates.count();
      for (let candidateIndex = 0; candidateIndex < count; candidateIndex += 1) {
        if (await candidates.nth(candidateIndex).isVisible()) return candidateIndex;
      }
      return -1;
    },
    (candidateIndex) => candidateIndex >= 0,
    `visible ${role} matching ${String(name)}`,
  );
  return candidates.nth(index);
}

async function readClientMetrics() {
  const metrics = invokeBridge({ action: 'metrics', timeout: 10_000 });
  return {
    ...metrics,
    clientOrigin: {
      x: Number(metrics.clientOrigin.x),
      y: Number(metrics.clientOrigin.y),
    },
  };
}

async function readFixtureLoadState() {
  return page.evaluate((markers) => {
    const contents = [...document.querySelectorAll('.cm-content')];
    const content =
      contents.find((candidate) => candidate.cmTile?.root?.view) ??
      contents.find((candidate) => !candidate.closest('.tbl-cell-editor'));
    const tile = content?.cmTile;
    const view = tile?.root?.view ?? tile?.view;
    if (!view) throw new Error('Root CodeMirror view is unavailable.');
    const documentText = view.state.doc.toString();
    return {
      documentLength: documentText.length,
      markerMatches: markers.map((marker) => documentText.includes(marker)),
    };
  }, ACCEPTANCE_FIXTURE_MARKERS);
}

async function readRootEditorMatch(expectedMarkdown) {
  return page.evaluate((expected) => {
    const contents = [...document.querySelectorAll('.cm-content')];
    const content =
      contents.find((candidate) => candidate.cmTile?.root?.view) ??
      contents.find((candidate) => !candidate.closest('.tbl-cell-editor'));
    const tile = content?.cmTile;
    const view = tile?.root?.view ?? tile?.view;
    if (!view) throw new Error('Root CodeMirror view is unavailable.');
    return {
      documentLength: view.state.doc.length,
      matchesExpected: view.state.doc.toString() === expected,
    };
  }, expectedMarkdown);
}

async function readRootEditorState() {
  return page.evaluate(() => {
    const contents = [...document.querySelectorAll('.cm-content')];
    const content =
      contents.find((candidate) => candidate.cmTile?.root?.view) ??
      contents.find((candidate) => !candidate.closest('.tbl-cell-editor'));
    const tile = content?.cmTile;
    const view = tile?.root?.view ?? tile?.view;
    if (!view) throw new Error('Root CodeMirror view is unavailable.');
    const selection = view.state.selection.main;
    return {
      doc: view.state.doc.toString(),
      selection: {
        anchor: selection.anchor,
        from: selection.from,
        head: selection.head,
        to: selection.to,
      },
    };
  });
}

function assertPasteClipboardMetadata(pasteClipboardMetadata, stage) {
  try {
    assertCurrentCommandOwnedClipboardMetadata({
      expectedSequence: expectedClipboardSequence,
      metadata: pasteClipboardMetadata,
      writerKind: INSTALLED_TEXT_WRITER_KIND,
    });
  } catch {
    markClipboardPrivacyRisk(`paste-clipboard-ownership-changed-${stage}`);
    throw new Error('Clipboard ownership could not be proven while Paste completed.');
  }
}

async function waitForPasteFixture(expectedMarkdown) {
  const deadline = Date.now() + POINTER_TIMEOUT;
  while (Date.now() < deadline) {
    throwIfInterrupted('waiting for Paste to restore the controlled fixture');
    let metadataBefore;
    try {
      metadataBefore = inspectBridgeClipboard();
    } catch {
      markClipboardPrivacyRisk('paste-clipboard-metadata-unverifiable-before-probe');
      throw new Error('Clipboard metadata became unavailable while Paste completed.');
    }
    assertPasteClipboardMetadata(metadataBefore, 'before-editor-probe');
    const editorMatch = await readRootEditorMatch(expectedMarkdown);
    let metadataAfter;
    try {
      metadataAfter = inspectBridgeClipboard();
    } catch {
      markClipboardPrivacyRisk('paste-clipboard-metadata-unverifiable-after-probe');
      throw new Error('Clipboard metadata became unavailable while Paste completed.');
    }
    assertPasteClipboardMetadata(metadataAfter, 'after-editor-probe');
    if (editorMatch.matchesExpected) return editorMatch;
    await delay(125);
  }
  throw new Error('Timed out waiting for Paste to restore the controlled fixture.');
}

function invokeBridge({
  action,
  allowTargetExit,
  button,
  expectedClipboardSequence: sequence,
  gesture,
  guardClipboardSequence,
  input,
  restoreHadText,
  screenPoint,
  timeout,
  toScreenPoint,
  value,
}) {
  if (action === 'pointer' && !inputInjectionPermitted) {
    throw new Error('Win32 pointer injection is disabled during acceptance cleanup.');
  }
  if (!bridgePath) throw new Error('Win32 bridge is not ready.');
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
  if (app?.pid) args.push('-TargetProcessId', String(app.pid));
  if (action === 'metrics' || action === 'pointer') {
    const targetBaseline = activeChildBaseline;
    if (
      !app?.pid ||
      targetBaseline?.processId !== app.pid ||
      typeof targetBaseline.executablePath !== 'string' ||
      typeof targetBaseline.startTimeUtc !== 'string'
    ) {
      throw new Error('The acceptance child identity baseline is unavailable.');
    }
    args.push('-TargetExecutablePath', targetBaseline.executablePath);
    args.push('-TargetStartTimeUtc', targetBaseline.startTimeUtc);
  }
  if (allowTargetExit) args.push('-AllowTargetExit');
  if (guardClipboardSequence) args.push('-GuardClipboardSequence');
  if (restoreHadText) args.push('-RestoreHadText');
  if (button) args.push('-Button', button);
  if (gesture) args.push('-Gesture', gesture);
  if (sequence !== undefined) {
    args.push('-ExpectedClipboardSequence', String(sequence));
  }
  if (screenPoint) args.push('-X', String(screenPoint.x), '-Y', String(screenPoint.y));
  if (toScreenPoint) args.push('-ToX', String(toScreenPoint.x), '-ToY', String(toScreenPoint.y));
  if (value !== undefined) args.push('-Value', value);
  if (timeout) args.push('-TimeoutMilliseconds', String(timeout));
  if (!systemTools?.powershellPath) {
    throw new Error('The trusted Windows PowerShell path is unavailable.');
  }
  let output;
  try {
    output = execFileSync(systemTools.powershellPath, args, {
      encoding: 'utf8',
      input,
      timeout: timeout ?? 10_000,
      windowsHide: true,
    }).trim();
  } catch (error) {
    const failure = classifyWin32BridgeFailure(action, error);
    // eslint-disable-next-line preserve-caught-error -- the raw subprocess error can contain private paths or clipboard diagnostics; only the allowlisted classification may cross this boundary.
    throw new Error(
      `Win32 bridge action failed: ${failure.action} ` +
        `(${failure.code}; status=${String(failure.status)}; ` +
        `signal=${String(failure.signal)}).`,
    );
  }
  const jsonLine = output.split(/\r?\n/).filter(Boolean).at(-1);
  if (!jsonLine) throw new Error(`Win32 bridge returned no JSON for ${action}.`);
  try {
    return JSON.parse(jsonLine);
  } catch {
    throw new Error(`Win32 bridge returned invalid JSON for ${action}.`);
  }
}

function inspectBridgeClipboard() {
  const result = invokeBridge({ action: 'clipboard-inspect', timeout: 5_000 });
  return {
    formats: Array.isArray(result.formats)
      ? result.formats.map(String)
      : result.formats
        ? [String(result.formats)]
        : [],
    hasText: Boolean(result.hasText),
    ownerBelongsToTarget: result.ownerBelongsToTarget === true,
    ownerHWnd: Number(result.ownerHWnd),
    ownerProcessId: Number(result.ownerProcessId),
    sequence: Number(result.sequence),
  };
}

function readBridgeClipboardText(sequence) {
  const result = invokeBridge({
    action: 'clipboard-read-text',
    expectedClipboardSequence: sequence,
    timeout: 5_000,
  });
  if (Number(result.sequence) !== sequence) {
    throw new Error('Clipboard ownership changed while recoverable text was captured.');
  }
  return decodeClipboardTextFromBridge(String(result.textUtf16Base64 ?? ''));
}

function beginClipboardMutation(
  name,
  expectedText,
  { compareAsPath = false } = {},
) {
  throwIfInterrupted(`starting the ${name} clipboard command`);
  if (pendingClipboardMutation) {
    throw new Error('A previous clipboard command is still awaiting ownership verification.');
  }
  const metadata = inspectBridgeClipboard();
  if (metadata.sequence !== expectedClipboardSequence) {
    throw new Error(
      'Clipboard ownership changed before the next clipboard command was injected.',
    );
  }
  pendingClipboardMutation = {
    compareAsPath,
    expectedText,
    name,
    previousSequence: expectedClipboardSequence,
    writerKind: INSTALLED_TEXT_WRITER_KIND,
  };
}

async function trackOwnedClipboardMutation(name) {
  const pending = pendingClipboardMutation;
  if (pending?.name !== name) {
    throw new Error('Clipboard command ownership tracking was not prepared for this command.');
  }
  const previousSequence = pending.previousSequence;
  const metadata = await pollUntil(
    async () => inspectBridgeClipboard(),
    (candidate) =>
      Number.isInteger(candidate.sequence) &&
      candidate.sequence !== previousSequence,
    `${name} to publish a new clipboard sequence`,
  );
  recordClipboardMetadataObservation(name, 'after-command-sequence', metadata);
  assertOwnedClipboardMetadata({
    metadata,
    previousSequence,
    writerKind: pending.writerKind,
  });
  const actualText = readBridgeClipboardText(metadata.sequence);
  expectedClipboardSequence = assertOwnedClipboardMutation({
    actualText,
    compareAsPath: pending.compareAsPath,
    expectedText: pending.expectedText,
    metadata,
    previousSequence,
    writerKind: pending.writerKind,
  });
  clipboardWasMutated = true;
  pendingClipboardMutation = undefined;
  evidence.clipboardMutations ??= [];
  evidence.clipboardMutations.push({
    name,
    ...summarizeClipboardMetadataForEvidence(metadata),
  });
  return actualText;
}

function recordClipboardMetadataObservation(name, stage, metadata) {
  evidence.clipboardMetadataObservations.push({
    name,
    stage,
    ...summarizeClipboardMetadataForEvidence(metadata),
  });
}

async function invokeTauriCommand(command, args) {
  return page.evaluate(
    async ({ commandName, commandArguments }) => {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals?.invoke) {
        throw new Error('Tauri invoke is unavailable.');
      }
      return internals.invoke(commandName, commandArguments);
    },
    { commandArguments: args, commandName: command },
  );
}

async function waitForTauriInvokeReady(phase) {
  await page.waitForLoadState('domcontentloaded', { timeout: APP_TIMEOUT });
  await page.waitForFunction(
    () => typeof window.__TAURI_INTERNALS__?.invoke === 'function',
    undefined,
    { timeout: APP_TIMEOUT },
  );
  requireCheck(`tauri-invoke-ready-${phase}`, true, { phase });
}

async function captureScreenshot(name) {
  const path = join(artifactDirectory, `${name}.png`);
  await page.screenshot({ path });
  evidence.screenshots.push(path);
  return path;
}

function requireCheck(name, ok, detail) {
  evidence.checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) throw new Error(`Acceptance check failed: ${name}`);
}

async function pollUntil(
  probe,
  predicate,
  description,
  { interval = 125, timeout = POINTER_TIMEOUT } = {},
) {
  const deadline = Date.now() + timeout;
  let lastProbeFailed = false;
  while (Date.now() < deadline) {
    throwIfInterrupted(`waiting for ${description}`);
    try {
      const value = await probe();
      if (predicate(value)) return value;
      lastProbeFailed = false;
    } catch {
      lastProbeFailed = true;
    }
    await delay(interval);
  }
  const outcome = lastProbeFailed
    ? 'The last probe failed.'
    : 'The last probe did not satisfy the condition.';
  throw new Error(`Timed out waiting for ${description}. ${outcome}`);
}

function throwIfInterrupted(nextAction) {
  if (!interruptionSignal) return;
  throw new Error(
    `Acceptance interrupted by ${interruptionSignal}; stopped before ${nextAction}.`,
  );
}

function markClipboardPrivacyRisk(reason) {
  if (clipboardPrivacyRisk) return;
  clipboardPrivacyRisk = {
    detectedAt: new Date().toISOString(),
    reason,
  };
  evidence.clipboardPrivacyRisk = clipboardPrivacyRisk;
  evidence.failureScreenshotSkippedForClipboardPrivacy = true;
  evidence.checks.push({
    detail: { reason },
    name: 'clipboard-privacy-risk-not-detected',
    ok: false,
  });
  evidence.processOutput.redactedChunkCounts = {
    stderr: evidence.processOutput.stderr.length,
    stdout: evidence.processOutput.stdout.length,
  };
  evidence.processOutput.stderr.length = 0;
  evidence.processOutput.stdout.length = 0;
  evidence.processOutput.redactedForClipboardPrivacy = true;
}

function recordProcessOutput(stream, phase, chunk) {
  if (clipboardPrivacyRisk) {
    evidence.processOutput.redactedChunkCounts[stream] += 1;
    return;
  }
  evidence.processOutput[stream].push(`[${phase}] ${String(chunk)}`);
}

async function waitForDebugEndpoint(port) {
  await pollUntil(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 600);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: controller.signal,
        });
        return response.ok;
      } finally {
        clearTimeout(timer);
      }
    },
    Boolean,
    `WebView2 debug endpoint on port ${port}`,
    { interval: 250, timeout: APP_TIMEOUT },
  );
}

function assertNoExistingInstance(path) {
  if (!systemTools?.tasklistPath) {
    throw new Error('The trusted Windows tasklist path is unavailable.');
  }
  const imageName = basename(path);
  const result = spawnSync(
    systemTools?.tasklistPath,
    ['/fi', `IMAGENAME eq ${imageName}`, '/fo', 'csv', '/nh'],
    { encoding: 'utf8', windowsHide: true },
  );
  return assertNoExistingImageProcess(result, imageName);
}

function stopOwnedChild(child) {
  if (!child?.pid) return { attempted: false };
  try {
    // ChildProcess retains the OS process handle acquired by spawn. Killing
    // through that handle avoids a verify-then-taskkill PID reuse window.
    return { accepted: child.kill('SIGKILL'), attempted: true };
  } catch (error) {
    return {
      attempted: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForOwnedChildTermination() {
  if (!appTermination) {
    throw new Error('The acceptance child termination observer is unavailable.');
  }
  return Promise.race([
    appTermination,
    delay(5_000).then(() => {
      throw new Error('Timed out waiting for the acceptance child termination event.');
    }),
  ]);
}

function verifyOwnedChildProcess(current, baseline, expectedExecutablePath) {
  if (!current?.exists) {
    throw new Error('The acceptance-owned LumaMark process no longer exists.');
  }
  if (
    normalizedPath(current.executablePath) !== normalizedPath(expectedExecutablePath) ||
    (baseline?.startTimeUtc && current.startTimeUtc !== baseline.startTimeUtc) ||
    (baseline?.processId && current.processId !== baseline.processId)
  ) {
    throw new Error('The process id no longer belongs to the spawned acceptance executable.');
  }
  return true;
}

function originsEqual(left, right, tolerance) {
  return (
    Math.abs(Number(left.x) - Number(right.x)) <= tolerance &&
    Math.abs(Number(left.y) - Number(right.y)) <= tolerance
  );
}

function normalizedPath(path) {
  return String(path)
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/\/\?\//, '')
    .replace(/\/$/, '')
    .toLocaleLowerCase('en-US');
}

function isInside(parent, child) {
  const normalizedParent = `${normalizedPath(resolve(parent))}/`;
  const normalizedChild = normalizedPath(resolve(child));
  return normalizedChild.startsWith(normalizedParent);
}

async function readProjectVersions(root) {
  const [packageJson, cargoToml, cargoLock, tauriConfig] = await Promise.all([
    readFile(join(root, 'package.json'), 'utf8'),
    readFile(join(root, 'src-tauri', 'Cargo.toml'), 'utf8'),
    readFile(join(root, 'src-tauri', 'Cargo.lock'), 'utf8'),
    readFile(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  ]);
  return {
    cargoLock: cargoLock.match(
      /\[\[package\]\]\s+name\s*=\s*"lumamark"\s+version\s*=\s*"([^"]+)"/m,
    )?.[1],
    cargoToml: cargoToml.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1],
    packageJson: JSON.parse(packageJson).version,
    tauriConfig: JSON.parse(tauriConfig).version,
  };
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function normalizeWindowsVersion(version) {
  return String(version ?? '').match(/\d+\.\d+\.\d+/)?.[0] ?? '';
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    accessErrorMeansPathMissing(error);
    return false;
  }
}

async function runCleanupStage(name, action) {
  try {
    const detail = await action();
    evidence.cleanupStages.push({ detail, name, ok: true });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    evidence.cleanupStages.push({ error: message, name, ok: false });
    process.exitCode = 1;
    return false;
  }
}
