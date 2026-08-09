import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const { expectedVersion, root } = parseArguments(process.argv.slice(2));

try {
  const versions = await readVersions(root);
  const mismatches = Object.entries(versions).filter(
    ([, version]) => version !== expectedVersion,
  );

  if (mismatches.length > 0) {
    throw new Error(
      mismatches
        .map(
          ([path, version]) =>
            `${path}: expected ${expectedVersion}, found ${version ?? 'missing'}`,
        )
        .join('\n'),
    );
  }

  process.stdout.write(`${JSON.stringify({ version: expectedVersion })}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

async function readVersions(rootDirectory) {
  const [packageJson, cargoToml, cargoLock, tauriConfig] = await Promise.all([
    readFile(resolve(rootDirectory, 'package.json'), 'utf8'),
    readFile(resolve(rootDirectory, 'src-tauri', 'Cargo.toml'), 'utf8'),
    readFile(resolve(rootDirectory, 'src-tauri', 'Cargo.lock'), 'utf8'),
    readFile(resolve(rootDirectory, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  ]);

  return {
    'package.json': JSON.parse(packageJson).version,
    'src-tauri/Cargo.toml': findPackageVersion(cargoToml),
    'src-tauri/Cargo.lock': findLumaMarkLockVersion(cargoLock),
    'src-tauri/tauri.conf.json': JSON.parse(tauriConfig).version,
  };
}

function findPackageVersion(cargoToml) {
  return cargoToml.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
}

function findLumaMarkLockVersion(cargoLock) {
  return cargoLock.match(
    /\[\[package\]\]\s+name\s*=\s*"lumamark"\s+version\s*=\s*"([^"]+)"/m,
  )?.[1];
}

function parseArguments(args) {
  const rootIndex = args.indexOf('--root');
  const expectedVersionIndex = args.indexOf('--expected-version');
  const root = rootIndex === -1 ? process.cwd() : args.at(rootIndex + 1);
  const expectedVersion =
    expectedVersionIndex === -1 ? undefined : args.at(expectedVersionIndex + 1);

  if (!root) {
    throw new Error('--root requires a path.');
  }

  if (!expectedVersion) {
    throw new Error('--expected-version requires a SemVer version.');
  }

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
    throw new Error(`Invalid expected version: ${expectedVersion}`);
  }

  return { expectedVersion, root: resolve(root) };
}
