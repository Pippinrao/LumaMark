import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const LARGE_CHUNK_WARNING = 'Some chunks are larger than 500 kB';
const ROLLDOWN_PLUGIN_TIMINGS_WARNING = '[PLUGIN_TIMINGS]';
const VITE_WARNING_MARKER = '(!)';
const ENTRY_CHUNK_BUDGET_BYTES = 120 * 1024;
const JS_CHUNK_BUDGET_BYTES = 700 * 1024;
const NEWCM_FONT_ASSET_COUNT = 105;
const THIRD_PARTY_LICENSE_FILE = 'THIRD_PARTY_LICENSES.txt';
const MATHJAX_LICENSE_SHA256 =
  'CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30';
const APACHE_LICENSE_HEADING =
  /Apache\s+License\s+Version 2\.0, January 2004/u;

const result = await run(...buildCommand());
const output = `${result.stdout}\n${result.stderr}`;

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);

if (result.exitCode !== 0) {
  process.exit(result.exitCode ?? 1);
}

if (output.includes(LARGE_CHUNK_WARNING)) {
  process.stderr.write(
    `\n[quality:web-build] Vite emitted the large chunk warning: ${LARGE_CHUNK_WARNING}\n`,
  );
  process.exit(1);
}

if (output.includes(ROLLDOWN_PLUGIN_TIMINGS_WARNING)) {
  process.stderr.write(
    '\n[quality:web-build] Rolldown emitted a PLUGIN_TIMINGS warning.\n',
  );
  process.exit(1);
}

if (output.includes(VITE_WARNING_MARKER)) {
  process.stderr.write('\n[quality:web-build] Vite emitted a build warning.\n');
  process.exit(1);
}

const distDir = join(process.cwd(), 'dist');
const entryChunk = await findEntryChunk(distDir);
const chunks = await collectJavaScriptChunks(distDir);
const entry = chunks.find((chunk) => chunk.name === entryChunk);

if (!entry) {
  process.stderr.write(
    `\n[quality:web-build] Could not find entry chunk ${entryChunk} in dist.\n`,
  );
  process.exit(1);
}

const oversizedEntry = entry.size > ENTRY_CHUNK_BUDGET_BYTES;
const oversizedChunks = chunks.filter(
  (chunk) =>
    chunk.size > JS_CHUNK_BUDGET_BYTES && !isExemptLazyEngineChunk(chunk.name),
);

if (oversizedEntry || oversizedChunks.length > 0) {
  process.stderr.write('\n[quality:web-build] Web chunk budget failed.\n');
  if (oversizedEntry) {
    process.stderr.write(
      `- Entry ${entry.name}: ${formatKiB(entry.size)} > ${formatKiB(
        ENTRY_CHUNK_BUDGET_BYTES,
      )}\n`,
    );
  }

  for (const chunk of oversizedChunks) {
    process.stderr.write(
      `- Chunk ${chunk.name}: ${formatKiB(chunk.size)} > ${formatKiB(
        JS_CHUNK_BUDGET_BYTES,
      )}\n`,
    );
  }
  process.exit(1);
}

const newcmFonts = await collectMatchingFiles(
  distDir,
  (name) => /^mjx-ncm-.+\.woff2$/u.test(name),
);
if (newcmFonts.length !== NEWCM_FONT_ASSET_COUNT) {
  process.stderr.write(
    `\n[quality:web-build] Expected ${NEWCM_FONT_ASSET_COUNT} packaged NewCM WOFF2 assets, found ${newcmFonts.length}.\n`,
  );
  process.exit(1);
}

await verifyThirdPartyLicenseNotice(distDir);

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
    });
    let settled = false;
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      stderr += `${error.stack ?? error.message}\n`;
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        exitCode: 1,
        stderr,
        stdout,
      });
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        exitCode,
        stderr,
        stdout,
      });
    });
  });
}

function buildCommand() {
  if (process.platform === 'win32') {
    return ['cmd.exe', ['/d', '/s', '/c', 'pnpm build:web']];
  }

  return ['pnpm', ['build:web']];
}

async function verifyThirdPartyLicenseNotice(distDir) {
  let notice;
  try {
    notice = await readFile(join(distDir, THIRD_PARTY_LICENSE_FILE), 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      process.stderr.write(
        `\n[quality:web-build] Missing dist/${THIRD_PARTY_LICENSE_FILE}.\n`,
      );
      process.exit(1);
    }
    throw error;
  }

  const requiredMarkers = [
    '@mathjax/src 4.1.3',
    '@mathjax/mathjax-newcm-font 4.1.3',
    'mhchemparser 4.2.1',
    'License: Apache-2.0',
    `Canonical license SHA-256: ${MATHJAX_LICENSE_SHA256}`,
    'mhchemparser license SHA-256: B40930BBCF80744C86C46A12BC9DA056641D722716C378F5659B9E555EF833E1',
  ];
  const missingMarkers = requiredMarkers.filter(
    (marker) => !notice.includes(marker),
  );
  if (
    missingMarkers.length > 0 ||
    !APACHE_LICENSE_HEADING.test(notice)
  ) {
    process.stderr.write(
      `\n[quality:web-build] dist/${THIRD_PARTY_LICENSE_FILE} is incomplete or invalid.\n`,
    );
    process.exit(1);
  }
}

async function findEntryChunk(distDir) {
  const html = await readFile(join(distDir, 'index.html'), 'utf8');
  const match = html.match(/<script[^>]+type="module"[^>]+src="\.?\/?assets\/([^"]+\.js)"/);

  if (!match) {
    throw new Error('Unable to find the module entry chunk in dist/index.html.');
  }

  return `assets/${match[1]}`;
}

async function collectJavaScriptChunks(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = join(relativeDirectory, entry.name);
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      chunks.push(...(await collectJavaScriptChunks(absolutePath, relativePath)));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      continue;
    }

    const file = await stat(absolutePath);
    chunks.push({
      name: relativePath.replaceAll('\\', '/'),
      size: file.size,
    });
  }

  return chunks;
}

async function collectMatchingFiles(
  directory,
  matches,
  relativeDirectory = '',
) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = join(relativeDirectory, entry.name);
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectMatchingFiles(absolutePath, matches, relativePath)));
    } else if (entry.isFile() && matches(entry.name)) {
      files.push(relativePath.replaceAll('\\', '/'));
    }
  }

  return files;
}

function isExemptLazyEngineChunk(name) {
  const base = name.split(/[\\/]/).pop() ?? name;
  return /^(plantuml-|viz-global-)/u.test(base);
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
