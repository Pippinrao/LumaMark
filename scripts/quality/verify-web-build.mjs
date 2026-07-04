import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const LARGE_CHUNK_WARNING = 'Some chunks are larger than 500 kB';
const VITE_WARNING_MARKER = '(!)';
const ENTRY_CHUNK_BUDGET_BYTES = 120 * 1024;
const JS_CHUNK_BUDGET_BYTES = 700 * 1024;

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

if (output.includes(VITE_WARNING_MARKER)) {
  process.stderr.write('\n[quality:web-build] Vite emitted a build warning.\n');
  process.exit(1);
}

const distDir = join(process.cwd(), 'dist');
const assetsDir = join(distDir, 'assets');
const entryChunk = await findEntryChunk(distDir);
const chunks = await collectJavaScriptChunks(assetsDir);
const entry = chunks.find((chunk) => chunk.name === entryChunk);

if (!entry) {
  process.stderr.write(
    `\n[quality:web-build] Could not find entry chunk ${entryChunk} in dist/assets.\n`,
  );
  process.exit(1);
}

const oversizedEntry = entry.size > ENTRY_CHUNK_BUDGET_BYTES;
const oversizedChunks = chunks.filter(
  (chunk) => chunk.size > JS_CHUNK_BUDGET_BYTES,
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
    return ['cmd.exe', ['/d', '/s', '/c', 'pnpm exec vite build']];
  }

  return ['pnpm', ['exec', 'vite', 'build']];
}

async function findEntryChunk(distDir) {
  const html = await readFile(join(distDir, 'index.html'), 'utf8');
  const match = html.match(/<script[^>]+type="module"[^>]+src="\.?\/?assets\/([^"]+\.js)"/);

  if (!match) {
    throw new Error('Unable to find the module entry chunk in dist/index.html.');
  }

  return match[1];
}

async function collectJavaScriptChunks(assetsDir) {
  const names = await readdir(assetsDir);
  const jsNames = names.filter((name) => name.endsWith('.js'));

  return Promise.all(
    jsNames.map(async (name) => {
      const file = await stat(join(assetsDir, name));

      return {
        name,
        size: file.size,
      };
    }),
  );
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
