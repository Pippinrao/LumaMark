import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO = 'Pippinrao/LumaMark';

/**
 * @param {{
 *   version: string;
 *   signature: string;
 *   notes?: string;
 *   pubDate?: string;
 *   repo?: string;
 * }} options
 */
export function buildUpdaterManifest({
  version,
  signature,
  notes = '',
  pubDate = new Date().toISOString(),
  repo = DEFAULT_REPO,
}) {
  if (!version.trim()) {
    throw new Error('Updater manifest requires a non-empty version.');
  }
  if (!signature.trim()) {
    throw new Error('Updater manifest requires a non-empty signature.');
  }

  const assetName = `LumaMark_${version}_x64-setup.exe`;
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      'windows-x86_64': {
        signature: signature.trim(),
        url: `https://github.com/${repo}/releases/download/v${version}/${assetName}`,
      },
    },
  };
}

/**
 * @param {{
 *   packageJsonPath: string;
 *   signaturePath: string;
 *   outputPath: string;
 *   notes?: string;
 *   pubDate?: string;
 *   repo?: string;
 * }} options
 */
export async function generateUpdaterManifestFile(options) {
  const packageJson = JSON.parse(await readFile(options.packageJsonPath, 'utf8'));
  const version = String(packageJson.version ?? '');
  let signature;
  try {
    signature = await readFile(options.signaturePath, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing updater signature file at ${options.signaturePath}: ${detail}`,
      { cause: error },
    );
  }

  const expectedSignatureName = `LumaMark_${version}_x64-setup.exe.sig`;
  if (path.basename(options.signaturePath) !== expectedSignatureName) {
    throw new Error(
      `Signature filename must be ${expectedSignatureName}, got ${path.basename(options.signaturePath)}.`,
    );
  }

  const manifest = buildUpdaterManifest({
    version,
    signature,
    notes: options.notes,
    pubDate: options.pubDate,
    repo: options.repo,
  });

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const version = String(packageJson.version);
  const signaturePath = path.join(
    root,
    'src-tauri/target/release/bundle/nsis',
    `LumaMark_${version}_x64-setup.exe.sig`,
  );
  const outputPath = path.join(root, 'src-tauri/target/release/bundle/nsis/latest.json');

  const manifest = await generateUpdaterManifestFile({
    packageJsonPath,
    signaturePath,
    outputPath,
    notes: process.env.LUMAMARK_RELEASE_NOTES ?? '',
  });

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
