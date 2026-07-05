import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const manifestPath = join(
  repoRoot,
  'scripts',
  'quality',
  'markdown-corpus-manifest.json',
);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const cacheDirectory = join(repoRoot, manifest.cacheDirectory);
const downloadedAt = new Date().toISOString();

await mkdir(cacheDirectory, { recursive: true });

const index = {
  downloadedAt,
  files: [],
  manifestPath: 'scripts/quality/markdown-corpus-manifest.json',
};

for (const sample of manifest.samples) {
  const text = await fetchTextWithRetries(sample);
  const byteLength = Buffer.byteLength(text, 'utf8');
  const sha256 = createHash('sha256').update(text).digest('hex');
  const extension = basename(new URL(sample.url).pathname).includes('.')
    ? ''
    : '.md';
  const fileName = `${sample.id}${extension}`;

  await writeFile(join(cacheDirectory, fileName), text, 'utf8');
  index.files.push({
    byteLength,
    fileName,
    id: sample.id,
    license: sample.license,
    sha256,
    source: sample.source,
    url: sample.url,
  });
}

await writeFile(
  join(cacheDirectory, 'index.json'),
  `${JSON.stringify(index, null, 2)}\n`,
  'utf8',
);

const totalBytes = index.files.reduce((sum, file) => sum + file.byteLength, 0);
console.log(
  `Downloaded ${index.files.length} Markdown corpus files (${totalBytes} bytes) to ${manifest.cacheDirectory}.`,
);

async function fetchTextWithRetries(sample) {
  const maxAttempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(sample.url);

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await delay(400 * attempt);
      }
    }
  }

  throw new Error(
    `Failed to download ${sample.id} after ${maxAttempts} attempts: ${lastError}`,
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
