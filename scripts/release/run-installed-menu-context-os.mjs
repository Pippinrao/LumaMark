import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeVerifierProcessOutcome } from './installedMenuContextOsHelpers.mjs';

const runnerSourcePath = fileURLToPath(import.meta.url);
const releaseDirectory = dirname(runnerSourcePath);
const verifierSourcePath = join(
  releaseDirectory,
  'verify-installed-menu-context-os.mjs',
);
const helperSourcePath = join(
  releaseDirectory,
  'installedMenuContextOsHelpers.mjs',
);

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function readResult(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function resultBelongsToCurrentRun({
  acceptanceRunId,
  result,
  runnerFinishedAt,
  runnerStartedAt,
}) {
  const resultStartedAt = Date.parse(result?.startedAt ?? '');
  const resultFinishedAt = Date.parse(result?.finishedAt ?? '');
  const runnerStartedTime = Date.parse(runnerStartedAt);
  const runnerFinishedTime = Date.parse(runnerFinishedAt);
  return (
    result?.acceptanceRunId === acceptanceRunId &&
    Number.isFinite(resultStartedAt) &&
    Number.isFinite(resultFinishedAt) &&
    resultStartedAt >= runnerStartedTime &&
    resultFinishedAt >= resultStartedAt &&
    resultFinishedAt <= runnerFinishedTime
  );
}

export async function executeInstalledAcceptanceRunner({
  artifactDirectory: requestedArtifactDirectory,
  environment = process.env,
  helperPath = helperSourcePath,
  runnerPath = runnerSourcePath,
  spawn = spawnSync,
  stdout = process.stdout,
  verifierPath = verifierSourcePath,
} = {}) {
  const runnerStartedAt = new Date().toISOString();
  const timestamp = runnerStartedAt.replaceAll(':', '-').replaceAll('.', '-');
  const artifactDirectory = resolve(
    requestedArtifactDirectory ||
      environment.LUMAMARK_ACCEPTANCE_ARTIFACTS?.trim() ||
      join('artifacts', 'installed-menu-context-os', timestamp),
  );
  await mkdir(artifactDirectory, { recursive: true });
  const resultPath = join(artifactDirectory, 'result.json');
  const runnerOutcomePath = join(artifactDirectory, 'runner-outcome.json');
  const acceptanceRunId = randomUUID();
  const sourceIdentityBefore = {
    helperSha256: await sha256File(helperPath),
    runnerSha256: await sha256File(runnerPath),
    verifierSha256: await sha256File(verifierPath),
  };
  const verifierProcess = spawn(process.execPath, [verifierPath], {
    cwd: process.cwd(),
    env: {
      ...environment,
      LUMAMARK_ACCEPTANCE_ARTIFACTS: artifactDirectory,
      LUMAMARK_ACCEPTANCE_RUN_ID: acceptanceRunId,
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  const sourceIdentityAfter = {
    helperSha256: await sha256File(helperPath),
    runnerSha256: await sha256File(runnerPath),
    verifierSha256: await sha256File(verifierPath),
  };
  const runnerFinishedAt = new Date().toISOString();
  const verifierResult = await readResult(resultPath);
  const resultFresh = resultBelongsToCurrentRun({
    acceptanceRunId,
    result: verifierResult,
    runnerFinishedAt,
    runnerStartedAt,
  });
  const observedOutcome = summarizeVerifierProcessOutcome({
    observedExitCode: verifierProcess.status,
    observedSignal: verifierProcess.signal,
    plannedExitCode: resultFresh ? verifierResult?.plannedExitCode : undefined,
  });
  const sourceIdentityStable =
    JSON.stringify(sourceIdentityBefore) === JSON.stringify(sourceIdentityAfter);
  const sourceIdentityMatchesVerifier =
    resultFresh &&
    verifierResult?.acceptanceSourceIdentity?.helperSha256 ===
      sourceIdentityBefore.helperSha256 &&
    verifierResult?.acceptanceSourceIdentity?.verifierSha256 ===
      sourceIdentityBefore.verifierSha256;
  const verifierSummaryPassed =
    resultFresh && verifierResult?.summary?.passed === true;
  const runnerOutcome = {
    ...observedOutcome,
    acceptanceRunId,
    observedExitCode: verifierProcess.status,
    observedSignal: verifierProcess.signal,
    resultFresh,
    runnerFinishedAt,
    runnerSha256: sourceIdentityBefore.runnerSha256,
    runnerStartedAt,
    sourceIdentityMatchesVerifier,
    sourceIdentityStable,
    verifierSummaryPassed,
  };
  if (
    verifierProcess.error ||
    !resultFresh ||
    !sourceIdentityStable ||
    !sourceIdentityMatchesVerifier ||
    !verifierSummaryPassed
  ) {
    runnerOutcome.runnerExitCode = 1;
  }

  await writeFile(
    runnerOutcomePath,
    `${JSON.stringify(runnerOutcome, null, 2)}\n`,
    'utf8',
  );
  if (resultFresh) {
    verifierResult.runnerOutcome = runnerOutcome;
    verifierResult.summary = {
      ...verifierResult.summary,
      passed:
        verifierResult.summary?.passed === true &&
        runnerOutcome.runnerExitCode === 0,
      runnerPassed: runnerOutcome.runnerExitCode === 0,
    };
    await writeFile(
      resultPath,
      `${JSON.stringify(verifierResult, null, 2)}\n`,
      'utf8',
    );
  }
  stdout.write(
    `${JSON.stringify({ resultFresh, runnerOutcome }, null, 2)}\n`,
  );
  return { resultFresh, runnerOutcome };
}

async function main() {
  if (process.platform !== 'win32') {
    const verifierProcess = spawnSync(process.execPath, [verifierSourcePath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    process.exitCode = Number.isInteger(verifierProcess.status)
      ? verifierProcess.status
      : 1;
    return;
  }

  const { runnerOutcome } = await executeInstalledAcceptanceRunner();
  process.exitCode = runnerOutcome.runnerExitCode;
}

if (resolve(process.argv[1] ?? '') === resolve(runnerSourcePath)) {
  try {
    await main();
  } catch {
    process.stderr.write('Installed menu/context OS acceptance runner failed.\n');
    process.exitCode = 1;
  }
}
