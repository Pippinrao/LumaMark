import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

const EXPECTED_VERSION = '4.1.3';
const EXPECTED_LICENSE = 'Apache-2.0';
const EXPECTED_LICENSE_SHA256 =
  'CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30';
const MHCHEMPARSER_NAME = 'mhchemparser';
const MHCHEMPARSER_VERSION = '4.2.1';
const MHCHEMPARSER_LICENSE_SHA256 =
  'B40930BBCF80744C86C46A12BC9DA056641D722716C378F5659B9E555EF833E1';
const PACKAGES = ['@mathjax/src', '@mathjax/mathjax-newcm-font'];

try {
  const root = resolve(parseRoot(process.argv.slice(2)));
  const rootPackage = await readJson(join(root, 'package.json'));
  const packageNotices = [];

  for (const packageName of PACKAGES) {
    const declaredVersion = rootPackage.dependencies?.[packageName];
    if (declaredVersion !== EXPECTED_VERSION) {
      throw new Error(
        `${packageName} must be pinned to ${EXPECTED_VERSION}; found ${String(declaredVersion)}.`,
      );
    }

    const packageRoot = join(root, 'node_modules', ...packageName.split('/'));
    const metadata = await readJson(join(packageRoot, 'package.json'));
    if (
      metadata.name !== packageName ||
      metadata.version !== EXPECTED_VERSION ||
      metadata.license !== EXPECTED_LICENSE
    ) {
      throw new Error(
        `${packageName} installed metadata must be ${EXPECTED_VERSION} / ${EXPECTED_LICENSE}.`,
      );
    }

    const repository =
      typeof metadata.repository === 'string'
        ? metadata.repository
        : metadata.repository?.url;
    if (typeof repository !== 'string' || repository.length === 0) {
      throw new Error(`${packageName} does not declare a repository URL.`);
    }

    packageNotices.push({ packageName, repository, version: EXPECTED_VERSION });
  }

  const mhchem = await readMhchemparser(root);
  packageNotices.push({
    packageName: mhchem.packageName,
    repository: mhchem.repository,
    version: mhchem.version,
  });

  const licenseBuffer = await readFile(
    join(root, 'node_modules', '@mathjax', 'src', 'LICENSE'),
  );
  const licenseSha256 = createHash('sha256')
    .update(licenseBuffer)
    .digest('hex')
    .toUpperCase();
  if (licenseSha256 !== EXPECTED_LICENSE_SHA256) {
    throw new Error(
      `MathJax Apache-2.0 license SHA-256 mismatch: expected ${EXPECTED_LICENSE_SHA256}, found ${licenseSha256}.`,
    );
  }

  const notice = [
    'LumaMark Third-Party License Notices',
    '====================================',
    '',
    ...packageNotices.flatMap(({ packageName, repository, version }) => [
      `${packageName} ${version}`,
      `Repository: ${repository}`,
      `License: ${EXPECTED_LICENSE}`,
      '',
    ]),
    `Canonical license SHA-256: ${EXPECTED_LICENSE_SHA256}`,
    `mhchemparser license SHA-256: ${MHCHEMPARSER_LICENSE_SHA256}`,
    '',
    licenseBuffer.toString('utf8').trimEnd(),
    '',
    '----- mhchemparser Apache-2.0 -----',
    '',
    mhchem.licenseText.trimEnd(),
    '',
  ].join('\n');

  const noticeFileName = 'THIRD_PARTY_LICENSES.txt';
  const outputs = [
    join(root, 'dist', noticeFileName),
    join(root, 'src-tauri', 'resources', noticeFileName),
  ];
  for (const outputPath of outputs) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, notice, 'utf8');
  }
} catch (error) {
  process.stderr.write(
    `[generate-third-party-licenses] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

function parseRoot(args) {
  if (args.length === 0) {
    return process.cwd();
  }

  if (args.length === 2 && args[0] === '--root' && args[1]) {
    return args[1];
  }

  throw new Error('Usage: generate-third-party-licenses.mjs [--root <path>]');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readMhchemparser(root) {
  const mathjaxPackageJson = await realpath(
    join(root, 'node_modules', '@mathjax', 'src', 'package.json'),
  );
  const requireFromMathjax = createRequire(mathjaxPackageJson);
  const packageJsonPath = requireFromMathjax.resolve(
    `${MHCHEMPARSER_NAME}/package.json`,
  );
  const packageRoot = dirname(packageJsonPath);
  const metadata = await readJson(packageJsonPath);
  if (
    metadata.name !== MHCHEMPARSER_NAME ||
    metadata.version !== MHCHEMPARSER_VERSION ||
    metadata.license !== EXPECTED_LICENSE
  ) {
    throw new Error(
      `${MHCHEMPARSER_NAME} installed metadata must be ${MHCHEMPARSER_VERSION} / ${EXPECTED_LICENSE}.`,
    );
  }

  const repository =
    typeof metadata.repository === 'string'
      ? metadata.repository
      : metadata.repository?.url;
  if (typeof repository !== 'string' || repository.length === 0) {
    throw new Error(`${MHCHEMPARSER_NAME} does not declare a repository URL.`);
  }

  const licenseBuffer = await readFile(join(packageRoot, 'LICENSE.txt'));
  const licenseSha256 = createHash('sha256')
    .update(licenseBuffer)
    .digest('hex')
    .toUpperCase();
  if (licenseSha256 !== MHCHEMPARSER_LICENSE_SHA256) {
    throw new Error(
      `mhchemparser Apache-2.0 license SHA-256 mismatch: expected ${MHCHEMPARSER_LICENSE_SHA256}, found ${licenseSha256}.`,
    );
  }

  return {
    licenseText: licenseBuffer.toString('utf8'),
    packageName: MHCHEMPARSER_NAME,
    repository,
    version: MHCHEMPARSER_VERSION,
  };
}
